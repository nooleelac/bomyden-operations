"use client";

import { startTransition, useCallback, useEffect, useState } from "react";
import { useFormAction } from "@/components/useFormAction";
import RequestDialog, { type UpcomingShift } from "./RequestDialog";
import { cancelRequest, respondSwap } from "../schedule/actions";
import { REQUEST_KIND_LABELS, REQUEST_STATUS, describeRequest, type MyRequest } from "@/lib/schedule";
import { formatDateTime } from "@/lib/time";

type Props = {
  myId: string;
  today: string;
  hasBranch: boolean;
  /** Mở sẵn hộp gửi đơn (VD từ liên kết /requests?new=1) */
  autoOpen: boolean;
  requests: MyRequest[];
  upcoming: UpcomingShift[];
  colleagues: Record<string, { id: string; name: string }[]>;
};

function ActionButton({
  run,
  label,
  confirm,
  className,
  onDone,
}: {
  run: () => Promise<{ ok: boolean; message: string }>;
  label: string;
  confirm?: string;
  className: string;
  onDone: (m: string) => void;
}) {
  const [state, action, pending] = useFormAction(
    () => run().then((r) => ({ ...r, successKey: Date.now() })),
    (r) => onDone(r.message)
  );
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!confirm || window.confirm(confirm)) startTransition(() => action(new FormData()));
        }}
        className={`${className} disabled:opacity-50`}
      >
        {pending ? "Đang xử lý..." : label}
      </button>
      {state.message && !state.ok && <span className="text-xs text-red-600">{state.message}</span>}
    </span>
  );
}

export default function RequestsView({ myId, today, hasBranch, autoOpen, requests, upcoming, colleagues }: Props) {
  const [toast, setToast] = useState("");
  const [open, setOpen] = useState(autoOpen && hasBranch);
  const notify = useCallback((message: string) => setToast(message), []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  const incoming = requests.filter((r) => r.target_employee_id === myId && r.status === "awaiting_peer");
  const mine = requests.filter((r) => r.employee_id === myId);

  return (
    <>
      {toast && <p role="status" className="alert-success mb-4">{toast}</p>}

      {hasBranch ? (
        <div className="card mb-6 flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-neutral-600">Xin nghỉ, đi trễ, về sớm hoặc đổi / nhường ca cho đồng nghiệp.</p>
          <button type="button" onClick={() => setOpen(true)} className="btn-primary">+ Gửi đơn</button>
        </div>
      ) : (
        <div className="card mb-6 p-6 text-center text-sm text-neutral-500">Bạn chưa được gán chi nhánh nào nên chưa thể gửi đơn.</div>
      )}

      {incoming.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-violet-800">Đồng nghiệp nhờ bạn nhận ca</h2>
          <ul className="space-y-2">
            {incoming.map((r) => (
              <li key={r.id} className="card border-violet-200 p-4 text-sm">
                <p className="font-medium">{r.employee_name}: {describeRequest({ ...r, target_name: "bạn" })}</p>
                <p className="mt-0.5 text-neutral-500">Lý do: {r.reason}</p>
                <div className="mt-3 flex justify-end gap-4">
                  <ActionButton run={() => respondSwap(r.id, false)} label="Từ chối" confirm="Từ chối nhận ca?" className="text-sm font-medium text-red-700 hover:underline" onDone={notify} />
                  <ActionButton run={() => respondSwap(r.id, true)} label="Đồng ý nhận ca" className="btn-primary" onDone={notify} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-3 font-semibold">Đơn của tôi</h2>
        {mine.length === 0 ? (
          <div className="card px-6 py-8 text-center text-sm text-neutral-500">Chưa có đơn nào.</div>
        ) : (
          <ul className="card divide-y divide-neutral-100">
            {mine.map((r) => {
              const status = REQUEST_STATUS[r.status];
              return (
                <li key={r.id} className="flex items-start justify-between gap-3 p-4 text-sm">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{REQUEST_KIND_LABELS[r.kind]}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}>{status.label}</span>
                      {r.is_urgent && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">Gấp</span>}
                      {r.over_limit && <span className="rounded-full bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-700">Vượt giới hạn tháng</span>}
                      {r.is_paid && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Có lương</span>}
                    </div>
                    <p className="mt-0.5 text-neutral-700">{describeRequest(r)}</p>
                    <p className="mt-0.5 text-neutral-500">Lý do: {r.reason}</p>
                    {r.review_note && (
                      <p className="mt-0.5 text-neutral-500">
                        Phản hồi{r.reviewer_name ? ` (${r.reviewer_name})` : ""}: {r.review_note}
                      </p>
                    )}
                    <p className="mt-0.5 text-xs text-neutral-400">Gửi lúc {formatDateTime(r.created_at)}</p>
                  </div>
                  {(r.status === "pending" || r.status === "awaiting_peer") && (
                    <ActionButton run={() => cancelRequest(r.id)} label="Hủy đơn" confirm="Hủy đơn này?" className="shrink-0 text-xs font-medium text-red-700 hover:underline" onDone={notify} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {open && (
        <RequestDialog
          myId={myId}
          today={today}
          upcoming={upcoming}
          colleagues={colleagues}
          open={open}
          onClose={() => setOpen(false)}
          onDone={(m) => {
            setOpen(false);
            notify(m);
          }}
        />
      )}
    </>
  );
}
