"use client";

import { startTransition, useRef } from "react";
import ActionForm from "@/components/ActionForm";
import SubmitButton from "@/components/SubmitButton";
import { useFormAction } from "@/components/useFormAction";
import { formatDateTime } from "@/lib/time";
import {
  ADVANCE_STATUS_CLASSES,
  ADVANCE_STATUS_LABELS,
  formatMoney,
  periodLabel,
  type AdvanceQuota,
  type SalaryAdvanceItem,
} from "@/lib/payroll";
import { cancelAdvance, requestAdvance } from "./actions";

export default function AdvanceSection({ quota, items }: { quota: AdvanceQuota; items: SalaryAdvanceItem[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useFormAction(requestAdvance, () => formRef.current?.reset());

  let blockedMessage: string | null = null;
  if (quota.closed) blockedMessage = "Kỳ lương hiện tại của bạn đã chốt nên không ứng thêm được.";
  else if (quota.percent === 0) blockedMessage = "Quán đang tắt chức năng ứng lương.";
  else if (quota.available < 1000) {
    blockedMessage =
      quota.limit === 0
        ? "Bạn chưa có thu nhập trong kỳ này nên chưa ứng lương được."
        : "Bạn đã dùng hết hạn mức ứng lương của kỳ này.";
  }

  return (
    <section className="card space-y-4 p-4">
      <div>
        <h2 className="font-semibold">Ứng lương · {periodLabel(quota.pay_period, quota.period_start)}</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Được ứng tối đa {quota.percent}% số lương đã làm được trong kỳ. Khoản ứng được duyệt sẽ trừ vào lương kỳ này.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-neutral-200 bg-white px-3 py-2">
          <p className="text-xs text-neutral-500">Có thể ứng</p>
          <p className="text-lg font-bold tabular-nums text-emerald-700">{formatMoney(quota.available)}</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white px-3 py-2">
          <p className="text-xs text-neutral-500">Đã ứng / chờ duyệt</p>
          <p className="text-lg font-bold tabular-nums">{formatMoney(quota.used)}</p>
        </div>
      </div>

      {blockedMessage ? (
        <p className="alert-info">{blockedMessage}</p>
      ) : (
        <ActionForm ref={formRef} action={action} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="adv-amount" className="mb-1 block text-xs font-medium text-neutral-600">Số tiền muốn ứng (đ)</label>
              <input
                id="adv-amount"
                name="amount"
                inputMode="numeric"
                required
                placeholder={String(quota.available)}
                className="input"
              />
              {state.fieldErrors?.amount && <p className="field-error">{state.fieldErrors.amount}</p>}
            </div>
            <div>
              <label htmlFor="adv-reason" className="mb-1 block text-xs font-medium text-neutral-600">Lý do (không bắt buộc)</label>
              <input id="adv-reason" name="reason" maxLength={300} placeholder="Ví dụ: Đóng tiền nhà" className="input" />
              {state.fieldErrors?.reason && <p className="field-error">{state.fieldErrors.reason}</p>}
            </div>
          </div>
          <div className="flex justify-end">
            <SubmitButton pending={pending} pendingText="Đang gửi...">Gửi đơn ứng lương</SubmitButton>
          </div>
        </ActionForm>
      )}
      {state.message && <p role="status" className={state.ok ? "alert-success" : "alert-error"}>{state.message}</p>}

      {items.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Đơn ứng lương của tôi</h3>
          <ul className="divide-y divide-neutral-100">
            {items.map((item) => (
              <AdvanceRow key={item.id} item={item} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function AdvanceRow({ item }: { item: SalaryAdvanceItem }) {
  const [state, action, pending] = useFormAction(cancelAdvance.bind(null, item.id));
  return (
    <li className="flex items-start justify-between gap-3 py-2.5 text-sm">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-semibold tabular-nums">{formatMoney(item.amount)}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ADVANCE_STATUS_CLASSES[item.status]}`}>
            {ADVANCE_STATUS_LABELS[item.status]}
          </span>
        </p>
        <p className="mt-0.5 text-xs text-neutral-500">
          Gửi lúc {formatDateTime(item.created_at)}
          {item.reason && ` · ${item.reason}`}
        </p>
        {(item.reviewer_name || item.review_note) && item.status !== "pending" && (
          <p className="mt-0.5 text-xs text-neutral-500">
            {item.reviewer_name && `${ADVANCE_STATUS_LABELS[item.status]} bởi ${item.reviewer_name}`}
            {item.review_note && ` — ${item.review_note}`}
          </p>
        )}
        {state.message && !state.ok && <p className="text-xs text-red-600">{state.message}</p>}
      </div>
      {item.status === "pending" && (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (window.confirm(`Hủy đơn ứng ${formatMoney(item.amount)}?`)) startTransition(() => action(new FormData()));
          }}
          className="shrink-0 text-xs font-medium text-red-700 hover:underline disabled:opacity-50"
        >
          {pending ? "Đang hủy..." : "Hủy đơn"}
        </button>
      )}
    </li>
  );
}
