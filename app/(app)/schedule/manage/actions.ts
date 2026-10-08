"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, requireManager } from "@/lib/auth/session";
import { fail, friendlyDbError, success, zodFieldErrors, type ActionState } from "@/lib/action-state";

function revalidateSchedule() {
  revalidatePath("/schedule");
  revalidatePath("/schedule/manage");
  revalidatePath("/payroll", "layout");
}

const str = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "Giờ không hợp lệ." });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Ngày không hợp lệ." });
const nullableUuid = z
  .string()
  .transform((v) => v || null)
  .pipe(z.uuid().nullable());
const note = z
  .string()
  .max(200, { message: "Ghi chú tối đa 200 ký tự." })
  .transform((v) => v || null);

// =====================================================================
// CA LÀM
// =====================================================================
const shiftSchema = z
  .object({
    employee_id: z.uuid({ message: "Chọn nhân viên." }),
    work_date: date,
    start_time: time,
    end_time: time,
    template_id: nullableUuid,
    note,
  })
  .refine((v) => v.start_time !== v.end_time, { path: ["end_time"], message: "Giờ kết thúc phải khác giờ bắt đầu." });

function readShift(formData: FormData) {
  return shiftSchema.safeParse({
    employee_id: str(formData, "employee_id"),
    work_date: str(formData, "work_date"),
    start_time: str(formData, "start_time"),
    end_time: str(formData, "end_time"),
    template_id: str(formData, "template_id"),
    note: str(formData, "note"),
  });
}

export async function createShift(branchId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireManager();
  const parsed = readShift(formData);
  if (!parsed.success) return fail("Vui lòng kiểm tra lại thông tin.", zodFieldErrors(parsed.error.issues));

  const supabase = await createClient();
  const { error } = await supabase.from("shifts").insert({ ...parsed.data, branch_id: branchId }).select("id").single();
  if (error) return fail(friendlyDbError(error));
  revalidateSchedule();
  return success("Đã thêm ca (nháp). Nhớ bấm “Công bố” để nhân viên thấy.");
}

export async function updateShift(shiftId: string, published: boolean, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireManager();
  const parsed = readShift(formData);
  if (!parsed.success) return fail("Vui lòng kiểm tra lại thông tin.", zodFieldErrors(parsed.error.issues));

  // Ca đã công bố: chỉ đổi người làm / ghi chú (DB cũng chặn đổi ngày giờ)
  const values = published
    ? { employee_id: parsed.data.employee_id, note: parsed.data.note }
    : parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.from("shifts").update(values).eq("id", shiftId).select("id").maybeSingle();
  if (error) return fail(friendlyDbError(error));
  if (!data) return fail("Không tìm thấy ca hoặc bạn không có quyền sửa.");
  revalidateSchedule();
  return success("Đã lưu ca.");
}

export async function deleteShift(shiftId: string): Promise<ActionState> {
  await requireManager();
  const supabase = await createClient();
  const { data, error } = await supabase.from("shifts").delete().eq("id", shiftId).select("id");
  if (error) return fail(friendlyDbError(error));
  if (!data?.length) return fail("Không tìm thấy ca hoặc bạn không có quyền xóa.");
  revalidateSchedule();
  return success("Đã xóa ca nháp.");
}

export async function cancelShift(shiftId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireManager();
  const reason = str(formData, "cancel_reason");
  if (reason.length < 3) return fail("Vui lòng nhập lý do hủy.", { cancel_reason: "Nhập lý do (ít nhất 3 ký tự)." });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shifts")
    .update({ status: "cancelled", cancel_reason: reason })
    .eq("id", shiftId)
    .select("id")
    .maybeSingle();
  if (error) return fail(friendlyDbError(error));
  if (!data) return fail("Không tìm thấy ca hoặc bạn không có quyền hủy.");
  revalidateSchedule();
  return success("Đã hủy ca. Các đơn đang chờ của ca này đã được tự hủy.");
}

export async function publishWeek(branchId: string, weekStart: string): Promise<ActionState> {
  await requireManager();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("publish_week_shifts", { p_branch_id: branchId, p_week_start: weekStart });
  if (error) return fail(friendlyDbError(error));
  revalidateSchedule();
  return success(data ? `Đã công bố ${data} ca. Nhân viên đã thấy lịch.` : "Không có ca nháp nào để công bố.");
}

export async function copyWeek(branchId: string, fromWeek: string, toWeek: string): Promise<ActionState> {
  await requireManager();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("copy_week_shifts", { p_branch_id: branchId, p_from_week: fromWeek, p_to_week: toWeek });
  if (error) return fail(friendlyDbError(error));
  const result = data as { copied: number; skipped: number };
  revalidateSchedule();
  if (result.copied === 0 && result.skipped === 0) return fail("Tuần trước chưa có ca nào để sao chép.");
  return success(
    `Đã sao chép ${result.copied} ca (nháp)` +
      (result.skipped ? `, bỏ qua ${result.skipped} ca bị trùng giờ hoặc nhân viên không còn ở chi nhánh.` : ".")
  );
}

