import type { Metadata } from "next";
import Link from "next/link";
import { requireInventoryAccess } from "@/lib/auth/session";
import { isAdmin, isManagerOrAdmin } from "@/lib/auth/roles";
import { getInventoryBranches } from "@/lib/branches";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/inventory";
import { formatDateTime } from "@/lib/time";
import InventoryNav from "../InventoryNav";
import BranchChips from "../BranchChips";

export const metadata: Metadata = { title: "Kiểm kê kho" };
export const instant = false;

export default async function CountsPage({ searchParams }: PageProps<"/inventory/counts">) {
  const me = await requireInventoryAccess();
  const params = await searchParams;
  const branches = await getInventoryBranches(me);
  const branchId = typeof params.branch === "string" && branches.some((b) => b.id === params.branch) ? params.branch : "";
  const manager = isManagerOrAdmin(me.role);

  const supabase = await createClient();
  const { data: counts, error } = await supabase
    .from("stock_counts")
    .select("id, created_at, note, line_count, used_value, surplus_value, branch:branches(name), creator:employees!stock_counts_created_by_fkey(full_name)")
    .in("branch_id", branchId ? [branchId] : branches.map((b) => b.id))
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error("Không tải được phiếu kiểm kê.");

  return (
    <div>
      <Link href="/inventory" className="text-sm text-neutral-500 hover:text-neutral-900">← Kho</Link>
      <div className="mb-4 mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Kiểm kê kho</h1>
        <Link href={`/inventory/counts/new${branchId ? `?branch=${branchId}` : ""}`} className="btn-primary">🔢 Kiểm kê mới</Link>
      </div>
      <InventoryNav active="counts" isManager={manager} isAdmin={isAdmin(me.role)} />

      <p className="alert-info mb-4">
        Đếm tồn thực tế rồi nhập vào phiếu — tồn kho sẽ được đặt bằng số đếm. Phần chênh lệch giữa sổ và thực tế chính là
        lượng <strong>đã dùng / hao hụt</strong> kể từ lần đếm trước (xem ở mục Tiêu hao).
      </p>

      <BranchChips branches={branches} branchId={branchId} allowAll href={(id) => (id ? `?branch=${id}` : "?")} />

      {(counts ?? []).length === 0 ? (
        <p className="card p-8 text-center text-neutral-500">Chưa có phiếu kiểm kê nào.</p>
      ) : (
        <ul className="card divide-y divide-neutral-100">
          {counts!.map((c) => (
            <li key={c.id}>
              <Link href={`/inventory/counts/${c.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-neutral-50">
                <div className="min-w-0">
                  <p className="font-medium">{formatDateTime(c.created_at)}</p>
                  <p className="truncate text-xs text-neutral-500">
                    {c.line_count} nguyên liệu · {c.creator?.full_name ?? "—"}
                    {branches.length > 1 && ` · ${c.branch?.name}`}
                    {c.note && ` · ${c.note}`}
                  </p>
                </div>
                <div className="shrink-0 text-right text-sm">
                  <p className="font-semibold tabular-nums">Đã dùng {formatMoney(c.used_value)}</p>
                  {Number(c.surplus_value) > 0 && <p className="text-xs text-neutral-500">Dư {formatMoney(c.surplus_value)}</p>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
