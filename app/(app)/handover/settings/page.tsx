import type { Metadata } from "next";
import Link from "next/link";
import { requireManager } from "@/lib/auth/session";
import { getManageableBranches } from "@/lib/branches";
import { createClient } from "@/lib/supabase/server";
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
  const { data: rows, error } = await supabase
    .from("handover_items")
    .select("id, name, unit, requires_photo")
    .eq("branch_id", branchId)
    .order("sort_order")
    .order("created_at");
  if (error) throw new Error("Không tải được danh sách món bàn giao.");

  return (
    <div className="mx-auto max-w-2xl">
      <Link href={`/handover?branch=${branchId}`} className="text-sm text-neutral-500 hover:text-neutral-900">← Bàn giao ca</Link>
      <h1 className="mb-1 mt-2 text-2xl font-bold tracking-tight">Danh sách món bàn giao</h1>
      <p className="mb-4 text-sm text-neutral-500">
        Những món nhân viên phải cân / đếm và chụp ảnh mỗi lần bàn giao ca. Danh sách riêng, không liên kết danh mục Kho (nhân viên không thấy nguyên liệu kho) và không ảnh hưởng tồn kho. Chỉ QTV thêm món, đổi tên, đơn vị; QL sắp xếp, bật / tắt ảnh, gỡ món.
      </p>
      <BranchChips branches={branches} branchId={branchId} href={(id) => `?branch=${id}`} />
      <SettingsView
        key={branchId}
        branchId={branchId}
        isAdmin={me.role === "admin"}
        rows={(rows ?? []).map((r) => ({ id: r.id, name: r.name, unit: r.unit, requiresPhoto: r.requires_photo }))}
      />
    </div>
  );
}
