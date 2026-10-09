"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireInventoryAccess, requireManager } from "@/lib/auth/session";
import { parseVnNumber } from "@/lib/inventory";
import { fail, friendlyDbError, success, type ActionState } from "@/lib/action-state";

export type SaveResult = { ok: boolean; message: string; id?: string };

function revalidateInventory() {
  revalidatePath("/inventory", "layout");
  revalidatePath("/");
}

// ---------------------------------------------------------------------
// KIỂM KÊ (QTV, QL, NV có quyền kho tại chi nhánh)
// ---------------------------------------------------------------------
const countSchema = z.object({
  branchId: z.uuid(),
  note: z.string().trim().max(500),
  lines: z
    .array(z.object({ itemId: z.uuid(), countedQty: z.number().min(0, "Số đếm phải từ 0 trở lên.") }))
    .min(1, "Chưa nhập số đếm cho nguyên liệu nào.")
    .max(1000),
});

export async function createStockCount(input: z.input<typeof countSchema>): Promise<SaveResult> {
  await requireInventoryAccess();
  const parsed = countSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_stock_count", {
    p_branch_id: parsed.data.branchId,
    p_note: parsed.data.note || null,
    p_lines: parsed.data.lines.map((l) => ({ item_id: l.itemId, counted_qty: l.countedQty })),
  });
  if (error) return { ok: false, message: friendlyDbError(error) };
  revalidateInventory();
  return { ok: true, message: "Đã lưu phiếu kiểm kê.", id: data };
}

// ---------------------------------------------------------------------
// PHIẾU XUẤT (QTV, QL, NV có quyền kho tại chi nhánh)
// ---------------------------------------------------------------------
const issueSchema = z
  .object({
    branchId: z.uuid(),
    kind: z.enum(["waste", "transfer", "other"]),
    toBranchId: z.uuid().nullable(),
    reason: z.string().trim().min(3, "Ghi lý do xuất kho (ít nhất 3 ký tự).").max(500),
    lines: z
      .array(z.object({ itemId: z.uuid(), quantity: z.number().positive("Số lượng phải lớn hơn 0."), unitName: z.string().trim().max(20) }))
      .min(1, "Phiếu xuất chưa có nguyên liệu nào.")
      .max(200),
  })
  .refine((v) => v.kind !== "transfer" || (v.toBranchId && v.toBranchId !== v.branchId), "Chọn chi nhánh nhận hàng.");

export async function createStockIssue(input: z.input<typeof issueSchema>): Promise<SaveResult> {
  await requireInventoryAccess();
  const parsed = issueSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ." };
  const v = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_stock_issue", {
    p_payload: {
      branch_id: v.branchId,
      kind: v.kind,
      to_branch_id: v.kind === "transfer" ? v.toBranchId : null,
      reason: v.reason,
      lines: v.lines.map((l) => ({ item_id: l.itemId, quantity: l.quantity, unit_name: l.unitName })),
    },
  });
  if (error) return { ok: false, message: friendlyDbError(error) };
  revalidateInventory();
  return { ok: true, message: "Đã lưu phiếu xuất.", id: data };
}

/** Hủy phiếu xuất (QTV / QL chi nhánh xuất) — cộng lại tồn kho. */
export async function cancelStockIssue(issueId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireManager();
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 3) return fail("Vui lòng kiểm tra lại.", { reason: "Ghi lý do (ít nhất 3 ký tự)." });
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_stock_issue", { p_issue_id: issueId, p_reason: reason });
  if (error) return fail(friendlyDbError(error));
  revalidateInventory();
  return success("Đã hủy phiếu xuất và cộng lại tồn kho.");
}

// ---------------------------------------------------------------------
// MỨC TỒN TỐI THIỂU (QTV / QL chi nhánh) — để trống = tắt cảnh báo
// ---------------------------------------------------------------------
export async function setStockMin(branchId: string, itemId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireManager();
  const raw = String(formData.get("min") ?? "").trim();
  const min = raw === "" ? null : parseVnNumber(raw);
  if (raw !== "" && (min === null || min < 0)) return fail("Vui lòng kiểm tra lại.", { min: "Nhập số từ 0 trở lên, hoặc để trống để tắt." });

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_stock_min", { p_branch_id: branchId, p_item_id: itemId, p_min: min });
  if (error) return fail(friendlyDbError(error));
  revalidateInventory();
  return success(min === null ? "Đã tắt cảnh báo tồn thấp." : "Đã lưu mức tồn tối thiểu.");
}
