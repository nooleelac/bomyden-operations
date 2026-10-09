import type { Metadata } from "next";
import Link from "next/link";
import { requireManager } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/roles";
import { getManageableBranches } from "@/lib/branches";
import { createClient } from "@/lib/supabase/server";
import { formatIsoDate, formatMoney, paymentBadge } from "@/lib/inventory";
import { vnDateString } from "@/lib/time";
import InventoryNav from "../InventoryNav";
import { RecordPaymentButton } from "../PaymentDialogs";

export const metadata: Metadata = { title: "Công nợ nhà cung cấp" };
export const instant = false;

type SupplierGroup = {
  id: string;
  name: string;
  phone: string | null;
  debt: number;
  overdue: number;
  receipts: {
    id: string;
    invoiceNumber: string | null;
    invoiceDate: string;
    dueDate: string | null;
    total: number;
    paid: number;
    debt: number;
    branch: string | undefined;
    badge: ReturnType<typeof paymentBadge>;
  }[];
};

export default async function DebtsPage() {
  const me = await requireManager();
  const branches = await getManageableBranches(me);
  const today = vnDateString();
  const monthStart = `${today.slice(0, 7)}-01`;

  const supabase = await createClient();
  const [debtRes, paidRes] = await Promise.all([
    supabase
      .from("stock_receipts")
      .select("id, invoice_number, invoice_date, due_date, total_amount, paid_amount, debt_amount, status, branch:branches(name), supplier:suppliers(id, name, phone)")
      .eq("status", "posted")
      .gt("debt_amount", 0)
      .in("branch_id", branches.map((b) => b.id))
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("invoice_date", { ascending: true })
      .limit(500),
    supabase
      .from("supplier_payments")
      .select("amount")
      .is("voided_at", null)
      .gte("paid_on", monthStart)
      .in("branch_id", branches.map((b) => b.id)),
  ]);
  if (debtRes.error) throw new Error("Không tải được công nợ.");

  const groups = new Map<string, SupplierGroup>();
  for (const r of debtRes.data ?? []) {
    const key = r.supplier?.id ?? "none";
    const group =
      groups.get(key) ??
      ({ id: key, name: r.supplier?.name ?? "Không rõ nhà cung cấp", phone: r.supplier?.phone ?? null, debt: 0, overdue: 0, receipts: [] } as SupplierGroup);
    const badge = paymentBadge(r, today);
    const debt = Number(r.debt_amount ?? 0);
    group.debt += debt;
    if (badge.overdue) group.overdue += debt;
    group.receipts.push({
      id: r.id,
      invoiceNumber: r.invoice_number,
      invoiceDate: r.invoice_date,
      dueDate: r.due_date,
      total: Number(r.total_amount),
      paid: Number(r.paid_amount),
      debt,
      branch: r.branch?.name,
      badge,
    });
    groups.set(key, group);
  }
  const list = [...groups.values()].sort((a, b) => b.overdue - a.overdue || b.debt - a.debt);
  const totalDebt = list.reduce((t, g) => t + g.debt, 0);
  const totalOverdue = list.reduce((t, g) => t + g.overdue, 0);
  const paidThisMonth = (paidRes.data ?? []).reduce((t, p) => t + Number(p.amount), 0);

  return (
    <div>
      <Link href="/inventory" className="text-sm text-neutral-500 hover:text-neutral-900">← Kho</Link>
      <div className="mb-4 mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Công nợ nhà cung cấp</h1>
        <a href="/inventory/export/debts" className="btn-secondary" download>⬇ Xuất Excel</a>
      </div>
      <InventoryNav active="debts" isManager isAdmin={isAdmin(me.role)} />

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="card p-4">
          <p className="text-sm text-neutral-500">Tổng còn nợ</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{formatMoney(totalDebt)}</p>
        </div>
        <div className={`card p-4 ${totalOverdue > 0 ? "border-red-200" : ""}`}>
          <p className="text-sm text-neutral-500">Quá hạn</p>
          <p className={`mt-1 text-2xl font-bold tabular-nums ${totalOverdue > 0 ? "text-red-700" : ""}`}>{formatMoney(totalOverdue)}</p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-neutral-500">Đã trả tháng này</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{formatMoney(paidThisMonth)}</p>
        </div>
      </div>

      {list.length === 0 ? (
        <p className="card p-8 text-center text-neutral-500">🎉 Không còn khoản nợ nào.</p>
      ) : (
        <div className="space-y-4">
          {list.map((group) => (
            <section key={group.id} className="card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 bg-neutral-50 px-4 py-3">
                <div>
                  <h2 className="font-semibold">{group.name}</h2>
                  {group.phone && <p className="text-xs text-neutral-500">{group.phone}</p>}
                </div>
                <div className="text-right">
                  <p className="font-bold tabular-nums">{formatMoney(group.debt)}</p>
                  {group.overdue > 0 && <p className="text-xs font-medium text-red-700">Quá hạn {formatMoney(group.overdue)}</p>}
                </div>
              </div>
              <ul className="divide-y divide-neutral-100">
                {group.receipts.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <Link href={`/inventory/receipts/${r.id}`} className="min-w-0 hover:underline">
                      <p className="text-sm font-medium">
                        {r.invoiceNumber ? `HĐ ${r.invoiceNumber}` : "Không số HĐ"} · {formatIsoDate(r.invoiceDate)}
                        {branches.length > 1 && r.branch && <span className="font-normal text-neutral-500"> · {r.branch}</span>}
                      </p>
                      <p className="text-xs text-neutral-500">
                        Tổng {formatMoney(r.total)}
                        {r.paid > 0 && ` · đã trả ${formatMoney(r.paid)}`} ·{" "}
                        <span className={r.badge.overdue ? "font-semibold text-red-700" : ""}>
                          {r.dueDate ? `hạn ${formatIsoDate(r.dueDate)}` : "không có hạn"}
                        </span>
                      </p>
                    </Link>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold tabular-nums text-red-700">{formatMoney(r.debt)}</span>
                      <RecordPaymentButton receiptId={r.id} debt={r.debt} label="Trả" compact />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
