import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInventoryAccess } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { signInvoicePhoto } from "@/lib/inventory-data";
import { PAYMENT_METHOD_LABELS, formatIsoDate, formatMoney, formatQty, paymentBadge } from "@/lib/inventory";
import { formatDateTime, vnDateString } from "@/lib/time";
import CancelReceiptButton from "./CancelReceiptButton";
import { DueDateButton, RecordPaymentButton, VoidPaymentButton } from "../../PaymentDialogs";

export const metadata: Metadata = { title: "Phiếu nhập kho" };
export const instant = false;

export default async function ReceiptDetailPage({ params, searchParams }: PageProps<"/inventory/receipts/[id]">) {
  const me = await requireInventoryAccess();
  const { id } = await params;
  const query = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const { data: receipt } = await supabase
    .from("stock_receipts")
    .select(
      "*, branch:branches(name), supplier:suppliers(name, phone), creator:employees!stock_receipts_created_by_fkey(full_name), canceller:employees!stock_receipts_cancelled_by_fkey(full_name), stock_receipt_lines(line_no, raw_name, quantity, unit_name, factor, base_quantity, unit_price, amount, vat_rate, vat_amount, item:inventory_items(name, base_unit)), supplier_payments(id, amount, paid_on, method, note, created_at, voided_at, void_reason, creator:employees!supplier_payments_created_by_fkey(full_name))"
    )
    .eq("id", id)
    .maybeSingle();
  if (!receipt) notFound();

  const [photoUrl, { data: canManage }] = await Promise.all([
    signInvoicePhoto(receipt.photo_path),
    me.role === "admin" || me.role === "manager"
      ? supabase.rpc("can_receive_stock_at", { p_branch_id: receipt.branch_id })
      : Promise.resolve({ data: false }),
  ]);
  const lines = [...receipt.stock_receipt_lines].sort((a, b) => a.line_no - b.line_no);
  const payments = [...receipt.supplier_payments].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  const diff = receipt.invoice_total !== null ? Number(receipt.invoice_total) - Number(receipt.total_amount) : 0;
  const badge = paymentBadge(receipt, vnDateString());
  const debt = Number(receipt.debt_amount ?? 0);
  const posted = receipt.status === "posted";

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/inventory/receipts" className="text-sm text-neutral-500 hover:text-neutral-900">← Phiếu nhập</Link>
      {query.created && <p className="alert-success mt-3">✓ Đã lưu phiếu nhập và cộng vào tồn kho.</p>}

      <div className="mb-4 mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{receipt.supplier?.name ?? "Không rõ nhà cung cấp"}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {receipt.invoice_number ? `HĐ ${receipt.invoice_number} · ` : ""}Ngày {formatIsoDate(receipt.invoice_date)} · {receipt.branch?.name}
          </p>
        </div>
        {posted ? (
          canManage && <CancelReceiptButton receiptId={receipt.id} />
        ) : (
          <span className="rounded-full bg-red-50 px-3 py-1 text-sm font-semibold text-red-700">Đã hủy</span>
        )}
      </div>

      {!posted && (
        <p className="alert-error mb-4">
          Hủy bởi {receipt.canceller?.full_name} lúc {formatDateTime(receipt.cancelled_at!)}: {receipt.cancel_reason}. Tồn kho đã được trừ
          lại, các lần thanh toán đã được hủy theo.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-[1fr_240px]">
        <div className="space-y-4">
          <section className="card overflow-hidden">
            <ul className="divide-y divide-neutral-100">
              {lines.map((line) => (
                <li key={line.line_no} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{line.item?.name}</p>
                      {line.raw_name && line.raw_name !== line.item?.name && (
                        <p className="text-xs text-neutral-400">Trên hóa đơn: {line.raw_name}</p>
                      )}
                      <p className="mt-0.5 text-sm text-neutral-600 tabular-nums">
                        {formatQty(line.quantity)} {line.unit_name} × {formatMoney(line.unit_price)}
                        {Number(line.factor) !== 1 && (
                          <span className="text-neutral-400"> (= {formatQty(line.base_quantity)} {line.item?.base_unit})</span>
                        )}
                      </p>
                      <p className="text-xs text-neutral-500">VAT {formatQty(line.vat_rate)}%{Number(line.vat_amount) > 0 && ` · ${formatMoney(line.vat_amount)}`}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-semibold tabular-nums">{formatMoney(Number(line.amount) + Number(line.vat_amount))}</p>
                      <p className="text-xs text-neutral-400 tabular-nums">chưa VAT {formatMoney(line.amount)}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <dl className="space-y-1 border-t border-neutral-200 bg-neutral-50 px-4 py-3 text-sm">
              <div className="flex justify-between text-neutral-600">
                <dt>Tiền hàng (chưa VAT)</dt>
                <dd className="tabular-nums">{formatMoney(receipt.subtotal)}</dd>
              </div>
              <div className="flex justify-between text-neutral-600">
                <dt>Tiền thuế VAT</dt>
                <dd className="tabular-nums">{formatMoney(receipt.vat_amount)}</dd>
              </div>
              <div className="flex justify-between font-semibold">
                <dt>Tổng thanh toán</dt>
                <dd className="tabular-nums">{formatMoney(receipt.total_amount)}</dd>
              </div>
              {receipt.invoice_total !== null && (
                <div className="flex justify-between text-neutral-500">
                  <dt>Tổng in trên hóa đơn</dt>
                  <dd className={`tabular-nums ${Math.abs(diff) >= 1000 ? "font-semibold text-amber-700" : ""}`}>
                    {formatMoney(receipt.invoice_total)}
                  </dd>
                </div>
              )}
            </dl>
          </section>

          <section className="card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">Thanh toán</h2>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.className}`}>{badge.label}</span>
            </div>
            {posted && (
              <dl className="mt-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-neutral-600">Đã trả</dt>
                  <dd className="tabular-nums">{formatMoney(receipt.paid_amount)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-neutral-600">Còn nợ</dt>
                  <dd className={`font-semibold tabular-nums ${debt > 0 ? "text-red-700" : ""}`}>{formatMoney(debt)}</dd>
                </div>
                {debt > 0 && (
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-neutral-600">Hạn thanh toán</dt>
                    <dd className="flex items-center gap-2">
                      <span className={badge.overdue ? "font-semibold text-red-700" : ""}>
                        {receipt.due_date ? formatIsoDate(receipt.due_date) : "Không có hạn"}
                      </span>
                      {canManage && <DueDateButton receiptId={receipt.id} dueDate={receipt.due_date} />}
                    </dd>
                  </div>
                )}
              </dl>
            )}
            {posted && debt > 0 && canManage && (
              <div className="mt-3">
                <RecordPaymentButton receiptId={receipt.id} debt={debt} />
              </div>
            )}

            {payments.length > 0 && (
              <ul className="mt-4 divide-y divide-neutral-100 border-t border-neutral-100 text-sm">
                {payments.map((p) => (
                  <li key={p.id} className={`flex items-start justify-between gap-3 py-2 ${p.voided_at ? "opacity-50" : ""}`}>
                    <div className="min-w-0">
                      <p>
                        {formatIsoDate(p.paid_on)} · {PAYMENT_METHOD_LABELS[p.method]}
                        <span className="text-neutral-500"> · {p.creator?.full_name}</span>
                      </p>
                      {p.note && <p className="text-xs text-neutral-500">{p.note}</p>}
                      {p.voided_at && <p className="text-xs text-red-600">Đã hủy: {p.void_reason}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className={`font-medium tabular-nums ${p.voided_at ? "line-through" : ""}`}>{formatMoney(p.amount)}</span>
                      {canManage && posted && !p.voided_at && <VoidPaymentButton paymentId={p.id} />}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-3 text-sm">
          {photoUrl ? (
            <a href={photoUrl} target="_blank" rel="noreferrer" className="card block overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photoUrl} alt="Ảnh hóa đơn" className="max-h-80 w-full object-contain" />
              <span className="block px-3 py-2 text-center text-xs text-neutral-500">Bấm để xem ảnh gốc</span>
            </a>
          ) : (
            <p className="card p-4 text-neutral-500">{receipt.scan_id ? "Ảnh hóa đơn đã được dọn (quá 12 tháng)." : "Phiếu nhập tay, không có ảnh."}</p>
          )}
          <div className="card space-y-1 p-4 text-neutral-600">
            <p>Người nhập: <strong className="text-neutral-900">{receipt.creator?.full_name}</strong></p>
            <p>Lúc: {formatDateTime(receipt.created_at)}</p>
            {receipt.supplier?.phone && <p>SĐT NCC: {receipt.supplier.phone}</p>}
            {receipt.note && <p className="pt-1 text-neutral-800">Ghi chú: {receipt.note}</p>}
          </div>
        </aside>
      </div>
    </div>
  );
}
