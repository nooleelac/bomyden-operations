import type { Metadata } from "next";
import Link from "next/link";
import { requireInventoryAccess } from "@/lib/auth/session";
import { isAdmin, isManagerOrAdmin } from "@/lib/auth/roles";
import { getInventoryBranches } from "@/lib/branches";
import { createClient } from "@/lib/supabase/server";
import { loadLastPrices } from "@/lib/inventory-data";
import InventoryNav from "./InventoryNav";
import StockView, { type StockRow } from "./StockView";

export const metadata: Metadata = { title: "Kho" };
export const instant = false;

export default async function InventoryPage({ searchParams }: PageProps<"/inventory">) {
  const me = await requireInventoryAccess();
  const params = await searchParams;
  const branches = await getInventoryBranches(me);
  const branchId =
    typeof params.branch === "string" && branches.some((b) => b.id === params.branch) ? params.branch : branches[0]?.id;

  const supabase = await createClient();
  const [itemsRes, balancesRes, lastPrices] = await Promise.all([
    supabase.from("inventory_items").select("id, name, category, base_unit, is_active").order("category").order("name"),
    branchId
      ? supabase.from("stock_balances").select("item_id, quantity, updated_at").eq("branch_id", branchId)
      : Promise.resolve({ data: [], error: null }),
    loadLastPrices(),
  ]);
  if (itemsRes.error || balancesRes.error) throw new Error("Không tải được tồn kho.");

  const balances = new Map((balancesRes.data ?? []).map((b) => [b.item_id, b]));
  const rows: StockRow[] = (itemsRes.data ?? [])
    .filter((item) => item.is_active || Number(balances.get(item.id)?.quantity ?? 0) !== 0)
    .map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      baseUnit: item.base_unit,
      quantity: Number(balances.get(item.id)?.quantity ?? 0),
      updatedAt: balances.get(item.id)?.updated_at ?? null,
      lastPrice: lastPrices[item.id]?.price ?? null,
    }));

  const manager = isManagerOrAdmin(me.role);

  return (
    <div>
      <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">← Trang chủ</Link>
      <div className="mb-4 mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Kho</h1>
        <Link href="/inventory/receive" className="btn-primary">📷 Nhập kho từ hóa đơn</Link>
      </div>
      <InventoryNav active="stock" isManager={manager} isAdmin={isAdmin(me.role)} />

      {branches.length === 0 ? (
        <p className="alert-info">Bạn chưa được gán chi nhánh nào.</p>
      ) : (
        <>
          {branches.length > 1 && (
            <div className="mb-4 flex flex-wrap gap-2">
              {branches.map((b) => (
                <Link
                  key={b.id}
                  href={`/inventory?branch=${b.id}`}
                  className={`rounded-full border px-3 py-1 text-sm font-medium ${b.id === branchId ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-700"}`}
                >
                  {b.name}
                </Link>
              ))}
            </div>
          )}
          <StockView key={branchId} branchId={branchId!} rows={rows} canAdjust={manager} />
        </>
      )}
    </div>
  );
}
