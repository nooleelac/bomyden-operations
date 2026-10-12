"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireEmployee, requireManager } from "@/lib/auth/session";
import { getMyBranches } from "@/lib/branches";
import { HANDOVER_PHOTO_BUCKET } from "@/lib/handover-photos";
import { TASK_PHOTO_MAX_BYTES, TASK_PHOTO_TYPES } from "@/lib/task-photos";
import { fail, friendlyDbError, success, type ActionState } from "@/lib/action-state";
import { vnDateString } from "@/lib/time";

export type SaveResult = { ok: boolean; message: string; id?: string };

function revalidateHandover() {
  revalidatePath("/handover", "layout");
}

// ---------------------------------------------------------------------
// ẢNH: tải lên TỪNG ảnh ngay khi chụp (gửi cả phiếu một lần sẽ vượt giới hạn 4,5 MB của Vercel).
// Đường dẫn <chi nhánh>/<ngày>/<nhân viên>/<uuid> — hàm DB kiểm tra đúng chi nhánh & đúng người.
// Ảnh không được dùng trong phiếu nào sẽ tự xóa sau 1 ngày.
// ---------------------------------------------------------------------
export async function uploadHandoverPhoto(branchId: string, formData: FormData): Promise<{ ok: boolean; message: string; path?: string }> {
  const me = await requireEmployee();
  const branches = await getMyBranches(me);
  if (!branches.some((b) => b.id === branchId)) return { ok: false, message: "Bạn không thuộc chi nhánh này." };

  const photo = formData.get("photo");
  if (!(photo instanceof File) || photo.size === 0) return { ok: false, message: "Chưa chọn ảnh." };
  if (!TASK_PHOTO_TYPES.includes(photo.type)) return { ok: false, message: "Ảnh phải là JPG, PNG hoặc WEBP." };
  if (photo.size > TASK_PHOTO_MAX_BYTES) return { ok: false, message: "Ảnh quá lớn (tối đa 3,5 MB)." };

  const ext = photo.type === "image/png" ? "png" : photo.type === "image/webp" ? "webp" : "jpg";
  const path = `${branchId}/${vnDateString()}/${me.id}/${randomUUID()}.${ext}`;
  const admin = createAdminClient();
  const { error } = await admin.storage
    .from(HANDOVER_PHOTO_BUCKET)
    .upload(path, Buffer.from(await photo.arrayBuffer()), { contentType: photo.type, upsert: false });
  if (error) return { ok: false, message: "Không tải được ảnh lên. Vui lòng thử lại." };
  return { ok: true, message: "", path };
}

// ---------------------------------------------------------------------
// TẠO PHIẾU BÀN GIAO
// ---------------------------------------------------------------------
const handoverSchema = z.object({
  branchId: z.uuid(),
  note: z.string().trim().max(1000, "Ghi chú tối đa 1000 ký tự."),
  lines: z
    .array(
      z.object({
        itemId: z.uuid(),
        quantity: z.number().min(0, "Số lượng phải từ 0 trở lên.").max(1_000_000),
        photoPath: z.string().max(300).nullable(),
      })
    )
    .min(1, "Chưa nhập món nào.")
    .max(200),
});

export async function createHandover(input: z.input<typeof handoverSchema>): Promise<SaveResult> {
  await requireEmployee();
  const parsed = handoverSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_shift_handover", {
    p_branch_id: parsed.data.branchId,
    p_note: parsed.data.note || null,
    p_lines: parsed.data.lines.map((l) => ({ item_id: l.itemId, quantity: l.quantity, photo_path: l.photoPath })),
  });
  if (error) return { ok: false, message: friendlyDbError(error) };
  revalidateHandover();
  return { ok: true, message: "Đã gửi phiếu bàn giao.", id: data };
}

