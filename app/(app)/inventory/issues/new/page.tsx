import type { Metadata } from "next";
import Link from "next/link";
import { requireInventoryAccess } from "@/lib/auth/session";
import { getInventoryBranches } from "@/lib/branches";
import { createClient } from "@/lib/supabase/server";
import { loadCatalog } from "@/lib/inventory-data";
import BranchChips from "../../BranchChips";
import IssueForm from "./IssueForm";

export const metadata: Metadata = { title: "Phiếu xuất mới" };
export const instant = false;

export default async function NewIssuePage({ searchParams }: PageProps<"/inventory/issues/new">) {
  const me = await requireInventoryAccess();
  const params = await searchParams;
  const branches = await getInventoryBranches(me);
  const branchId = typeof params.branch === "string" && branches.some((b) => b.id === params.branch) ? params.branch : branches[0]?.id;

  if (!branchId) {
    return <p className="alert-info">Bạn chưa được gán chi nhánh nào.</p>;
  }

  const supabase = await createClient();
  const [catalog, { data: balances }, { data: allBranches }] = await Promise.all([
    loadCatalog(),
    supabase.from("stock_balances").select("item_id, quantity").eq("branch_id", branchId),
    supabase.from("branches").select("id, name").eq("is_active", true).neq("id", branchId).order("name"),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/inventory/issues" className="text-sm text-neutral-500 hover:text-neutral-900">← Xuất kho</Link>
      <h1 className="mb-4 mt-2 text-2xl font-bold tracking-tight">Phiếu xuất mới</h1>
      <BranchChips branches={branches} branchId={branchId} href={(id) => `?branch=${id}`} />
      <IssueForm
        key={branchId}
        branchId={branchId}
        catalog={catalog}
        stock={Object.fromEntries((balances ?? []).map((b) => [b.item_id, Number(b.quantity)]))}
        otherBranches={allBranches ?? []}
      />
    </div>
  );
}