// =====================================================================
// MẪU CA
// =====================================================================
const templateSchema = z
  .object({
    name: z.string().min(1, { message: "Nhập tên ca." }).max(50, { message: "Tên tối đa 50 ký tự." }),
    start_time: time,
    end_time: time,
    sort_order: z.coerce.number().int().min(0).max(9999).default(0),
  })
  .refine((v) => v.start_time !== v.end_time, { path: ["end_time"], message: "Giờ kết thúc phải khác giờ bắt đầu." });

function readTemplate(formData: FormData) {
  return templateSchema.safeParse({
    name: str(formData, "name"),
    start_time: str(formData, "start_time"),
    end_time: str(formData, "end_time"),
    sort_order: str(formData, "sort_order") || "0",
  });
}

export async function createShiftTemplate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireManager();
  const branchId = str(formData, "branch_id");
  if (!z.uuid().safeParse(branchId).success) return fail("Vui lòng chọn chi nhánh.", { branch_id: "Chọn chi nhánh." });
  const parsed = readTemplate(formData);
  if (!parsed.success) return fail("Vui lòng kiểm tra lại thông tin.", zodFieldErrors(parsed.error.issues));

  const supabase = await createClient();
  const { error } = await supabase.from("shift_templates").insert({ ...parsed.data, branch_id: branchId }).select("id").single();
  if (error) return fail(error.code === "23505" ? "Chi nhánh đã có mẫu ca trùng tên." : friendlyDbError(error));
  revalidateSchedule();
  return success(`Đã tạo mẫu ca "${parsed.data.name}".`);
}

export async function updateShiftTemplate(templateId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireManager();
  const parsed = readTemplate(formData);
  if (!parsed.success) return fail("Vui lòng kiểm tra lại thông tin.", zodFieldErrors(parsed.error.issues));

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shift_templates")
    .update({ ...parsed.data, is_active: formData.get("is_active") === "on" })
    .eq("id", templateId)
    .select("id")
    .maybeSingle();
  if (error) return fail(error.code === "23505" ? "Chi nhánh đã có mẫu ca trùng tên." : friendlyDbError(error));
  if (!data) return fail("Bạn không có quyền sửa mẫu ca này.");
  revalidateSchedule();
  return success(`Đã lưu mẫu ca "${parsed.data.name}". Các ca đã xếp không bị thay đổi.`);
}

// =====================================================================
// DUYỆT ĐƠN
// =====================================================================
export async function reviewRequest(requestId: string, approve: boolean, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireManager();
  const noteText = str(formData, "review_note");
  if (!approve && noteText.length < 3) return fail("Vui lòng ghi lý do từ chối.", { review_note: "Nhập lý do (ít nhất 3 ký tự)." });

  const supabase = await createClient();
  const { error } = await supabase.rpc("review_schedule_request", {
    p_request_id: requestId,
    p_approve: approve,
    p_note: noteText || null,
    p_paid: actor.role === "admin" && formData.get("is_paid") === "on",
  });
  if (error) return fail(friendlyDbError(error));
  revalidateSchedule();
  return success(approve ? "Đã duyệt đơn." : "Đã từ chối đơn.");
}

export async function setLeavePaid(requestId: string, paid: boolean): Promise<ActionState> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_leave_paid", { p_request_id: requestId, p_paid: paid });
  if (error) return fail(friendlyDbError(error));
  revalidateSchedule();
  return success(paid ? "Đã đánh dấu nghỉ có lương." : "Đã chuyển thành nghỉ không lương.");
}

// =====================================================================
// CÀI ĐẶT ĐƠN (chỉ QTV)
// =====================================================================
const hours = (label: string) => z.coerce.number({ message: `${label} phải là số.` }).int().min(0, { message: "Tối thiểu 0." }).max(720, { message: "Tối đa 720 giờ." });
const perMonth = (label: string) => z.coerce.number({ message: `${label} phải là số.` }).int().min(0, { message: "Tối thiểu 0." }).max(31, { message: "Tối đa 31." });

const settingsSchema = z.object({
  leave_notice_hours: hours("Hạn báo nghỉ"),
  late_notice_hours: hours("Hạn báo trễ"),
  early_notice_hours: hours("Hạn báo về sớm"),
  swap_notice_hours: hours("Hạn báo đổi ca"),
  leave_days_per_month: perMonth("Số ngày nghỉ"),
  late_per_month: perMonth("Số lần trễ"),
  early_per_month: perMonth("Số lần về sớm"),
  swap_per_month: perMonth("Số lần đổi ca"),
});

export async function saveScheduleSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = settingsSchema.safeParse(Object.fromEntries(Object.keys(settingsSchema.shape).map((k) => [k, str(formData, k) || "0"])));
  if (!parsed.success) return fail("Vui lòng kiểm tra lại thông tin.", zodFieldErrors(parsed.error.issues));

  const supabase = await createClient();
  const { data, error } = await supabase.from("schedule_settings").update(parsed.data).eq("id", true).select("id");
  if (error) return fail(friendlyDbError(error));
  if (!data?.length) return fail("Bạn không có quyền sửa cài đặt.");
  revalidateSchedule();
  return success("Đã lưu cài đặt đơn xin phép.");
}
