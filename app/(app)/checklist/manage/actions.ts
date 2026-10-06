"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/auth/session";
import { PRIORITIES, TASK_CATEGORIES, parseMonthDays } from "@/lib/checklist";
import { fail, friendlyDbError, success, zodFieldErrors, type ActionState } from "@/lib/action-state";

function revalidateChecklist() {
  revalidatePath("/checklist");
  revalidatePath("/checklist/manage");
}

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "Giờ không hợp lệ." });

const templateSchema = z
  .object({
    title: z.string().trim().min(1, { message: "Vui lòng nhập tên công việc." }).max(150),
    description: z
      .string()
      .trim()
      .max(1000, { message: "Hướng dẫn tối đa 1000 ký tự." })
      .transform((v) => v || null),
    category: z.enum(TASK_CATEGORIES, { message: "Nhóm công việc không hợp lệ." }),
    priority: z.enum(PRIORITIES as [string, ...string[]], { message: "Mức độ không hợp lệ." }),
    start_time: time,
    due_time: time,
    frequency: z.enum(["daily", "weekly", "monthly"], { message: "Tần suất không hợp lệ." }),
    weekdays: z.array(z.coerce.number().int().min(1).max(7)),
    month_days: z.string().transform((value, ctx) => {
      const days = parseMonthDays(value);
      if (days === null) {
        ctx.addIssue({ code: "custom", message: "Ngày trong tháng phải là số 1–31, cách nhau bởi dấu phẩy." });
        return z.NEVER;
      }
      return days;
    }),
    requires_photo: z.boolean(),
    requires_note: z.boolean(),
    primary_employee_id: z.uuid({ message: "Vui lòng chọn người phụ trách chính." }),
    backup_employee_id: z
      .string()
      .transform((v) => v || null)
      .pipe(z.uuid().nullable()),
    sort_order: z.coerce.number().int().min(0).max(9999).default(0),
  })
  .refine((v) => v.due_time > v.start_time, { path: ["due_time"], message: "Hạn chót phải sau giờ bắt đầu." })
  .refine((v) => v.frequency !== "weekly" || v.weekdays.length > 0, { path: ["weekdays"], message: "Chọn ít nhất một thứ." })
  .refine((v) => v.frequency !== "monthly" || v.month_days.length > 0, { path: ["month_days"], message: "Nhập ít nhất một ngày." })
  .refine((v) => v.backup_employee_id !== v.primary_employee_id, {
    path: ["backup_employee_id"],
    message: "Người thay thế phải khác người chính.",
  });

function readTemplate(formData: FormData) {
  const str = (key: string) => String(formData.get(key) ?? "");
  return templateSchema.safeParse({
    title: str("title"),
    description: str("description"),
    category: str("category"),
    priority: str("priority"),
    start_time: str("start_time"),
    due_time: str("due_time"),
    frequency: str("frequency"),
    weekdays: formData.getAll("weekdays").map(String),
    month_days: str("month_days"),
    requires_photo: formData.get("requires_photo") === "on",
    requires_note: formData.get("requires_note") === "on",
    primary_employee_id: str("primary_employee_id"),
    backup_employee_id: str("backup_employee_id"),
    sort_order: str("sort_order") || "0",
  });
}

export async function createTemplate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireManager();
  const branchId = String(formData.get("branch_id") ?? "");
  const parsed = readTemplate(formData);
  if (!z.uuid().safeParse(branchId).success) return fail("Vui lòng chọn chi nhánh.", { branch_id: "Chọn chi nhánh." });
  if (!parsed.success) return fail("Vui lòng kiểm tra lại thông tin.", zodFieldErrors(parsed.error.issues));

  const supabase = await createClient();
  const { error } = await supabase
    .from("task_templates")
    .insert({ ...parsed.data, priority: parsed.data.priority as never, branch_id: branchId })
    .select("id")
    .single();
  if (error) return fail(friendlyDbError(error));

  // Sinh luôn việc hôm nay cho mẫu mới
  await supabase.rpc("ensure_task_instances");
  revalidateChecklist();
  return success(`Đã tạo công việc "${parsed.data.title}".`);
}

export async function updateTemplate(templateId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireManager();
  const parsed = readTemplate(formData);
  if (!parsed.success) return fail("Vui lòng kiểm tra lại thông tin.", zodFieldErrors(parsed.error.issues));

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("task_templates")
    .update({ ...parsed.data, priority: parsed.data.priority as never, is_active: formData.get("is_active") === "on" })
    .eq("id", templateId)
    .select("id")
    .maybeSingle();
  if (error) return fail(friendlyDbError(error));
  if (!data) return fail("Bạn không có quyền sửa công việc này.");

  await supabase.rpc("ensure_task_instances");
  revalidateChecklist();
  return success(`Đã cập nhật "${parsed.data.title}". Thay đổi áp dụng cho các việc chưa làm từ hôm nay.`);
}

export async function reopenTask(instanceId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireManager();
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 3) return fail("Vui lòng nhập lý do.", { reason: "Nhập lý do (ít nhất 3 ký tự)." });

  const supabase = await createClient();
  const { error } = await supabase.rpc("reopen_task_instance", { p_instance_id: instanceId, p_reason: reason });
  if (error) return fail(friendlyDbError(error));

  revalidateChecklist();
  return success("Đã mở lại công việc. Nhân viên sẽ thấy yêu cầu làm lại.");
}
