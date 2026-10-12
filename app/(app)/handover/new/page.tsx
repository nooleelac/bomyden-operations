import type { Metadata } from "next";
import Link from "next/link";
import { requireEmployee } from "@/lib/auth/session";
import { isManagerOrAdmin } from "@/lib/auth/roles";
import { getMyBranches } from "@/lib/branches";
import { createClient } from "@/lib/supabase/server";
import { loadPreviousQuantities } from "@/lib/handover-data";
import { formatDateTime } from "@/lib/time";
import BranchChips from "../../inventory/BranchChips";
import HandoverForm, { type HandoverFormItem } from "./HandoverForm";

export const metadata: Metadata = { title: "Bàn giao ca mới" };
export const instant = false;

export default async function NewHandoverPage({ searchParams }: PageProps<"/handover/new">) {
  const me = await requireEmployee();
  const params = await searchParams;
  const branches = await getMyBranches(me);
  const branchId = typeof params.branch === "string" && branches.some((b) => b.id === params.branch) ? params.branch : branches[0]?.id;

  if (!branchId) {
    return <p className="alert-info">Bạn chưa được gán chi nhánh nào.</p>;
  }

  const supabase = await createClient();
  // Chỉ những món QL đã giao cho mình
  const [{ data: config, error }, previous] = await Promise.all([
    supabase
      .from("handover_items")
      .select("id, name, unit, requires_photo, handover_item_staff!inner(employee_id)")
      .eq("branch_id", branchId)
      .eq("handover_item_staff.employee_id", me.id)
      .order("sort_order")
      .order("created_at"),
    loadPreviousQuantities(branchId),
  ]);
  if (error) throw new Error("Không tải được danh sách món bàn giao.");

  const items: HandoverFormItem[] = (config ?? []).map((c) => {
    const prev = previous.get(c.id);
    return {
      id: c.id,
      name: c.name,
      unit: c.unit,
      requiresPhoto: c.requires_photo,
      previous: prev && prev.unit === c.unit ? { qty: prev.quantity, at: formatDateTime(prev.at) } : null,
    };
  });

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/handover" className="text-sm text-neutral-500 hover:text-neutral-900">← Bàn giao ca</Link>
      <h1 className="mb-1 mt-2 text-2xl font-bold tracking-tight">Bàn giao ca</h1>
      <p className="mb-4 text-sm text-neutral-500">
        Cân / đếm từng món, nhập số lượng và chụp ảnh rõ số trên cân hoặc khay. Người nhận ca sẽ kiểm tra và xác nhận.
      </p>
      <BranchChips branches={branches} branchId={branchId} href={(id) => `?branch=${id}`} />
      {items.length === 0 ? (
        <div className="card p-8 text-center text-neutral-500">
          <p>Bạn chưa được giao món nào để bàn giao ở chi nhánh này.</p>
          {isManagerOrAdmin(me.role) ? (
            <Link href={`/handover/settings?branch=${branchId}`} className="btn-primary mt-4 inline-flex">⚙️ Cài đặt món & phân quyền</Link>
          ) : (
            <p className="mt-1 text-sm">Nhờ Quản lý cài đặt.</p>
          )}
        </div>
      ) : (
        <HandoverForm
          key={branchId}
          branchId={branchId}
          branchName={branches.find((b) => b.id === branchId)?.name ?? ""}
          items={items}
        />
      )}
    </div>
  );
}
