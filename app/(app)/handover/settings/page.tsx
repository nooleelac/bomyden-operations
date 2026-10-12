import type { Metadata } from "next";
import Link from "next/link";
import { requireManager } from "@/lib/auth/session";
import { getManageableBranches } from "@/lib/branches";
import { createClient } from "@/lib/supabase/server";
import { loadCatalog } from "@/lib/inventory-data";
import BranchChips from "../../inventory/BranchChips";
import SettingsView from "./SettingsView";

export const metadata: Metadata = { title: "Danh sách món bàn giao" };
export const instant = false;

export default async function HandoverSettingsPage({ searchParams }: PageProps<"/handover/settings">) {
  const me = await requireManager();
  const params = await searchParams;
  const branches = await getManageableBranches(me);
  const branchId = typeof params.branch === "string" && branches.some((b) => b.id === params.branch) ? params.branch : branches[0]?.id;

  if (!branchId) {
    return <p className="alert-info">Bạn chưa được gán chi nhánh nào.</p>;
  }

  const supabase = await createClient();
  const [catalog, { data: rows, error }] = await Promise.all([
    loadCatalog(),
    supabase
      .from("handover_items")
      .select("id, item_id, unit, requires_photo")
      .eq("branch_id", branchId)
      .order("sort_order")
      .order("created_at"),
  ]);
  if (error) throw new Error("Không tải được danh sách món bàn giao.");

  return (
    <div className="mx-auto max-w-2xl">
      <Link href={`/handover?branch=${branchId}`} className="text-sm text-neutral-500 hover:text-neutral-900">← Bàn giao ca</Link>
      <h1 className="mb-1 mt-2 text-2xl font-bold tracking-tight">Danh sách món bàn giao</h1>
      <p className="mb-4 text-sm text-neutral-500">
        Những món nhân viên phải cân / đếm và chụp ảnh mỗi lần bàn giao ca. Món lấy từ danh mục nguyên liệu của Kho.
      </p>
      <BranchChips branches={branches} branchId={branchId} href={(id) => `?branch=${id}`} />
      <SettingsView
        key={branchId}
        branchId={branchId}
        catalog={catalog}
        rows={(rows ?? []).map((r) => ({ id: r.id, itemId: r.item_id, unit: r.unit, requiresPhoto: r.requires_photo }))}
      />
    </div>
  );
}
