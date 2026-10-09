"use client";

import { startTransition, useState } from "react";
import Link from "next/link";
import { useFormAction } from "@/components/useFormAction";
import { formatDateTime } from "@/lib/time";
import {
  ADVANCE_STATUS_CLASSES,
  ADVANCE_STATUS_LABELS,
  formatMoney,
  periodLabel,
  type SalaryAdvanceQueueItem,
} from "@/lib/payroll";
import { reviewAdvance } from "../actions";

export default function AdvanceReviewCard({ item }: { item: SalaryAdvanceQueueItem }) {
  const [note, setNote] = useState("");
  const [approveState, approve, approving] = useFormAction(reviewAdvance.bind(null, item.id, true));
  const [rejectState, reject, rejecting] = useFormAction(reviewAdvance.bind(null, item.id, false));
  const busy = approving || rejecting;
  const state = rejectState.message ? rejectState : approveState;

  const submit = (fn: (fd: FormData) => void) => {
    const fd = new FormData();
    fd.set("note", note);
    startTransition(() => fn(fd));
  };

  const quota = item.quota;
  const overLimit = quota !== null && quota.used > quota.limit;

  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            <Link href={`/payroll/${item.employee_id}?start=${item.period_start}`} className="hover:underline">
              {item.full_name}
            </Link>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ADVANCE_STATUS_CLASSES[item.status]}`}>
              {ADVANCE_STATUS_LABELS[item.status]}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-neutral-500">
            Gửi lúc {formatDateTime(item.created_at)}
            {quota && ` · ${periodLabel(quota.pay_period, item.period_start)}`}
          </p>
          {item.reason && <p className="mt-1 text-sm">Lý do: {item.reason}</p>}
          {item.status !== "pending" && (item.reviewer_name || item.review_note) && (
            <p className="mt-1 text-xs text-neutral-500">
              {item.reviewer_name && `${ADVANCE_STATUS_LABELS[item.status]} bởi ${item.reviewer_name}`}
              {item.reviewed_at && ` lúc ${formatDateTime(item.reviewed_at)}`}
              {item.review_note && ` — ${item.review_note}`}
            </p>
          )}
        </div>
        <span className="shrink-0 text-lg font-bold tabular-nums">{formatMoney(item.amount)}</span>
      </div>

      {item.status === "pending" && (
        <>
          {quota && (
            <p className={overLimit ? "alert-error" : "alert-info"}>
              Lương tạm tính kỳ này {formatMoney(quota.earned)} · hạn mức {quota.percent}% = {formatMoney(quota.limit)} · tổng
              đã ứng + chờ duyệt {formatMoney(quota.used)}
              {overLimit && " — đang vượt hạn mức (công trong kỳ đã thay đổi)"}.
            </p>
          )}
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            placeholder="Ghi chú cho nhân viên (không bắt buộc)"
            aria-label="Ghi chú cho nhân viên"
            className="input"
          />
          <div className="flex justify-end gap-3">
            <button type="button" disabled={busy} onClick={() => submit(reject)} className="btn-secondary">
              {rejecting ? "Đang từ chối..." : "Từ chối"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Duyệt cho ${item.full_name} ứng ${formatMoney(item.amount)}? Khoản này sẽ trừ vào lương kỳ này.`)) {
                  submit(approve);
                }
              }}
              className="btn-primary"
            >
              {approving ? "Đang duyệt..." : "Duyệt"}
            </button>
          </div>
        </>
      )}
      {state.message && !state.ok && <p role="status" className="alert-error">{state.message}</p>}
    </div>
  );
}
