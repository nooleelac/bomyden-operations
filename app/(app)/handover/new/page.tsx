import type { Metadata } from "next";
import Link from "next/link";
import { requireEmployee } from "@/lib/auth/session";
import { isManagerOrAdmin } from "@/lib/auth/roles";
import { getMyBranches } from "@/lib/branches";
import { createClient } from "@/lib/supabase/server";
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
  const [{ data: config, error }, { data: last }] = await Promise.all([
    supabase
      .from("handover_items")
      .select("item_id, unit, requires_photo, sort_order, item:inventory_items(name)")
      .eq("branch_id", branchId)
      .order("sort_order")
      .order("created_at"),
    supabase
      .from("shift_handovers")
      .select("created_at, shift_handover_lines(item_id, quantity, unit)")
      .eq("branch_id", branchId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (error) throw new Error("Không tải được danh sách món bàn giao.");

  const previous = new Map((last?.shift_handover_lines ?? []).map((l) => [l.item_id, l]));
  const items: HandoverFormItem[] = (config ?? []).map((c) => {
    const prev = previous.get(c.item_id);
    return {
      itemId: c.item_id,
      name: c.item?.name ?? "—",
      unit: c.unit,
      requiresPhoto: c.requires_photo,
      previousQty: prev && prev.unit === c.unit ? Number(prev.quantity) : null,
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
          <p>Chi nhánh chưa có danh sách món cần bàn giao.</p>
          {isManagerOrAdmin(me.role) ? (
            <Link href={`/handover/settings?branch=${branchId}`} className="btn-primary mt-4 inline-flex">⚙️ Thiết lập danh sách món</Link>
          ) : (
            <p className="mt-1 text-sm">Nhờ Quản lý thiết lập trước.</p>
          )}
        </div>
      ) : (
        <HandoverForm
          key={branchId}
          branchId={branchId}
          branchName={branches.find((b) => b.id === branchId)?.name ?? ""}
          items={items}
          previousAt={last?.created_at ?? null}
        />
      )}
    </div>
  );
}