// ---------------------------------------------------------------------
// NHẬN CA: xác nhận / báo sai lệch
// ---------------------------------------------------------------------
export async function receiveHandover(handoverId: string, ok: boolean, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireEmployee();
  const note = String(formData.get("note") ?? "").trim().slice(0, 1000);
  if (!ok && note.length < 3) {
    return fail("Vui lòng ghi rõ sai lệch.", { note: "Ghi rõ món nào, thực tế bao nhiêu (ít nhất 3 ký tự)." });
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("receive_shift_handover", { p_handover_id: handoverId, p_ok: ok, p_note: note || undefined });
  if (error) return fail(friendlyDbError(error));
  revalidateHandover();
  return success(ok ? "Đã xác nhận nhận ca." : "Đã báo sai lệch cho Quản lý.");
}

// ---------------------------------------------------------------------
// THIẾT LẬP DANH SÁCH MÓN (QTV / QL chi nhánh — RLS kiểm tra quyền)
// ---------------------------------------------------------------------
export async function addHandoverItem(branchId: string, itemId: string, unit: string): Promise<SaveResult> {
  await requireManager();
  if (!z.uuid().safeParse(branchId).success || !z.uuid().safeParse(itemId).success) return { ok: false, message: "Dữ liệu không hợp lệ." };
  const supabase = await createClient();
  const { data: last } = await supabase
    .from("handover_items")
    .select("sort_order")
    .eq("branch_id", branchId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase
    .from("handover_items")
    .insert({ branch_id: branchId, item_id: itemId, unit: unit.trim(), sort_order: (last?.sort_order ?? -1) + 1 });
  if (error) {
    if (error.code === "23505") return { ok: false, message: "Món này đã có trong danh sách." };
    return { ok: false, message: friendlyDbError(error) };
  }
  revalidateHandover();
  return { ok: true, message: "Đã thêm vào danh sách bàn giao." };
}

export async function updateHandoverItem(id: string, patch: { unit?: string; requiresPhoto?: boolean }): Promise<SaveResult> {
  await requireManager();
  const supabase = await createClient();
  const { error } = await supabase
    .from("handover_items")
    .update({
      ...(patch.unit !== undefined && { unit: patch.unit.trim() }),
      ...(patch.requiresPhoto !== undefined && { requires_photo: patch.requiresPhoto }),
    })
    .eq("id", id);
  if (error) return { ok: false, message: friendlyDbError(error) };
  revalidateHandover();
  return { ok: true, message: "Đã lưu." };
}

export async function removeHandoverItem(id: string): Promise<SaveResult> {
  await requireManager();
  const supabase = await createClient();
  const { error, count } = await supabase.from("handover_items").delete({ count: "exact" }).eq("id", id);
  if (error || !count) return { ok: false, message: friendlyDbError(error) };
  revalidateHandover();
  return { ok: true, message: "Đã bỏ khỏi danh sách." };
}

/** Đổi chỗ món với món liền trên / liền dưới. */
export async function moveHandoverItem(id: string, direction: -1 | 1): Promise<SaveResult> {
  await requireManager();
  const supabase = await createClient();
  const { data: row } = await supabase.from("handover_items").select("branch_id").eq("id", id).maybeSingle();
  if (!row) return { ok: false, message: "Không tìm thấy món." };
  const { data: list } = await supabase
    .from("handover_items")
    .select("id, sort_order")
    .eq("branch_id", row.branch_id)
    .order("sort_order")
    .order("created_at");
  const ids = (list ?? []).map((r) => r.id);
  const from = ids.indexOf(id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= ids.length) return { ok: true, message: "" };
  [ids[from], ids[to]] = [ids[to], ids[from]];
  // Đánh lại số thứ tự cho những dòng bị lệch
  const current = new Map((list ?? []).map((r) => [r.id, r.sort_order]));
  const changed = ids.map((rowId, index) => ({ rowId, index })).filter(({ rowId, index }) => current.get(rowId) !== index);
  for (const { rowId, index } of changed) {
    const { error } = await supabase.from("handover_items").update({ sort_order: index }).eq("id", rowId);
    if (error) return { ok: false, message: friendlyDbError(error) };
  }
  revalidateHandover();
  return { ok: true, message: "" };
}
