"use client";

import { startTransition, useState } from "react";
import ActionForm from "@/components/ActionForm";
import Dialog from "@/components/Dialog";
import SubmitButton from "@/components/SubmitButton";
import { useFormAction } from "@/components/useFormAction";
import { reviewRegistrations, setSelfSchedule } from "./actions";
import { dayLabel } from "@/lib/schedule";
import type { RegistrationStatus } from "@/lib/database.types";

export type BranchRegistration = {
  id: string;
  employee_id: string;
  employee_name: string;
  work_date: string;
  template_id: string | null;
  status: RegistrationStatus;
  review_note: string | null;
};
export type RegTemplate = { id: string; name: string; startTime: string; endTime: string };
export type SelfScheduleStaff = { id: string; name: string; roleLabel: string; enabled: boolean };

function SelfScheduleToggle({ staff, onDone }: { staff: SelfScheduleStaff; onDone: (m: string) => void }) {
  const [state, action, pending] = useFormAction(() => setSelfSchedule(staff.id, !staff.enabled), (r) => onDone(r.message));
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <div>
        <p className="text-sm font-medium">{staff.name}</p>
        <p className="text-xs text-neutral-500">{staff.roleLabel}</p>
        {state.message && !state.ok && <p className="text-xs text-red-600">{state.message}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={staff.enabled}
        aria-label={`Tự đăng ký ca: ${staff.name}`}
        disabled={pending}
        onClick={() => startTransition(() => action(new FormData()))}
        className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50 ${staff.enabled ? "bg-emerald-600" : "bg-neutral-300"}`}
      >
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${staff.enabled ? "left-6" : "left-1"}`} />
      </button>
    </li>
  );
}

