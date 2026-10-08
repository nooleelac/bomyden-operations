"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, requirePayrollAccess } from "@/lib/auth/session";
import { fail, friendlyDbError, success, zodFieldErrors, type ActionState } from "@/lib/action-state";

function revalidatePayroll() {
  revalidatePath("/payroll", "layout");
  revalidatePath("/payslips", "layout");
}

const money = (label: string) =>
  z
    .string()
    .trim()
    .transform((v) => v.replace(/[.,\s]/g, ""))
    .pipe(
      z
        .string()
        .regex(/^\d{0,12}$/, { message: `${label} phải là số tiền hợp lệ.` })
        .transform((v) => (v === "" ? 0 : Number(v)))
    );

const optionalMoney = (label: string) =>
  z
    .string()
    .trim()
    .transform((v) => v.replace(/[.,\s]/g, ""))
    .pipe(
      z
        .string()
        .regex(/^\d{0,12}$/, { message: `${label} phải là số tiền hợp lệ.` })
        .transform((v) => (v === "" ? null : Number(v)))
    );

const str = (formData: FormData, key: string) => String(formData.get(key) ?? "");

// =====================================================================
// HỒ SƠ LƯƠNG
// =====================================================================
const profileSchema = z.object({
  pay_type: z.enum(["hourly", "per_shift", "fixed"], { message: "Kiểu lương không hợp lệ." }),
  pay_period: z.enum(["weekly", "monthly"], { message: "Kỳ lương không hợp lệ." }),
  hourly_rate: money("Đơn giá giờ"),
  shift_rate: money("Đơn giá ca"),
  fixed_salary: money("Lương cố định"),
  standard_days: z.coerce.number({ message: "Ngày công chuẩn phải là số." }).int().min(1, { message: "Tối thiểu 1 ngày." }).max(31),
  overtime_enabled: z.boolean(),
  overtime_threshold_hours: z.coerce.number({ message: "Giờ chuẩn phải là số." }).min(1).max(24),
  overtime_rate: money("Đơn giá tăng ca"),
  allowance_per_period: money("Phụ cấp cố định"),
  allowance_per_workday: money("Phụ cấp theo ngày"),
  late_grace_minutes: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .pipe(z.number().int().min(0).max(240).nullable()),
  late_penalty: optionalMoney("Phạt trễ"),
  checklist_failed_penalty: optionalMoney("Phạt không đạt"),
  checklist_missed_penalty: optionalMoney("Phạt không làm"),
  checklist_late_penalty: optionalMoney("Phạt làm trễ"),
});

export async function saveProfile(employeeId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requirePayrollAccess();

  const parsed = profileSchema.safeParse({
    pay_type: str(formData, "pay_type"),
    pay_period: str(formData, "pay_period"),
    hourly_rate: str(formData, "hourly_rate"),
    shift_rate: str(formData, "shift_rate"),
    fixed_salary: str(formData, "fixed_salary"),
    standard_days: str(formData, "standard_days") || "26",
    overtime_enabled: formData.get("overtime_enabled") === "on",
    overtime_threshold_hours: str(formData, "overtime_threshold_hours") || "8",
    overtime_rate: str(formData, "overtime_rate"),
    allowance_per_period: str(formData, "allowance_per_period"),
    allowance_per_workday: str(formData, "allowance_per_workday"),
    late_grace_minutes: str(formData, "late_grace_minutes"),
    late_penalty: str(formData, "late_penalty"),
    checklist_failed_penalty: str(formData, "checklist_failed_penalty"),
    checklist_missed_penalty: str(formData, "checklist_missed_penalty"),
    checklist_late_penalty: str(formData, "checklist_late_penalty"),
  });
  if (!parsed.success) return fail("Vui lòng kiểm tra lại thông tin.", zodFieldErrors(parsed.error.issues));

  const { overtime_threshold_hours, ...rest } = parsed.data;
  const values = {
    ...rest,
    overtime_threshold_minutes: Math.round(overtime_threshold_hours * 60),
    // Chỉ QTV gửi được cờ xem phiếu lương; Quản lý giữ nguyên giá trị cũ (DB cũng chặn)
    ...(actor.role === "admin" ? { can_view_payslip: formData.get("can_view_payslip") === "on" } : {}),
  };

  const supabase = await createClient();
  const { data: existing } = await supabase.from("payroll_profiles").select("employee_id").eq("employee_id", employeeId).maybeSingle();

  const { error } = existing
    ? await supabase.from("payroll_profiles").update(values).eq("employee_id", employeeId).select("employee_id").single()
    : await supabase.from("payroll_profiles").insert({ ...values, employee_id: employeeId }).select("employee_id").single();

  if (error) {
    if (error.code === "PGRST116") return fail("Bạn không có quyền sửa hồ sơ lương của nhân viên này.");
    return fail(friendlyDbError(error));
  }

  revalidatePayroll();
  return success("Đã lưu hồ sơ lương. Kỳ đã chốt không bị ảnh hưởng.");
}

