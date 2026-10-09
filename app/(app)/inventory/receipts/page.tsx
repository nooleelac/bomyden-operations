import type { Metadata } from "next";
import Link from "next/link";
import { requireInventoryAccess } from "@/lib/auth/session";
import { isAdmin, isManagerOrAdmin } from "@/lib/auth/roles";
import { getInventoryBranches } from "@/lib/branches";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, paymentBadge } from "@/lib/inventory";
import { isValidDateString, vnDateString } from "@/lib/time";
import InventoryNav from "../InventoryNav";

export const metadata: Metadata = { title: "Phiếu nhập kho" };
export const instant = false;

function formatDate(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}

export default async function ReceiptsPage({ searchParams }: PageProps<"/inventory/receipts">) {
  const me = await requireInventoryAccess();
  const params = await searchParams;
  const branches = await getInventoryBranches(me);
  const branchId = typeof params.branch === "string" && branches.some((b) => b.id === params.branch) ? params.branch : "";
  const month = typeof params.month === "string" && /^\d{4}-\d{2}$/.test(params.month) ? params.month : vnDateString().slice(0, 7);
  const from = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const to = vnDateString(new Date(Date.UTC(y, m, 1)));
  const prevMonth = vnDateString(new Date(Date.UTC(y, m - 2, 1))).slice(0, 7);
  const nextMonth = to.slice(0, 7);

  const supabase = await createClient();
  const query = supabase
    .from("stock_receipts")
    .select(
      "id, invoice_number, invoice_date, total_amount, paid_amount, debt_amount, due_date, status, created_at, branch:branches(name), supplier:suppliers(name), creator:employees!stock_receipts_created_by_fkey(full_name), stock_receipt_lines(count)"
    )
    .gte("invoice_date", from)
    .lt("invoice_date", isValidDateString(to) ? to : from)
    .in("branch_id", branchId ? [branchId] : branches.map((b) => b.id))
    .order("invoice_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(300);
  const { data: receipts, error } = await query;
  if (error) throw new Error("Không tải được phiếu nhập.");

  const posted = (receipts ?? []).filter((r) => r.status === "posted");
  const monthTotal = posted.reduce((t, r) => t + Number(r.total_amount), 0);
  const monthDebt = posted.reduce((t, r) => t + Number(r.debt_amount ?? 0), 0);
  const today = vnDateString();
  const qs = (patch: Record<string, string>) =>
    "?" + new URLSearchParams({ ...(branchId ? { branch: branchId } : {}), month, ...patch }).toString();

  return (
    <div>
      <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">← Trang chủ</Link>
      <div className="mb-4 mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Phiếu nhập kho</h1>
        <div className="flex flex-wrap gap-2">
          <a href={`/inventory/export/receipts${qs({})}`} className="btn-secondary" download>
            ⬇ Xuất Excel tháng {m}/{y}
          </a>
          <Link href="/inventory/receive" className="btn-primary">📷 Nhập kho từ hóa đơn</Link>
        </div>
      </div>
      <InventoryNav active="receipts" isManager={isManagerOrAdmin(me.role)} isAdmin={isAdmin(me.role)} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center rounded-lg border border-neutral-200 bg-white text-sm">
          <Link href={qs({ month: prevMonth })} className="px-3 py-2 hover:bg-neutral-50" aria-label="Tháng trước">‹</Link>
          <span className="px-2 font-semibold tabular-nums">Tháng {m}/{y}</span>
          <Link href={qs({ month: nextMonth })} className="px-3 py-2 hover:bg-neutral-50" aria-label="Tháng sau">›</Link>
        </div>
        {branches.length > 1 && (
          <div className="flex flex-wrap gap-2">
            <Link href={`?month=${month}`} className={`rounded-full border px-3 py-1 text-sm ${!branchId ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white"}`}>
              Tất cả
            </Link>
            {branches.map((b) => (
              <Link
                key={b.id}
                href={`?branch=${b.id}&month=${month}`}
                className={`rounded-full border px-3 py-1 text-sm ${b.id === branchId ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white"}`}
              >
                {b.name}
              </Link>
            ))}
          </div>
        )}
      </div>

      <p className="mb-3 text-sm text-neutral-600">
        {posted.length} phiếu · Tổng nhập trong tháng (sau VAT) <strong className="text-neutral-900">{formatMoney(monthTotal)}</strong>
        {monthDebt > 0 && (
          <>
            {" "}· Còn nợ <strong className="text-red-700">{formatMoney(monthDebt)}</strong>
          </>
        )}
      </p>

      {(receipts ?? []).length === 0 ? (
        <p className="card p-8 text-center text-neutral-500">Chưa có phiếu nhập nào trong tháng này.</p>
      ) : (
        <ul className="card divide-y divide-neutral-100">
          {receipts!.map((r) => (
            <li key={r.id}>
              <Link href={`/inventory/receipts/${r.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-neutral-50">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {r.supplier?.name ?? "Không rõ nhà cung cấp"}
                    {r.invoice_number && <span className="font-normal text-neutral-500"> · HĐ {r.invoice_number}</span>}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {formatDate(r.invoice_date)} · {r.stock_receipt_lines[0]?.count ?? 0} mặt hàng · {r.creator?.full_name}
                    {branches.length > 1 && ` · ${r.branch?.name}`}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={`font-semibold tabular-nums ${r.status === "cancelled" ? "text-neutral-400 line-through" : ""}`}>
                    {formatMoney(r.total_amount)}
                  </p>
                  {(() => {
                    const badge = paymentBadge(r, today);
                    return <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}>{badge.label}</span>;
                  })()}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
