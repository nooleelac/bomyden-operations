import { requireInventoryAccess } from "@/lib/auth/session";
import { getInventoryBranches } from "@/lib/branches";
import { createClient } from "@/lib/supabase/server";
import { loadLastPrices } from "@/lib/inventory-data";
import { addSheet, createWorkbook, excelResponse } from "@/lib/excel";
import { vnDateString } from "@/lib/time";

/** Xuất tồn kho hiện tại của các chi nhánh được xem (mỗi chi nhánh 1 sheet + 1 sheet tổng hợp) */
export async function GET() {
  const me = await requireInventoryAccess();
  const branches = await getInventoryBranches(me);
  const supabase = await createClient();
  const [itemsRes, balancesRes, lastPrices] = await Promise.all([
    supabase.from("inventory_items").select("id, name, category, base_unit, is_active").order("category").order("name"),
    supabase.from("stock_balances").select("branch_id, item_id, quantity, updated_at").in("branch_id", branches.map((b) => b.id)),
    loadLastPrices(),
  ]);
  if (itemsRes.error || balancesRes.error) return new Response("Không tải được tồn kho.", { status: 500 });

  const items = itemsRes.data ?? [];
  const balances = balancesRes.data ?? [];
  const qty = (branchId: string, itemId: string) => balances.find((b) => b.branch_id === branchId && b.item_id === itemId);
  const stamp = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
  const workbook = createWorkbook();

  type Row = { name: string; category: string; unit: string; quantity: number; price: number | null; priceDate: string | null; updatedAt: string | null };
  const columns = [
    { header: "Nhóm", width: 14, value: (r: Row) => r.category },
    { header: "Nguyên liệu", width: 32, value: (r: Row) => r.name },
    { header: "Đơn vị kho", width: 10, value: (r: Row) => r.unit },
    { header: "Tồn", type: "qty" as const, width: 12, value: (r: Row) => r.quantity },
    { header: "Giá nhập gần nhất (sau VAT)", type: "money" as const, width: 20, value: (r: Row) => r.price },
    { header: "Ngày giá", type: "date" as const, width: 12, value: (r: Row) => r.priceDate },
    { header: "Giá trị tồn", type: "money" as const, width: 16, total: true, value: (r: Row) => (r.price && r.quantity > 0 ? r.price * r.quantity : 0) },
    { header: "Cập nhật lần cuối", type: "datetime" as const, width: 17, value: (r: Row) => r.updatedAt },
  ];

  for (const branch of branches) {
    const rows: Row[] = items
      .filter((i) => i.is_active || Number(qty(branch.id, i.id)?.quantity ?? 0) !== 0)
      .map((i) => {
        const b = qty(branch.id, i.id);
        return {
          name: i.name,
          category: i.category,
          unit: i.base_unit,
          quantity: Number(b?.quantity ?? 0),
          price: lastPrices[i.id]?.price ?? null,
          priceDate: lastPrices[i.id]?.date ?? null,
          updatedAt: b?.updated_at ?? null,
        };
      });
    addSheet(workbook, branch.name, columns, rows, {
      title: `TỒN KHO — ${branch.name.toUpperCase()}`,
      subtitle: `Tính đến ${stamp}. Tồn = tổng đã nhập + điều chỉnh (chưa trừ hàng dùng).`,
    });
  }

  if (branches.length > 1) {
    type AllRow = { name: string; category: string; unit: string; byBranch: number[]; total: number };
    const rows: AllRow[] = items.map((i) => {
      const byBranch = branches.map((b) => Number(qty(b.id, i.id)?.quantity ?? 0));
      return { name: i.name, category: i.category, unit: i.base_unit, byBranch, total: byBranch.reduce((a, b) => a + b, 0) };
    }).filter((r) => r.total !== 0);
    addSheet(
      workbook,
      "Tổng các chi nhánh",
      [
        { header: "Nhóm", width: 14, value: (r) => r.category },
        { header: "Nguyên liệu", width: 32, value: (r) => r.name },
        { header: "Đơn vị kho", width: 10, value: (r) => r.unit },
        ...branches.map((b, idx) => ({ header: b.name, type: "qty" as const, width: 14, value: (r: AllRow) => r.byBranch[idx] })),
        { header: "Tổng", type: "qty", width: 12, value: (r) => r.total },
      ],
      rows,
      { title: "TỒN KHO TẤT CẢ CHI NHÁNH", subtitle: `Tính đến ${stamp}` }
    );
  }

  return excelResponse(workbook, `Tồn kho ${vnDateString()}.xlsx`);
}
