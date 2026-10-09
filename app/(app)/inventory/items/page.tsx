import type { Metadata } from "next";
import Link from "next/link";
import { requireManager } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import InventoryNav from "../InventoryNav";
import ItemsView, { type ItemRow } from "./ItemsView";

export const metadata: Metadata = { title: "Nguyên liệu" };
export const instant = false;

export default async function ItemsPage() {
  const me = await requireManager();
  const supabase = await createClient();
  const [itemsRes, aliasesRes, historyRes] = await Promise.all([
    supabase
      .from("inventory_items")
      .select("id, name, category, base_unit, is_active, inventory_item_units(unit_name, factor)")
      .order("is_active", { ascending: false })
      .order("category")
      .order("name"),
    supabase.from("inventory_aliases").select("id, item_id, alias_norm, unit_name, factor, supplier:suppliers(name)"),
    supabase
      .from("stock_receipts")
      .select("invoice_date, supplier:suppliers(name), stock_receipt_lines(item_id, quantity, unit_name, unit_price, amount, base_quantity)")
      .eq("status", "posted")
      .order("invoice_date", { ascending: false })
      .limit(300),
  ]);
  if (itemsRes.error) throw new Error("Không tải được danh mục nguyên liệu.");

  const rows: ItemRow[] = (itemsRes.data ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    category: item.category,
    baseUnit: item.base_unit,
    isActive: item.is_active,
    units: item.inventory_item_units.map((u) => ({ name: u.unit_name, factor: Number(u.factor) })).sort((a, b) => a.factor - b.factor),
    aliases: (aliasesRes.data ?? [])
      .filter((a) => a.item_id === item.id)
      .map((a) => ({ id: a.id, text: a.alias_norm, unit: a.unit_name, factor: Number(a.factor), supplier: a.supplier?.name ?? null })),
    history: (historyRes.data ?? [])
      .flatMap((r) =>
        r.stock_receipt_lines
          .filter((l) => l.item_id === item.id)
          .map((l) => ({
            date: r.invoice_date,
            supplier: r.supplier?.name ?? null,
            perBase: Number(l.base_quantity) > 0 ? Number(l.amount) / Number(l.base_quantity) : 0,
            quantity: Number(l.quantity),
            unit: l.unit_name,
          }))
      )
      .slice(0, 10),
  }));

  return (
    <div>
      <Link href="/inventory" className="text-sm text-neutral-500 hover:text-neutral-900">← Kho</Link>
      <h1 className="mb-4 mt-2 text-2xl font-bold tracking-tight">Nguyên liệu</h1>
      <InventoryNav active="items" isManager isAdmin={isAdmin(me.role)} />
      <ItemsView rows={rows} />
    </div>
  );
}
