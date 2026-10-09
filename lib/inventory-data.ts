import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { INVOICE_PHOTO_BUCKET } from "@/lib/inventory";
import type { CatalogItem, LastPrices, SupplierOption } from "@/app/(app)/inventory/receive/types";

/** Danh mục nguyên liệu đang dùng + đơn vị quy đổi (đọc qua RLS của người dùng). */
export async function loadCatalog(): Promise<CatalogItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inventory_items")
    .select("id, name, category, base_unit, inventory_item_units(unit_name, factor)")
    .eq("is_active", true)
    .order("category")
    .order("name");
  if (error) throw new Error("Không tải được danh mục nguyên liệu.");
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    baseUnit: row.base_unit,
    units: row.inventory_item_units
      .map((u) => ({ name: u.unit_name, factor: Number(u.factor) }))
      .sort((a, b) => a.factor - b.factor),
  }));
}

export async function loadSuppliers(): Promise<SupplierOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("suppliers")
    .select("id, name, payment_terms_days")
    .eq("is_active", true)
    .order("name");
  if (error) throw new Error("Không tải được danh sách nhà cung cấp.");
  return (data ?? []).map((s) => ({ id: s.id, name: s.name, paymentTermsDays: s.payment_terms_days }));
}

/** Giá nhập gần nhất SAU VAT của từng nguyên liệu (quy về 1 đơn vị kho), từ các phiếu chưa hủy. */
export async function loadLastPrices(): Promise<LastPrices> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("stock_receipts")
    .select("invoice_date, stock_receipt_lines(item_id, amount, vat_amount, base_quantity)")
    .eq("status", "posted")
    .order("invoice_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(300);

  const result: LastPrices = {};
  for (const receipt of data ?? []) {
    for (const line of receipt.stock_receipt_lines) {
      if (result[line.item_id]) continue;
      const base = Number(line.base_quantity);
      const amount = Number(line.amount) + Number(line.vat_amount);
      if (base > 0 && amount > 0) result[line.item_id] = { price: amount / base, date: receipt.invoice_date };
    }
  }
  return result;
}

/** Link xem ảnh hóa đơn tạm thời (1 giờ). Path phải lấy từ truy vấn có RLS của người dùng. */
export async function signInvoicePhoto(path: string | null): Promise<string | null> {
  if (!path) return null;
  const admin = createAdminClient();
  const { data } = await admin.storage.from(INVOICE_PHOTO_BUCKET).createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}
