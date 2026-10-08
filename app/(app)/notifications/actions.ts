"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireEmployee } from "@/lib/auth/session";
import { fail, friendlyDbError, success, type ActionState } from "@/lib/action-state";

const subscriptionSchema = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(1000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

/** Lưu thiết bị nhận thông báo cho người đang đăng nhập. */
export async function savePushSubscription(subscription: unknown, userAgent: string): Promise<ActionState> {
  await requireEmployee();
  const parsed = subscriptionSchema.safeParse(subscription);
  if (!parsed.success) return fail("Thông tin thiết bị không hợp lệ.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_push_subscription", {
    p_endpoint: parsed.data.endpoint,
    p_p256dh: parsed.data.keys.p256dh,
    p_auth: parsed.data.keys.auth,
    p_user_agent: userAgent.slice(0, 500),
  });
  if (error) return fail(friendlyDbError(error));
  return success("Đã bật thông báo trên thiết bị này.");
}

/** Bỏ thiết bị (tắt thông báo hoặc đăng xuất). */
export async function removePushSubscription(endpoint: string): Promise<ActionState> {
  await requireEmployee();
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_push_subscription", { p_endpoint: endpoint });
  if (error) return fail(friendlyDbError(error));
  return success("Đã tắt thông báo trên thiết bị này.");
}

export async function markAllNotificationsRead(): Promise<void> {
  await requireEmployee();
  const supabase = await createClient();
  await supabase.rpc("mark_notifications_read", {});
  revalidatePath("/", "layout");
}
