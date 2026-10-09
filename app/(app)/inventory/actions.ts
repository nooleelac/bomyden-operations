"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, requireManager } from "@/lib/auth/session";
import { parseVnNumber } from "@/lib/inventory";
import { fail, friendlyDbError, success, zodFieldErrors, type ActionState } from "@/lib/action-state";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function revalidateInventory() {
  revalidatePath("/inventory", "layout");
}

// ---------------------------------------------------------------------
// ĐIỀU CHỈNH TỒN (QTV / QL chi nhánh)
// ---------------------------------------------------------------------
export async function adjustStock(branchId: string, itemId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireManager();
  const quantity = parseVnNumber(str(formData, "quantity"));
  const reason = str(formData, "reason");
  if (quantity === null || quantity < 0) return fail("Vui lòng kiểm tra lại.", { quantity: "Nhập số tồn thực tế (từ 0 trở lên)." });
  if (reason.length < 3) return fail("Vui lòng kiểm tra lại.", { reason: "Ghi lý do (ít nhất 3 ký tự)." });

  const supabase = await createClient();
  const { error } = await supabase.rpc("adjust_stock", {
    p_branch_id: branchId,
    p_item_id: itemId,
    p_new_quantity: quantity,
    p_reason: reason,
  });
  if (error) return fail(friendlyDbError(error));
  revalidateInventory();
  return success("Đã điều chỉnh tồn kho.");
}

// ---------------------------------------------------------------------
// HỦY PHIẾU NHẬP (QTV / QL chi nhánh)
// ---------------------------------------------------------------------
export async function cancelReceipt(receiptId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireManager();
  const reason = str(formData, "reason");
  if (reason.length < 3) return fail("Vui lòng kiểm tra lại.", { reason: "Ghi lý do (ít nhất 3 ký tự)." });
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_stock_receipt", { p_receipt_id: receiptId, p_reason: reason });
  if (error) return fail(friendlyDbError(error));
  revalidateInventory();
  return success("Đã hủy phiếu nhập và trừ lại tồn kho.");
}

// ---------------------------------------------------------------------
// NGUYÊN LIỆU (QTV / QL)
// ---------------------------------------------------------------------
const unitRow = z.object({
  name: z.string().trim().min(1).max(20),
  factor: z.number().positive("Hệ số quy đổi phải lớn hơn 0."),
});

const itemSchema = z.object({
  name: z.string().trim().min(1, "Nhập tên nguyên liệu.").max(150),
  category: z.string().trim().min(1).max(50),
  base_unit: z.string().trim().min(1, "Nhập đơn vị kho.").max(20),
  is_active: z.boolean(),
});

/** Tạo / sửa nguyên liệu kèm danh sách đơn vị quy đổi (gửi dạng "tên=hệ số" mỗi dòng). */
export async function saveItem(itemId: string | null, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireManager();
  const parsed = itemSchema.safeParse({
    name: str(formData, "name"),
    category: str(formData, "category") || "Khác",
    base_unit: str(formData, "base_unit"),
    is_active: itemId ? formData.get("is_active") === "on" : true,
  });
  if (!parsed.success) return fail("Vui lòng kiểm tra lại thông tin.", zodFieldErrors(parsed.error.issues));

  const units: { name: string; factor: number }[] = [];
  const names = formData.getAll("unit_name").map(String);
  const factors = formData.getAll("unit_factor").map(String);
  for (let i = 0; i < names.length; i++) {
    if (!names[i].trim() && !factors[i]?.trim()) continue;
    const row = unitRow.safeParse({ name: names[i], factor: parseVnNumber(factors[i] ?? "") ?? 0 });
    if (!row.success) return fail("Đơn vị quy đổi chưa hợp lệ.", { units: `Dòng ${i + 1}: cần tên đơn vị và hệ số > 0.` });
    if (row.data.name.toLowerCase() === parsed.data.base_unit.toLowerCase()) continue;
    if (units.some((u) => u.name.toLowerCase() === row.data.name.toLowerCase())) {
      return fail("Đơn vị quy đổi bị trùng.", { units: `Đơn vị "${row.data.name}" bị nhập 2 lần.` });
    }
    units.push(row.data);
  }

  const supabase = await createClient();
  let id = itemId;
  if (id) {
    const { data, error } = await supabase.from("inventory_items").update(parsed.data).eq("id", id).select("id");
    if (error) return fail(error.code === "23505" ? "Đã có nguyên liệu trùng tên." : friendlyDbError(error));
    if (!data?.length) return fail("Không tìm thấy nguyên liệu hoặc bạn không có quyền.");
  } else {
    const { data, error } = await supabase.from("inventory_items").insert(parsed.data).select("id").single();
    if (error) return fail(error.code === "23505" ? "Đã có nguyên liệu trùng tên." : friendlyDbError(error));
    id = data.id;
  }

  // Đồng bộ đơn vị quy đổi: xóa cái bị bỏ, cập nhật/thêm cái còn lại
  const { data: existing } = await supabase.from("inventory_item_units").select("id, unit_name").eq("item_id", id);
  const keep = new Set(units.map((u) => u.name.toLowerCase()));
  const removeIds = (existing ?? []).filter((u) => !keep.has(u.unit_name.toLowerCase())).map((u) => u.id);
  if (removeIds.length) {
    const { error } = await supabase.from("inventory_item_units").delete().in("id", removeIds);
    if (error) return fail(friendlyDbError(error));
  }
  for (const unit of units) {
    const match = (existing ?? []).find((u) => u.unit_name.toLowerCase() === unit.name.toLowerCase());
    const { error } = match
      ? await supabase.from("inventory_item_units").update({ unit_name: unit.name, factor: unit.factor }).eq("id", match.id)
      : await supabase.from("inventory_item_units").insert({ item_id: id, unit_name: unit.name, factor: unit.factor });
    if (error) return fail(friendlyDbError(error));
  }

  revalidateInventory();
  return success(itemId ? "Đã lưu nguyên liệu." : "Đã thêm nguyên liệu.");
}

