"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireEmployee } from "@/lib/auth/session";
import { fail, friendlyDbError, success, type ActionState } from "@/lib/action-state";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const itemsSchema = z
  .array(z.object({ work_date: date, template_id: z.uuid().nullable() }))
  .max(62 * 10);

export async function saveMyRegistrations(branchId: string, from: string, to: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireEmployee();
  if (!me.self_schedule) return fail("Bạn chưa được bật quyền tự đăng ký ca. Hãy hỏi quản lý.");
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("payload") ?? "[]"));
  } catch {
    return fail("Dữ liệu không hợp lệ.");
  }
  const parsed = itemsSchema.safeParse(raw);
  if (!parsed.success || !date.safeParse(from).success || !date.safeParse(to).success) return fail("Dữ liệu không hợp lệ.");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_shift_registrations", {
    p_branch_id: branchId,
    p_from: from,
    p_to: to,
    p_items: parsed.data,
  });
  if (error) return fail(friendlyDbError(error));
  const result = data as { saved: number; locked: number };
  revalidatePath("/schedule/register");
  revalidatePath("/schedule/manage");
  return success(
    (result.saved ? `Đã gửi ${result.saved} đăng ký. Quản lý sẽ duyệt và xếp lịch.` : "Đã lưu (không còn đăng ký nào đang chờ trong khoảng này).") +
      (result.locked ? ` ${result.locked} ngày đã quá hạn nên không đổi được.` : "")
  );
}
