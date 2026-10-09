import type { Metadata } from "next";
import Link from "next/link";
import { requireInventoryAccess } from "@/lib/auth/session";
import { getInventoryBranches } from "@/lib/branches";
import { loadCatalog, loadLastPrices, loadSuppliers } from "@/lib/inventory-data";
import { invoiceAiConfigured } from "@/lib/invoice-ai";
import ReceiveView from "./ReceiveView";

export const metadata: Metadata = { title: "Nhập kho" };
export const instant = false;
// AI đọc hóa đơn mất khoảng 10–30 giây
export const maxDuration = 60;

export default async function ReceivePage() {
  const me = await requireInventoryAccess();
  const [branches, catalog, suppliers, lastPrices] = await Promise.all([
    getInventoryBranches(me),
    loadCatalog(),
    loadSuppliers(),
    loadLastPrices(),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/inventory" className="text-sm text-neutral-500 hover:text-neutral-900">← Kho</Link>
      <h1 className="mb-4 mt-2 text-2xl font-bold tracking-tight">Nhập kho từ hóa đơn</h1>

      {branches.length === 0 ? (
        <p className="alert-info">Bạn chưa được gán chi nhánh nào nên chưa nhập kho được.</p>
      ) : (
        <ReceiveView
          branches={branches}
          catalog={catalog}
          suppliers={suppliers}
          lastPrices={lastPrices}
          aiReady={invoiceAiConfigured()}
        />
      )}
    </div>
  );
}
