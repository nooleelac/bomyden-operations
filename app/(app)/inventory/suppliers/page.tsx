import type { Metadata } from "next";
import Link from "next/link";
import { requireManager } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import InventoryNav from "../InventoryNav";
import SuppliersView from "./SuppliersView";

export const metadata: Metadata = { title: "Nhà cung cấp" };
export const instant = false;

export default async function SuppliersPage() {
  const me = await requireManager();
  const supabase = await createClient();
  const monthStart = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date()).slice(0, 7) + "-01";
  const [suppliersRes, receiptsRes] = await Promise.all([
    supabase.from("suppliers").select("id, name, phone, address, note, is_active").order("is_active", { ascending: false }).order("name"),
    supabase.from("stock_receipts").select("supplier_id, total_amount").eq("status", "posted").gte("invoice_date", monthStart),
  ]);
  if (suppliersRes.error) throw new Error("Không tải được nhà cung cấp.");

  const monthTotals: Record<string, number> = {};
  for (const r of receiptsRes.data ?? []) {
    if (r.supplier_id) monthTotals[r.supplier_id] = (monthTotals[r.supplier_id] ?? 0) + Number(r.total_amount);
  }

  return (
    <div>
      <Link href="/inventory" className="text-sm text-neutral-500 hover:text-neutral-900">← Kho</Link>
      <h1 className="mb-4 mt-2 text-2xl font-bold tracking-tight">Nhà cung cấp</h1>
      <InventoryNav active="suppliers" isManager isAdmin={isAdmin(me.role)} />
      <SuppliersView suppliers={suppliersRes.data ?? []} monthTotals={monthTotals} />
    </div>
  );
}