// =====================================================================
// ĐIỀU CHỈNH NHẬP TAY
// =====================================================================
const adjustmentSchema = z.object({
  kind: z.enum(["kpi", "bonus", "allowance", "deduction", "correction_plus", "correction_minus"], {
    message: "Loại khoản không hợp lệ.",
  }),
  amount: money("Số tiền").pipe(z.number().min(1000, { message: "Số tiền tối thiểu 1.000đ." }).max(1_000_000_000)),
  reason: z.string().trim().min(3, { message: "Vui lòng ghi lý do (ít nhất 3 ký tự)." }).max(500),
});

export async function addAdjustment(
  employeeId: string,
  periodStart: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requirePayrollAccess();
  const parsed = adjustmentSchema.safeParse({
    kind: str(formData, "kind"),
    amount: str(formData, "amount"),
    reason: str(formData, "reason"),
  });
  if (!parsed.success) return fail("Vui lòng kiểm tra lại thông tin.", zodFieldErrors(parsed.error.issues));

  const supabase = await createClient();
  const { error } = await supabase
    .from("payroll_adjustments")
    .insert({ ...parsed.data, employee_id: employeeId, period_start: periodStart })
    .select("id")
    .single();
  if (error) return fail(friendlyDbError(error));

  revalidatePayroll();
  return success("Đã thêm khoản điều chỉnh.");
}

export async function deleteAdjustment(adjustmentId: string): Promise<ActionState> {
  await requirePayrollAccess();
  const supabase = await createClient();
  const { data, error } = await supabase.from("payroll_adjustments").delete().eq("id", adjustmentId).select("id");
  if (error) return fail(friendlyDbError(error));
  if (!data?.length) return fail("Không xóa được khoản này (không có quyền hoặc đã bị xóa).");

  revalidatePayroll();
  return success("Đã xóa khoản điều chỉnh.");
}

// =====================================================================
// CHỐT LƯƠNG
// =====================================================================
export async function finalizePayslip(employeeId: string, periodStart: string): Promise<ActionState> {
  await requirePayrollAccess();
  const supabase = await createClient();
  const { error } = await supabase.rpc("finalize_payslip", { p_employee_id: employeeId, p_period_start: periodStart });
  if (error) return fail(friendlyDbError(error));

  revalidatePayroll();
  return success("Đã chốt lương. Phiếu lương đã được khóa.");
}

// =====================================================================
// CÀI ĐẶT CHUNG (chỉ QTV)
// =====================================================================
const settingsSchema = z.object({
  late_grace_minutes: z.coerce.number({ message: "Phút ân hạn phải là số." }).int().min(0).max(240),
  late_penalty: money("Phạt trễ"),
  checklist_failed_penalty: money("Phạt không đạt"),
  checklist_missed_penalty: money("Phạt không làm"),
  checklist_late_penalty: money("Phạt làm trễ"),
});

export async function saveSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = settingsSchema.safeParse({
    late_grace_minutes: str(formData, "late_grace_minutes") || "0",
    late_penalty: str(formData, "late_penalty"),
    checklist_failed_penalty: str(formData, "checklist_failed_penalty"),
    checklist_missed_penalty: str(formData, "checklist_missed_penalty"),
    checklist_late_penalty: str(formData, "checklist_late_penalty"),
  });
  if (!parsed.success) return fail("Vui lòng kiểm tra lại thông tin.", zodFieldErrors(parsed.error.issues));

  const supabase = await createClient();
  const { data, error } = await supabase.from("payroll_settings").update(parsed.data).eq("id", true).select("id");
  if (error) return fail(friendlyDbError(error));
  if (!data?.length) return fail("Bạn không có quyền sửa cài đặt lương.");

  revalidatePayroll();
  return success("Đã lưu mức phạt chung. Áp dụng cho các kỳ chưa chốt.");
}

export async function setManagerPayrollAccess(employeeId: string, enabled: boolean): Promise<ActionState> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employees")
    .update({ can_manage_payroll: enabled })
    .eq("id", employeeId)
    .eq("role", "manager")
    .select("id");
  if (error) return fail(friendlyDbError(error));
  if (!data?.length) return fail("Không tìm thấy Quản lý này.");

  revalidatePayroll();
  return success(enabled ? "Đã cấp quyền bảng lương." : "Đã thu hồi quyền bảng lương.");
}