/** Xóa 1 ghi nhớ "tên trên hóa đơn → nguyên liệu" (khi app nhớ sai). */
export async function deleteAlias(aliasId: string): Promise<ActionState> {
  await requireManager();
  const supabase = await createClient();
  const { error } = await supabase.from("inventory_aliases").delete().eq("id", aliasId);
  if (error) return fail(friendlyDbError(error));
  revalidateInventory();
  return success("Đã xóa ghi nhớ.");
}

// ---------------------------------------------------------------------
// NHÀ CUNG CẤP (QTV / QL)
// ---------------------------------------------------------------------
const supplierSchema = z.object({
  name: z.string().trim().min(1, "Nhập tên nhà cung cấp.").max(150),
  phone: z.string().trim().max(30).nullable(),
  address: z.string().trim().max(300).nullable(),
  note: z.string().trim().max(500).nullable(),
  is_active: z.boolean(),
});

export async function saveSupplier(supplierId: string | null, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireManager();
  const parsed = supplierSchema.safeParse({
    name: str(formData, "name"),
    phone: str(formData, "phone") || null,
    address: str(formData, "address") || null,
    note: str(formData, "note") || null,
    is_active: supplierId ? formData.get("is_active") === "on" : true,
  });
  if (!parsed.success) return fail("Vui lòng kiểm tra lại thông tin.", zodFieldErrors(parsed.error.issues));

  const supabase = await createClient();
  const { data, error } = supplierId
    ? await supabase.from("suppliers").update(parsed.data).eq("id", supplierId).select("id")
    : await supabase.from("suppliers").insert(parsed.data).select("id");
  if (error) return fail(error.code === "23505" ? "Đã có nhà cung cấp trùng tên." : friendlyDbError(error));
  if (!data?.length) return fail("Không tìm thấy nhà cung cấp hoặc bạn không có quyền.");

  revalidateInventory();
  return success(supplierId ? "Đã lưu nhà cung cấp." : "Đã thêm nhà cung cấp.");
}

// ---------------------------------------------------------------------
// QUYỀN NHẬP KHO CỦA NHÂN VIÊN (chỉ QTV)
// ---------------------------------------------------------------------
export async function setStockPermission(employeeId: string, enabled: boolean): Promise<ActionState> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employees")
    .update({ can_receive_stock: enabled })
    .eq("id", employeeId)
    .not("role", "in", "(admin,manager)")
    .select("id");
  if (error) return fail(friendlyDbError(error));
  if (!data?.length) return fail("Không tìm thấy nhân viên này.");
  revalidateInventory();
  revalidatePath("/");
  return success(enabled ? "Đã cấp quyền nhập kho." : "Đã thu hồi quyền nhập kho.");
}
