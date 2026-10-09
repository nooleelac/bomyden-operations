import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInventoryAccess } from "@/lib/auth/session";
import { getManageableBranches } from "@/lib/branches";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, formatQty, ISSUE_KIND_LABELS } from "@/lib/inventory";
import { formatDateTime } from "@/lib/time";
import CancelIssueButton from "./CancelIssueButton";

export const metadata: Metadata = { title: "Phiếu xuất kho" };
export const instant = false;

export default async function IssueDetailPage({ params }: PageProps<"/inventory/issues/[id]">) {
  const me = await requireInventoryAccess();
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: issue }, managed] = await Promise.all([
    supabase
      .from("stock_issues")
      .select(
        "id, kind, reason, status, total_value, created_at, cancelled_at, cancel_reason, branch_id, branch:branches!stock_issues_branch_id_fkey(name), to_branch:branches!stock_issues_to_branch_id_fkey(name), creator:employees!stock_issues_created_by_fkey(full_name), canceller:employees!stock_issues_cancelled_by_fkey(full_name), stock_issue_lines(id, line_no, quantity, unit_name, base_quantity, unit_cost, amount, item:inventory_items(name, base_unit))"
      )
      .eq("id", id)
      .maybeSingle(),
    getManageableBranches(me),
  ]);
  if (!issue) notFound();
  const canCancel = issue.status === "posted" && managed.some((b) => b.id === issue.branch_id);
  const lines = [...issue.stock_issue_lines].sort((a, b) => a.line_no - b.line_no);

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/inventory/issues" className="text-sm text-neutral-500 hover:text-neutral-900">← Xuất kho</Link>
      <div className="mb-4 mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {ISSUE_KIND_LABELS[issue.kind]}
            {issue.kind === "transfer" && ` → ${issue.to_branch?.name}`}
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            {formatDateTime(issue.created_at)} · {issue.branch?.name} · {issue.creator?.full_name ?? "—"}
          </p>
          <p className="mt-1 text-sm">Lý do: {issue.reason}</p>
        </div>
        {canCancel && <CancelIssueButton issueId={issue.id} />}
      </div>

      {issue.status === "cancelled" && (
        <p className="alert-error mb-4">
          Đã hủy {issue.cancelled_at && formatDateTime(issue.cancelled_at)} bởi {issue.canceller?.full_name ?? "—"}: {issue.cancel_reason}
        </p>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
            <tr>
              <th className="px-4 py-2 font-medium">Nguyên liệu</th>
              <th className="px-3 py-2 text-right font-medium">Số lượng</th>
              <th className="px-3 py-2 text-right font-medium">Giá vốn</th>
              <th className="px-4 py-2 text-right font-medium">Thành tiền</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-2.5 font-medium">{l.item?.name}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {formatQty(l.quantity)} {l.unit_name}
                  {l.unit_name !== l.item?.base_unit && (
                    <span className="block text-xs text-neutral-500">= {formatQty(l.base_quantity)} {l.item?.base_unit}</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-neutral-500">
                  {l.unit_cost === null ? "Chưa có giá" : `${formatMoney(l.unit_cost)}/${l.item?.base_unit}`}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(l.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-neutral-200 font-semibold">
              <td className="px-4 py-2.5" colSpan={3}>Tổng giá trị</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(issue.total_value)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
