import "server-only";

import { createClient } from "@/lib/supabase/server";

export type PreviousQty = { quantity: number; unit: string; at: string };

/**
 * Số lượng bàn giao gần nhất của từng món (trước thời điểm `before`, nếu có).
 * Mỗi phiếu chỉ gồm món của một người → tìm lần gần nhất của TỪNG món trong các phiếu gần đây.
 */
export async function loadPreviousQuantities(branchId: string, before?: string): Promise<Map<string, PreviousQty>> {
  const supabase = await createClient();
  let query = supabase
    .from("shift_handovers")
    .select("created_at, shift_handover_lines(handover_item_id, quantity, unit)")
    .eq("branch_id", branchId)
    .order("created_at", { ascending: false })
    .limit(40);
  if (before) query = query.lt("created_at", before);
  const { data } = await query;

  const result = new Map<string, PreviousQty>();
  for (const h of data ?? []) {
    for (const l of h.shift_handover_lines) {
      if (l.handover_item_id && !result.has(l.handover_item_id)) {
        result.set(l.handover_item_id, { quantity: Number(l.quantity), unit: l.unit, at: h.created_at });
      }
    }
  }
  return result;
}

/** Quyền bàn giao / nhận của người đang đăng nhập (đọc qua RLS). */
export async function loadMyHandoverRights(employeeId: string): Promise<{ itemIds: Set<string>; receiverBranches: Set<string> }> {
  const supabase = await createClient();
  const [{ data: items }, { data: receivers }] = await Promise.all([
    supabase.from("handover_item_staff").select("handover_item_id").eq("employee_id", employeeId),
    supabase.from("handover_receivers").select("branch_id").eq("employee_id", employeeId),
  ]);
  return {
    itemIds: new Set((items ?? []).map((r) => r.handover_item_id)),
    receiverBranches: new Set((receivers ?? []).map((r) => r.branch_id)),
  };
}

/** Khớp private.can_receive_handover ở DB (chỉ để ẩn / hiện nút — DB vẫn kiểm tra lại). */
export function canReceive(
  handover: { branch_id: string; handed_by: string; lineItemIds: (string | null)[] },
  me: { id: string; itemIds: Set<string>; receiverBranches: Set<string> }
): boolean {
  if (handover.handed_by === me.id) return false;
  return me.receiverBranches.has(handover.branch_id) || handover.lineItemIds.some((id) => id !== null && me.itemIds.has(id));
}