function RejectDialog({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: (m: string) => void }) {
  const [state, action, pending] = useFormAction(reviewRegistrations.bind(null, false), (r) => onDone(r.message));
  return (
    <Dialog open onClose={onClose} title={`Từ chối ${ids.length} đăng ký`} description="Nhân viên sẽ thấy lý do từ chối.">
      <ActionForm action={action} className="space-y-4">
        {ids.map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
        <div>
          <label htmlFor="rj-note" className="mb-1.5 block text-sm font-medium text-neutral-700">Lý do</label>
          <textarea id="rj-note" name="review_note" rows={2} required maxLength={200} placeholder="Ví dụ: Ca này đã đủ người" className="input" />
          {state.fieldErrors?.review_note && <p className="field-error">{state.fieldErrors.review_note}</p>}
        </div>
        {state.message && !state.ok && <p role="alert" className="alert-error">{state.message}</p>}
        <div className="flex justify-end gap-3 border-t border-neutral-100 pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">Đóng</button>
          <SubmitButton pending={pending} variant="danger">Từ chối</SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}

export function RegistrationsManager({
  registrations,
  templates,
  scheduled,
  staff,
}: {
  registrations: BranchRegistration[];
  templates: RegTemplate[];
  /** Số ca đã xếp (chưa hủy) theo "ngày|mẫu ca" */
  scheduled: Record<string, number>;
  staff: SelfScheduleStaff[];
}) {
  const [toast, setToast] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [rejecting, setRejecting] = useState(false);
  const done = (m: string) => {
    setToast(m);
    setSelected([]);
    setRejecting(false);
  };
  const [approveState, approveAction, approvePending] = useFormAction(reviewRegistrations.bind(null, true), (r) => done(r.message));

  const pendingIds = registrations.filter((r) => r.status === "pending").map((r) => r.id);
  const days = [...new Set(registrations.map((r) => r.work_date))].sort();
  const enabledCount = staff.filter((s) => s.enabled).length;
  const groups = [...templates.map((t) => ({ key: t.id as string | null, name: t.name, time: `${t.startTime}–${t.endTime}` })), { key: null, name: "Nghỉ", time: "" }];
  const toggle = (ids: string[], on: boolean) => setSelected((s) => (on ? [...new Set([...s, ...ids])] : s.filter((x) => !ids.includes(x))));

  const approve = (ids: string[]) => {
    const fd = new FormData();
    ids.forEach((id) => fd.append("ids", id));
    startTransition(() => approveAction(fd));
  };

  return (
    <>
      {toast && <p role="status" className="alert-success mb-4">{toast}</p>}
      {approveState.message && !approveState.ok && <p role="alert" className="alert-error mb-4">{approveState.message}</p>}

      <details className="card mb-4 p-4">
        <summary className="cursor-pointer text-sm font-semibold">
          Nhân viên được tự đăng ký ca <span className="font-normal text-neutral-500">({enabledCount}/{staff.length})</span>
        </summary>
        <p className="mt-2 text-xs text-neutral-500">Bật cho nhân viên part-time. Họ sẽ thấy nút “Đăng ký ca” trong Lịch làm việc.</p>
        {staff.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-500">Chi nhánh chưa có nhân viên.</p>
        ) : (
          <ul className="mt-2 divide-y divide-neutral-100">
            {staff.map((s) => <SelfScheduleToggle key={`${s.id}-${s.enabled}`} staff={s} onDone={setToast} />)}
          </ul>
        )}
      </details>

      <div className="card mb-4 flex flex-wrap items-center gap-3 p-3 text-sm">
        <span className="text-neutral-600">
          <strong className={pendingIds.length ? "text-amber-700" : ""}>{pendingIds.length}</strong> đăng ký chờ duyệt
          {selected.length > 0 && <> · đã chọn <strong>{selected.length}</strong></>}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          {selected.length > 0 ? (
            <>
              <button type="button" onClick={() => setRejecting(true)} className="btn-secondary text-red-700">Từ chối ({selected.length})</button>
              <button type="button" disabled={approvePending} onClick={() => approve(selected)} className="btn-primary">
                {approvePending ? "Đang duyệt..." : `Duyệt đã chọn (${selected.length})`}
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={approvePending || pendingIds.length === 0}
              onClick={() => {
                if (window.confirm(`Duyệt toàn bộ ${pendingIds.length} đăng ký đang chờ? Các ca sẽ được tạo ở dạng nháp.`)) approve(pendingIds);
              }}
              className="btn-primary"
            >
              {approvePending ? "Đang duyệt..." : `Duyệt tất cả (${pendingIds.length})`}
            </button>
          )}
        </div>
      </div>

      {days.length === 0 ? (
        <div className="card p-6 text-center text-sm text-neutral-500">Chưa có nhân viên nào đăng ký trong kỳ này.</div>
      ) : (
        <ul className="space-y-3">
          {days.map((d) => {
            const dayRegs = registrations.filter((r) => r.work_date === d);
            const dayPending = dayRegs.filter((r) => r.status === "pending").map((r) => r.id);
            const allOn = dayPending.length > 0 && dayPending.every((id) => selected.includes(id));
            return (
              <li key={d} className="card p-3">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{dayLabel(d)}</h3>
                  {dayPending.length > 0 && (
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-neutral-600">
                      <input type="checkbox" checked={allOn} onChange={(e) => toggle(dayPending, e.target.checked)} className="h-4 w-4 accent-brand" />
                      Chọn cả ngày ({dayPending.length})
                    </label>
                  )}
                </div>
                <div className="space-y-2">
                  {groups.map((g) => {
                    const regs = dayRegs.filter((r) => r.template_id === g.key);
                    if (regs.length === 0) return null;
                    const count = g.key ? (scheduled[`${d}|${g.key}`] ?? 0) : null;
                    return (
                      <div key={g.key ?? "off"} className="flex flex-col gap-1.5 sm:flex-row sm:items-start">
                        <div className="w-36 shrink-0 text-xs">
                          <span className="font-semibold">{g.name}</span> <span className="text-neutral-500">{g.time}</span>
                          {count !== null && <span className="block text-neutral-400">{regs.length} đăng ký · đã xếp {count}</span>}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {regs.map((r) =>
                            r.status === "pending" ? (
                              <label
                                key={r.id}
                                className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1 text-xs ${selected.includes(r.id) ? "border-brand bg-brand/5" : "border-amber-300 bg-amber-50"}`}
                              >
                                <input type="checkbox" checked={selected.includes(r.id)} onChange={(e) => toggle([r.id], e.target.checked)} className="h-3.5 w-3.5 accent-brand" />
                                {r.employee_name}
                              </label>
                            ) : (
                              <span
                                key={r.id}
                                title={r.review_note ?? undefined}
                                className={`rounded-lg px-2 py-1 text-xs ${r.status === "approved" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700 line-through"}`}
                              >
                                {r.employee_name}
                              </span>
                            )
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-xs text-neutral-500">
        Vàng = chờ duyệt · Xanh = đã duyệt (đã thành ca nháp) · Gạch đỏ = từ chối. “Nghỉ” chỉ để biết, không phải đơn xin phép.
      </p>

      {rejecting && <RejectDialog ids={selected} onClose={() => setRejecting(false)} onDone={done} />}
    </>
  );
}
