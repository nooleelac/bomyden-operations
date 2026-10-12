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

// Xếp nhanh: nhiều ngày × (mẫu ca → nhiều nhân viên), tạo ca nháp hàng loạt
const bulkSchema = z.object({
  dates: z.array(date).min(1, { message: "Chọn ít nhất 1 ngày." }).max(62, { message: "Tối đa 62 ngày mỗi lần." }),
  assignments: z
    .array(z.object({ template_id: z.uuid(), employee_ids: z.array(z.uuid()).min(1) }))
    .min(1, { message: "Chưa tick nhân viên nào." }),
});

export async function bulkCreateShifts(branchId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireManager();
  let input: unknown;
  try {
    input = JSON.parse(str(formData, "payload"));
  } catch {
    return fail("Dữ liệu không hợp lệ.");
  }
  const parsed = bulkSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ.");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bulk_create_shifts", {
    p_branch_id: branchId,
    p_dates: parsed.data.dates,
    p_assignments: parsed.data.assignments,
  });
  if (error) return fail(friendlyDbError(error));
  const result = data as { created: number; skipped: number };
  revalidateSchedule();
  if (result.created === 0) return fail(`Không tạo được ca nào — ${result.skipped} ca bị trùng giờ với ca đã có hoặc nhân viên không còn ở chi nhánh.`);
  return success(
    `Đã xếp ${result.created} ca (nháp)` +
      (result.skipped ? `, bỏ qua ${result.skipped} ca bị trùng giờ hoặc đã xếp trước đó.` : ".") +
      " Nhớ bấm “Công bố” để nhân viên thấy."
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

/** Xóa mẫu ca: chưa dùng → xóa hẳn; đã có ca / đăng ký dùng → ẩn (lịch cũ giữ nguyên). */
export async function deleteShiftTemplate(templateId: string, name: string): Promise<ActionState> {
  await requireManager();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delete_shift_template", { p_template_id: templateId });
  if (error) return fail(friendlyDbError(error));
  revalidateSchedule();
  return success(
    data === "archived"
      ? `Đã xóa mẫu ca "${name}". Các ca đã xếp trước đây vẫn giữ nguyên.`
      : `Đã xóa mẫu ca "${name}".`
  );
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
// ĐĂNG KÝ CA CỦA NHÂN VIÊN
// =====================================================================
export async function reviewRegistrations(approve: boolean, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireManager();
  const ids = formData.getAll("ids").map(String);
  if (ids.length === 0 || !ids.every((id) => z.uuid().safeParse(id).success)) return fail("Chưa chọn đăng ký nào.");
  const noteText = str(formData, "review_note");
  if (!approve && noteText.length < 3) return fail("Vui lòng ghi lý do từ chối.", { review_note: "Nhập lý do (ít nhất 3 ký tự)." });

  // QL sửa giờ (chỉ khi duyệt từng đăng ký)
  const startText = str(formData, "start_time");
  const endText = str(formData, "end_time");
  const edited = Boolean(startText || endText);
  const publish = approve && formData.get("publish") === "1";
  if (edited && (!approve || ids.length !== 1 || !time.safeParse(startText).success || !time.safeParse(endText).success || startText === endText)) {
    return fail("Giờ vào / giờ ra không hợp lệ.", { end_time: "Chọn giờ vào và giờ ra khác nhau." });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("review_shift_registrations", {
    p_ids: ids,
    p_approve: approve,
    p_note: noteText || null,
    p_start: edited ? startText : null,
    p_end: edited ? endText : null,
    p_publish: publish,
  });
  if (error) return fail(friendlyDbError(error));
  const result = data as { done: number; skipped: number };
  revalidateSchedule();
  if (!approve) return success(`Đã từ chối ${result.done} đăng ký.`);
  const after = publish ? " và công bố — nhân viên đã thấy trên lịch." : ". Nhớ bấm “Công bố” ở tab Xếp lịch.";
  if (edited && result.done === 1) return success(`Đã duyệt ca ${startText}–${endText}${publish ? "" : " (ca nháp)"}. Nhân viên sẽ được báo giờ đã chỉnh${after}`);
  if (result.done === 0 && result.skipped) return fail(`Không duyệt được — ${result.skipped} đăng ký bị trùng giờ với ca đã có.`);
  return success(
    `Đã duyệt ${result.done} đăng ký ${publish ? "và công bố" : "thành ca nháp"}` +
      (result.skipped ? `, ${result.skipped} đăng ký bị trùng giờ với ca đã có nên vẫn để chờ.` : ".") +
      (publish ? " Nhân viên đã thấy ca trên lịch." : " Nhớ bấm “Công bố” ở tab Xếp lịch.")
  );
}

export async function setSelfSchedule(employeeId: string, enabled: boolean): Promise<ActionState> {
  await requireManager();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_self_schedule", { p_employee_id: employeeId, p_enabled: enabled });
  if (error) return fail(friendlyDbError(error));
  revalidateSchedule();
  return success(enabled ? "Đã cho phép tự đăng ký ca." : "Đã tắt tự đăng ký ca.");
}

// =====================================================================
// ĐỊNH MỨC NHÂN SỰ THEO KHUNG GIỜ
// =====================================================================
const staffingSchema = z
  .object({
    weekdays: z.array(z.coerce.number().int().min(0).max(6)).min(1, { message: "Chọn ít nhất 1 thứ." }),
    start_time: time,
    end_time: time,
    headcount: z.coerce.number({ message: "Số người phải là số." }).int().min(1, { message: "Tối thiểu 1 người." }).max(50, { message: "Tối đa 50 người." }),
  })
  .refine((v) => v.start_time !== v.end_time, { path: ["end_time"], message: "Giờ kết thúc phải khác giờ bắt đầu." });

export async function addStaffingRequirement(branchId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireManager();
  const parsed = staffingSchema.safeParse({
    weekdays: formData.getAll("weekdays").map(String),
    start_time: str(formData, "start_time"),
    end_time: str(formData, "end_time"),
    headcount: str(formData, "headcount"),
  });
  if (!parsed.success) return fail("Vui lòng kiểm tra lại thông tin.", zodFieldErrors(parsed.error.issues));

  const supabase = await createClient();
  const { error } = await supabase.from("staffing_requirements").insert({ branch_id: branchId, ...parsed.data });
  if (error) return fail(friendlyDbError(error));
  revalidateSchedule();
  return success("Đã thêm định mức.");
}

export async function deleteStaffingRequirement(id: string): Promise<ActionState> {
  await requireManager();
  const supabase = await createClient();
  const { data, error } = await supabase.from("staffing_requirements").delete().eq("id", id).select("id");
  if (error) return fail(friendlyDbError(error));
  if (!data?.length) return fail("Bạn không có quyền xóa định mức này.");
  revalidateSchedule();
  return success("Đã xóa định mức.");
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
  register_deadline_days: z.coerce.number({ message: "Số ngày phải là số." }).int().min(0, { message: "Tối thiểu 0." }).max(60, { message: "Tối đa 60 ngày." }),
});

// Khung giờ NV tự đăng ký ca (form nhập giờ, lưu phút)
const regHours = (label: string, min: number, max: number) =>
  z.coerce
    .number({ message: `${label} phải là số.` })
    .min(min, { message: `Tối thiểu ${min} tiếng.` })
    .max(max, { message: `Tối đa ${max} tiếng.` })
    .refine((v) => Number.isInteger(v * 2), { message: "Nhập theo bước 0,5 tiếng." })
    .transform((v) => Math.round(v * 60));
const registerSchema = z
  .object({
    register_earliest: time,
    register_latest: time,
    register_step_minutes: z.coerce.number().refine((v) => [15, 30, 60].includes(v), { message: "Bước phút không hợp lệ." }),
    register_min_minutes: regHours("Ca ngắn nhất", 0.5, 16),
    register_max_minutes: regHours("Ca dài nhất", 0.5, 16),
    register_max_per_day: z.coerce.number().int().min(1, { message: "Tối thiểu 1." }).max(3, { message: "Tối đa 3." }),
    register_max_day_minutes: regHours("Tổng giờ/ngày", 0.5, 24),
  })
  .refine((v) => v.register_earliest !== v.register_latest, { path: ["register_latest"], message: "Giờ ra muộn nhất phải khác giờ vào sớm nhất." })
  .refine((v) => [v.register_earliest, v.register_latest].every((t) => Number(t.slice(3, 5)) % v.register_step_minutes === 0), {
    path: ["register_earliest"],
    message: "Giờ phải tròn theo bước phút.",
  })
  .refine((v) => v.register_max_minutes >= v.register_min_minutes, { path: ["register_max_minutes"], message: "Phải lớn hơn hoặc bằng ca ngắn nhất." })
  .refine((v) => v.register_max_day_minutes >= v.register_min_minutes, { path: ["register_max_day_minutes"], message: "Phải lớn hơn hoặc bằng ca ngắn nhất." });

/** Đọc các ô quy định khung giờ (nhập theo tiếng) → phút; lỗi trả theo tên ô trên form */
function parseRegisterRules(formData: FormData) {
  const reg = registerSchema.safeParse({
    register_earliest: str(formData, "register_earliest"),
    register_latest: str(formData, "register_latest"),
    register_step_minutes: str(formData, "register_step_minutes"),
    register_min_minutes: str(formData, "register_min_hours").replace(",", "."),
    register_max_minutes: str(formData, "register_max_hours").replace(",", "."),
    register_max_per_day: str(formData, "register_max_per_day"),
    register_max_day_minutes: str(formData, "register_max_day_hours").replace(",", "."),
  });
  if (reg.success) return { data: reg.data, errors: null };
  const errors = Object.fromEntries(
    Object.entries(zodFieldErrors(reg.error.issues)).map(([k, v]) => [k.replace("_minutes", "_hours").replace("register_step_hours", "register_step_minutes"), v])
  );
  return { data: null, errors };
}

export async function saveScheduleSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = settingsSchema.safeParse(Object.fromEntries(Object.keys(settingsSchema.shape).map((k) => [k, str(formData, k) || "0"])));
  const reg = parseRegisterRules(formData);
  if (!parsed.success || !reg.data) {
    return fail("Vui lòng kiểm tra lại thông tin.", { ...(parsed.success ? {} : zodFieldErrors(parsed.error.issues)), ...reg.errors });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.from("schedule_settings").update({ ...parsed.data, ...reg.data }).eq("id", true).select("id");
  if (error) return fail(friendlyDbError(error));
  if (!data?.length) return fail("Bạn không có quyền sửa cài đặt.");
  revalidateSchedule();
  return success("Đã lưu cài đặt lịch & đơn.");
}

// Khung giờ tự đăng ký riêng cho 1 chi nhánh (chỉ QTV)
export async function saveBranchRegisterRules(branchId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  if (!z.uuid().safeParse(branchId).success) return fail("Chi nhánh không hợp lệ.");
  const reg = parseRegisterRules(formData);
  if (!reg.data) return fail("Vui lòng kiểm tra lại thông tin.", reg.errors);

  const supabase = await createClient();
  const { error } = await supabase.from("branch_register_rules").upsert({ branch_id: branchId, ...reg.data }, { onConflict: "branch_id" });
  if (error) return fail(friendlyDbError(error));
  revalidateSchedule();
  return success("Đã lưu khung giờ riêng cho chi nhánh.");
}

export async function deleteBranchRegisterRules(branchId: string): Promise<ActionState> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("branch_register_rules").delete().eq("branch_id", branchId);
  if (error) return fail(friendlyDbError(error));
  revalidateSchedule();
  return success("Chi nhánh đã quay về dùng khung giờ mặc định.");
}
