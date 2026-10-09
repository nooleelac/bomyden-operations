import type { Metadata } from "next";
import Link from "next/link";
import { requireInventoryAccess } from "@/lib/auth/session";
import { getInventoryBranches } from "@/lib/branches";
import { createClient } from "@/lib/supabase/server";
import { loadCatalog } from "@/lib/inventory-data";
import BranchChips from "../../BranchChips";
import CountForm from "./CountForm";

export const metadata: Metadata = { title: "Kiểm kê mới" };
export const instant = false;

export default async function NewCountPage({ searchParams }: PageProps<"/inventory/counts/new">) {
  const me = await requireInventoryAccess();
  const params = await searchParams;
  const branches = await getInventoryBranches(me);
  const branchId = typeof params.branch === "string" && branches.some((b) => b.id === params.branch) ? params.branch : branches[0]?.id;

  if (!branchId) {
    return <p className="alert-info">Bạn chưa được gán chi nhánh nào.</p>;
  }

  const supabase = await createClient();
  const [catalog, { data: balances }] = await Promise.all([
    loadCatalog(),
    supabase.from("stock_balances").select("item_id").eq("branch_id", branchId),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/inventory/counts" className="text-sm text-neutral-500 hover:text-neutral-900">← Kiểm kê</Link>
      <h1 className="mb-1 mt-2 text-2xl font-bold tracking-tight">Kiểm kê mới</h1>
      <p className="mb-4 text-sm text-neutral-500">
        Đếm thực tế và nhập số cho những nguyên liệu đã đếm. Món nào để trống sẽ không bị thay đổi.
      </p>
      <BranchChips branches={branches} branchId={branchId} href={(id) => `?branch=${id}`} />
      <CountForm
        key={branchId}
        branchId={branchId}
        branchName={branches.find((b) => b.id === branchId)?.name ?? ""}
        catalog={catalog}
        stockedIds={(balances ?? []).map((b) => b.item_id)}
      />
    </div>
  );
}
