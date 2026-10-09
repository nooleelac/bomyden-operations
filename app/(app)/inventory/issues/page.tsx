import type { Metadata } from "next";
import Link from "next/link";
import { requireInventoryAccess } from "@/lib/auth/session";
import { isAdmin, isManagerOrAdmin } from "@/lib/auth/roles";
import { getInventoryBranches } from "@/lib/branches";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, ISSUE_KIND_LABELS } from "@/lib/inventory";
import { formatDateTime } from "@/lib/time";
import InventoryNav from "../InventoryNav";
import BranchChips from "../BranchChips";

export const metadata: Metadata = { title: "Xuất kho" };
export const instant = false;

export default async function IssuesPage({ searchParams }: PageProps<"/inventory/issues">) {
  const me = await requireInventoryAccess();
  const params = await searchParams;
  const branches = await getInventoryBranches(me);
  const branchId = typeof params.branch === "string" && branches.some((b) => b.id === params.branch) ? params.branch : "";
  const scope = (branchId ? [branchId] : branches.map((b) => b.id)).join(",");

  const supabase = await createClient();
  const { data: issues, error } = scope
    ? await supabase
        .from("stock_issues")
        .select(
          "id, kind, reason, status, total_value, created_at, branch_id, to_branch_id, branch:branches!stock_issues_branch_id_fkey(name), to_branch:branches!stock_issues_to_branch_id_fkey(name), creator:employees!stock_issues_created_by_fkey(full_name), stock_issue_lines(count)"
        )
        .or(`branch_id.in.(${scope}),to_branch_id.in.(${scope})`)
        .order("created_at", { ascending: false })
        .limit(150)
    : { data: [], error: null };
  if (error) throw new Error("Không tải được phiếu xuất.");
  const mine = new Set(branchId ? [branchId] : branches.map((b) => b.id));

  return (
    <div>
      <Link href="/inventory" className="text-sm text-neutral-500 hover:text-neutral-900">← Kho</Link>
      <div className="mb-4 mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Xuất kho</h1>
        <Link href={`/inventory/issues/new${branchId ? `?branch=${branchId}` : ""}`} className="btn-primary">➖ Phiếu xuất mới</Link>
      </div>
      <InventoryNav active="issues" isManager={isManagerOrAdmin(me.role)} isAdmin={isAdmin(me.role)} />

      <p className="alert-info mb-4">
        Hàng dùng để chế biến <strong>không cần</strong> lập phiếu xuất — sẽ được tính khi kiểm kê. Chỉ lập phiếu khi hủy hàng
        (hư hỏng, hết hạn), chuyển sang chi nhánh khác, hoặc xuất vì lý do khác.
      </p>

      <BranchChips branches={branches} branchId={branchId} allowAll href={(id) => (id ? `?branch=${id}` : "?")} />

      {(issues ?? []).length === 0 ? (
        <p className="card p-8 text-center text-neutral-500">Chưa có phiếu xuất nào.</p>
      ) : (
        <ul className="card divide-y divide-neutral-100">
          {issues!.map((i) => {
            const incoming = !mine.has(i.branch_id) && i.to_branch_id && mine.has(i.to_branch_id);
            return (
              <li key={i.id}>
                <Link href={`/inventory/issues/${i.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-neutral-50">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {incoming ? `Nhận từ ${i.branch?.name}` : ISSUE_KIND_LABELS[i.kind]}
                      {!incoming && i.kind === "transfer" && ` → ${i.to_branch?.name}`}
                      <span className="font-normal text-neutral-500"> · {i.reason}</span>
                    </p>
                    <p className="text-xs text-neutral-500">
                      {formatDateTime(i.created_at)} · {i.stock_issue_lines[0]?.count ?? 0} mặt hàng · {i.creator?.full_name ?? "—"}
                      {branches.length > 1 && !incoming && ` · ${i.branch?.name}`}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`font-semibold tabular-nums ${i.status === "cancelled" ? "text-neutral-400 line-through" : ""}`}>
                      {formatMoney(i.total_value)}
                    </p>
                    {i.status === "cancelled" && <span className="text-xs text-neutral-500">Đã hủy</span>}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
