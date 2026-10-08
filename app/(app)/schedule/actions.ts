"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireEmployee } from "@/lib/auth/session";
import { fail, friendlyDbError, success, zodFieldErrors, type ActionState } from "@/lib/action-state";

function revalidateSchedule() {
  revalidatePath("/schedule");
  revalidatePath("/schedule/manage");
}

const reason = z.string().trim().min(3, { message: "Nhập lý do (ít nhất 3 ký tự)." }).max(500, { message: "Lý do tối đa 500 ký tự." });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Chọn ngày." });
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "Nhập giờ hợp lệ." });
const uuid = (message: string) => z.uuid({ message });

const requestSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("leave"), reason, start_date: date, end_date: date })
    .refine((v) => v.end_date >= v.start_date, { path: ["end_date"], message: "Ngày kết thúc phải từ ngày bắt đầu trở đi." }),
  z.object({ kind: z.literal("late"), reason, shift_id: uuid("Chọn ca làm."), requested_time: time }),
  z.object({ kind: z.literal("early_leave"), reason, shift_id: uuid("Chọn ca làm."), requested_time: time }),
  z.object({
    kind: z.literal("swap"),
    reason,
    shift_id: uuid("Chọn ca của bạn."),
    target_employee_id: uuid("Chọn người nhận ca."),
    target_shift_id: z
      .string()
      .transform((v) => v || null)
      .pipe(z.uuid().nullable()),
  }),
]);

export async function createRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireEmployee();
  const str = (key: string) => String(formData.get(key) ?? "");
  const parsed = requestSchema.safeParse({
    kind: str("kind"),
    reason: str("reason"),
    start_date: str("start_date"),
    end_date: str("end_date") || str("start_date"),
    shift_id: str("shift_id"),
    requested_time: str("requested_time"),
    target_employee_id: str("target_employee_id"),
    target_shift_id: str("target_shift_id"),
  });
  if (!parsed.success) return fail("Vui lòng kiểm tra lại thông tin.", zodFieldErrors(parsed.error.issues));

  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_schedule_request", {
    p_kind: v.kind,
    p_reason: v.reason,
    p_start_date: v.kind === "leave" ? v.start_date : null,
    p_end_date: v.kind === "leave" ? v.end_date : null,
    p_shift_id: v.kind === "leave" ? null : v.shift_id,
    p_requested_time: v.kind === "late" || v.kind === "early_leave" ? v.requested_time : null,
    p_target_employee_id: v.kind === "swap" ? v.target_employee_id : null,
    p_target_shift_id: v.kind === "swap" ? v.target_shift_id : null,
  });
  if (error) return fail(friendlyDbError(error));

  revalidateSchedule();
  const notes = [
    data.status === "awaiting_peer" ? "Đã gửi cho người nhận ca. Sau khi họ đồng ý, quản lý sẽ duyệt." : "Đã gửi đơn, chờ quản lý duyệt.",
    data.is_urgent ? "Đơn được đánh dấu GẤP vì gửi sát giờ." : "",
    data.over_limit ? "Lưu ý: bạn đã vượt số lần cho phép trong tháng." : "",
  ];
  return success(notes.filter(Boolean).join(" "));
}

export async function cancelRequest(requestId: string): Promise<ActionState> {
  await requireEmployee();
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_schedule_request", { p_request_id: requestId });
  if (error) return fail(friendlyDbError(error));
  revalidateSchedule();
  return success("Đã hủy đơn.");
}

export async function respondSwap(requestId: string, accept: boolean): Promise<ActionState> {
  await requireEmployee();
  const supabase = await createClient();
  const { error } = await supabase.rpc("respond_swap_request", { p_request_id: requestId, p_accept: accept });
  if (error) return fail(friendlyDbError(error));
  revalidateSchedule();
  return success(accept ? "Đã đồng ý. Đơn chuyển cho quản lý duyệt." : "Đã từ chối yêu cầu đổi ca.");
}
