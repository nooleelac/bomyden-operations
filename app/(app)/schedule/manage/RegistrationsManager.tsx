"use client";

import { startTransition, useState } from "react";
import ActionForm from "@/components/ActionForm";
import Dialog from "@/components/Dialog";
import SubmitButton from "@/components/SubmitButton";
import { useFormAction } from "@/components/useFormAction";
import { addStaffingRequirement, deleteStaffingRequirement, reviewRegistrations, setSelfSchedule } from "./actions";
import TimeRangePicker, { fitEnd, type TimeRange } from "../TimeRangePicker";
import {
  coverageGaps,
  dayLabel,
  fromMin,
  hoursLabel,
  managerRules,
  spanMin,
  startOptions,
  type Coverage,
  type CoverageDay,
  type RegisterRules,
} from "@/lib/schedule";
import type { RegistrationStatus } from "@/lib/database.types";

export type BranchRegistration = {
  id: string;
  employee_id: string;
  employee_name: string;
  work_date: string;
  template_id: string | null;
  start_time: string | null;
  end_time: string | null;
  approved_start_time: string | null;
  approved_end_time: string | null;
  status: RegistrationStatus;
  review_note: string | null;
};
export type RegTemplate = { id: string; name: string; startTime: string; endTime: string };
export type SelfScheduleStaff = { id: string; name: string; roleLabel: string; enabled: boolean };
export type StaffingRow = { id: string; weekdays: number[]; startTime: string; endTime: string; headcount: number };

const WEEKDAY_SHORT = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

function weekdaysText(days: number[]): string {
  if (days.length === 7) return "Mọi ngày";
  return WEEK_ORDER.filter((d) => days.includes(d)).map((d) => WEEKDAY_SHORT[d]).join(", ");
}

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
          <textarea id="rj-note" name="review_note" rows={2} required maxLength={200} placeholder="Ví dụ: Khung giờ này đã đủ người" className="input" />
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

/** QL sửa giờ rồi duyệt 1 đăng ký */
function ApproveEditDialog({ reg, step, onClose, onDone }: { reg: BranchRegistration; step: number; onClose: () => void; onDone: (m: string) => void }) {
  const [state, action, pending] = useFormAction(reviewRegistrations.bind(null, true), (r) => onDone(r.message));
  const [range, setRange] = useState<TimeRange>({ start: reg.start_time!, end: reg.end_time! });
  const rules = managerRules(step);
  const changed = range.start !== reg.start_time || range.end !== reg.end_time;
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Duyệt ca của ${reg.employee_name}`}
      description={`${dayLabel(reg.work_date)} · nhân viên xin ${reg.start_time}–${reg.end_time}`}
    >
      <ActionForm action={action} className="space-y-4">
        <input type="hidden" name="ids" value={reg.id} />
        <div>
          <p className="mb-1.5 text-sm font-medium text-neutral-700">Giờ duyệt</p>
          <TimeRangePicker rules={rules} idPrefix="ap" value={range} onChange={setRange} startName="start_time" endName="end_time" />
          <p className="mt-1 text-xs text-neutral-500">
            {hoursLabel(spanMin(range.start, range.end))}
            {changed ? " · nhân viên sẽ được báo giờ đã chỉnh." : ""}
          </p>
          {state.fieldErrors?.end_time && <p className="field-error">{state.fieldErrors.end_time}</p>}
        </div>
        <div>
          <label htmlFor="ap-note" className="mb-1.5 block text-sm font-medium text-neutral-700">Ghi chú cho nhân viên (không bắt buộc)</label>
          <input id="ap-note" name="review_note" maxLength={200} placeholder="Ví dụ: 16h–17h đã đủ người" className="input" />
        </div>
        {state.message && !state.ok && <p role="alert" className="alert-error">{state.message}</p>}
        <div className="flex justify-end gap-3 border-t border-neutral-100 pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">Đóng</button>
          <SubmitButton pending={pending}>{changed ? "Duyệt với giờ đã sửa" : "Duyệt"}</SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}

/** Biểu đồ phủ ca theo ô giờ của 1 ngày */
function CoverageStrip({ coverage, day }: { coverage: Coverage; day: CoverageDay }) {
  const hasNeed = day.need.some((n) => n > 0);
  const cellClass = (i: number) => {
    const need = day.need[i];
    const sched = day.scheduled[i];
    const pend = day.pending[i];
    if (need > 0) {
      if (sched >= need) return sched > need ? "bg-emerald-200 text-emerald-900" : "bg-emerald-100 text-emerald-900";
      if (sched + pend >= need) return "bg-amber-100 text-amber-900";
      return "bg-red-100 text-red-800";
    }
    return sched > 0 ? "bg-neutral-100 text-neutral-800" : "text-neutral-300";
  };
  const rows: { label: string; values: number[]; cls?: (i: number) => string; show: boolean }[] = [
    { label: "Cần", values: day.need, show: hasNeed },
    { label: "Đã xếp", values: day.scheduled, cls: cellClass, show: true },
    { label: "Chờ duyệt", values: day.pending, show: day.pending.some((n) => n > 0) },
  ];
  const gaps = coverageGaps(coverage, day);
  // Cuộn tới ô đầu tiên có dữ liệu (khung tối hay bị khuất trên điện thoại)
  const firstIdx = day.need.findIndex((n, i) => n > 0 || day.scheduled[i] > 0 || day.pending[i] > 0);
  return (
    <div className="space-y-1">
      {hasNeed && (
        <p className={`text-xs font-medium ${gaps.length ? "text-red-700" : "text-emerald-700"}`}>
          {gaps.length ? `Thiếu người: ${gaps.map((g) => `${g.from}–${g.to} (thiếu ${g.missing})`).join(", ")}` : "Đủ định mức (tính cả đăng ký chờ duyệt)."}
        </p>
      )}
      <div
        ref={(el) => {
          if (el && firstIdx > 0 && !el.dataset.scrolled) {
            el.dataset.scrolled = "1";
            el.scrollLeft = Math.max(0, firstIdx - 1) * 24;
          }
        }}
        className="overflow-x-auto rounded-lg border border-neutral-100"
      >
        <table className="border-collapse text-[11px] tabular-nums">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-white" />
              {day.need.map((_, i) => {
                const t = coverage.start + i * coverage.step;
                return (
                  <th key={i} className="h-4 w-6 min-w-6 px-0 text-left font-normal text-neutral-400">
                    {t % 60 === 0 ? fromMin(t).slice(0, 2) : ""}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows
              .filter((r) => r.show)
              .map((r) => (
                <tr key={r.label}>
                  <th className="sticky left-0 z-10 whitespace-nowrap bg-white pr-2 text-left font-medium text-neutral-500">{r.label}</th>
                  {r.values.map((v, i) => {
                    const t = coverage.start + i * coverage.step;
                    return (
                      <td
                        key={i}
                        title={`${fromMin(t)}–${fromMin(t + coverage.step)}: cần ${day.need[i]} · đã xếp ${day.scheduled[i]} · chờ duyệt ${day.pending[i]}`}
                        className={`h-6 w-6 min-w-6 border-l border-white text-center ${r.cls ? r.cls(i) : v > 0 ? "text-neutral-700" : "text-neutral-300"}`}
                      >
                        {v || "·"}
                      </td>
                    );
                  })}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StaffingDeleteButton({ row, onDone }: { row: StaffingRow; onDone: (m: string) => void }) {
  const [state, action, pending] = useFormAction(() => deleteStaffingRequirement(row.id), (r) => onDone(r.message));
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (window.confirm(`Xóa định mức ${weekdaysText(row.weekdays)} ${row.startTime}–${row.endTime}?`)) startTransition(() => action(new FormData()));
        }}
        className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
      >
        Xóa
      </button>
      {state.message && !state.ok && <span className="text-xs text-red-600">{state.message}</span>}
    </>
  );
}

/** Định mức nhân sự theo khung giờ */
function StaffingPanel({ branchId, rows, rules, onDone }: { branchId: string; rows: StaffingRow[]; rules: RegisterRules; onDone: (m: string) => void }) {
  const first = startOptions({ ...rules, min: rules.step })[0]?.value ?? rules.earliest;
  const [range, setRange] = useState<TimeRange>({ start: first, end: fitEnd({ ...rules, min: rules.step, max: 1440 }, first) });
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [formKey, setFormKey] = useState(0);
  const [state, action, pending] = useFormAction(addStaffingRequirement.bind(null, branchId), (r) => {
    onDone(r.message);
    setFormKey((k) => k + 1);
  });
  // Khung giờ định mức: trong khung giờ đăng ký, khung ngắn nhất = 1 bước
  const reqRules: RegisterRules = { ...rules, min: rules.step, max: 1440 };
  return (
    <details className="card mb-4 p-4">
      <summary className="cursor-pointer text-sm font-semibold">
        Định mức nhân sự theo giờ <span className="font-normal text-neutral-500">({rows.length})</span>
      </summary>
      <p className="mt-2 text-xs text-neutral-500">
        Mỗi khung giờ cần bao nhiêu người. Biểu đồ bên dưới tô đỏ chỗ thiếu; nhân viên khi đăng ký cũng thấy khung đang cần người.
        Nhiều định mức chồng nhau → lấy số lớn nhất.
      </p>
      {rows.length > 0 && (
        <ul className="mt-2 divide-y divide-neutral-100">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span>
                <span className="font-medium">{r.startTime}–{r.endTime}</span>
                <span className="text-neutral-500"> · {weekdaysText(r.weekdays)}</span>
                <span className="ml-2 rounded bg-neutral-100 px-1.5 py-0.5 text-xs font-semibold">{r.headcount} người</span>
              </span>
              <StaffingDeleteButton row={r} onDone={onDone} />
            </li>
          ))}
        </ul>
      )}
      <ActionForm key={formKey} action={action} className="mt-3 space-y-2 rounded-lg border border-neutral-200 p-3 text-sm">
        <p className="font-medium">Thêm định mức</p>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Các thứ áp dụng">
          {WEEK_ORDER.map((w) => {
            const on = days.includes(w);
            return (
              <button
                key={w}
                type="button"
                aria-pressed={on}
                onClick={() => setDays((d) => (on ? d.filter((x) => x !== w) : [...d, w]))}
                className={`w-9 rounded-md border py-1 text-xs font-medium ${on ? "border-brand bg-brand text-brand-fg" : "border-neutral-300 text-neutral-500"}`}
              >
                {WEEKDAY_SHORT[w]}
              </button>
            );
          })}
        </div>
        {days.map((d) => <input key={d} type="hidden" name="weekdays" value={d} />)}
        <div className="flex flex-wrap items-center gap-2">
          <TimeRangePicker rules={reqRules} idPrefix="st" value={range} onChange={setRange} startName="start_time" endName="end_time" />
          <label htmlFor="st-headcount" className="text-neutral-500">cần</label>
          <input id="st-headcount" name="headcount" type="number" min={1} max={50} defaultValue={2} required className="input w-20 py-1.5" />
          <span className="text-neutral-500">người</span>
          <SubmitButton pending={pending}>Thêm</SubmitButton>
        </div>
        {Object.values(state.fieldErrors ?? {}).map((m) => <p key={m} className="field-error">{m}</p>)}
        {state.message && !state.ok && !state.fieldErrors && <p role="alert" className="alert-error">{state.message}</p>}
      </ActionForm>
    </details>
  );
}

export function RegistrationsManager({
  branchId,
  registrations,
  templates,
  coverage,
  rules,
  staffing,
  staff,
}: {
  branchId: string;
  registrations: BranchRegistration[];
  templates: RegTemplate[];
  coverage: Coverage | null;
  rules: RegisterRules;
  staffing: StaffingRow[];
  staff: SelfScheduleStaff[];
}) {
  const [toast, setToast] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [rejecting, setRejecting] = useState(false);
  const [editing, setEditing] = useState<BranchRegistration | null>(null);
  const done = (m: string) => {
    setToast(m);
    setSelected([]);
    setRejecting(false);
    setEditing(null);
  };
  const [approveState, approveAction, approvePending] = useFormAction(reviewRegistrations.bind(null, true), (r) => done(r.message));

  const pendingIds = registrations.filter((r) => r.status === "pending").map((r) => r.id);
  const covDays = (coverage?.days ?? []).filter((c) => c.need.some((n) => n > 0) || c.scheduled.some((n) => n > 0));
  const days = [...new Set([...registrations.map((r) => r.work_date), ...covDays.map((c) => c.date)])].sort();
  const enabledCount = staff.filter((s) => s.enabled).length;
  const tplName = (id: string | null) => (id ? templates.find((t) => t.id === id)?.name : undefined);
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

      <StaffingPanel key={branchId} branchId={branchId} rows={staffing} rules={rules} onDone={setToast} />

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
                if (window.confirm(`Duyệt toàn bộ ${pendingIds.length} đăng ký đang chờ (giữ nguyên giờ nhân viên xin)? Các ca sẽ được tạo ở dạng nháp.`)) approve(pendingIds);
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
            const covDay = coverage?.days.find((c) => c.date === d);
            // Nhóm theo khung giờ NV xin; "Nghỉ" cuối cùng
            const groups = [...new Set(dayRegs.map((r) => (r.start_time ? `${r.start_time}–${r.end_time}` : "")))].sort((a, b) =>
              a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)
            );
            return (
              <li key={d} className="card space-y-2 p-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{dayLabel(d)}</h3>
                  {dayPending.length > 0 && (
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-neutral-600">
                      <input type="checkbox" checked={allOn} onChange={(e) => toggle(dayPending, e.target.checked)} className="h-4 w-4 accent-brand" />
                      Chọn cả ngày ({dayPending.length})
                    </label>
                  )}
                </div>
                {coverage && covDay && <CoverageStrip coverage={coverage} day={covDay} />}
                {groups.map((g) => {
                  const regs = dayRegs.filter((r) => (r.start_time ? `${r.start_time}–${r.end_time}` : "") === g);
                  const sample = regs[0];
                  const name = tplName(sample.template_id);
                  return (
                    <div key={g || "off"} className="flex flex-col gap-1.5 sm:flex-row sm:items-start">
                      <div className="w-36 shrink-0 text-xs">
                        <span className="font-semibold">{g || "Nghỉ"}</span>
                        {sample.start_time && (
                          <span className="block text-neutral-400">
                            {name ? `${name} · ` : ""}
                            {hoursLabel(spanMin(sample.start_time, sample.end_time!))}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {regs.map((r) => {
                          if (r.status !== "pending") {
                            const changed = r.status === "approved" && r.start_time && (r.approved_start_time !== r.start_time || r.approved_end_time !== r.end_time);
                            return (
                              <span
                                key={r.id}
                                title={r.review_note ?? undefined}
                                className={`rounded-lg px-2 py-1 text-xs ${r.status === "approved" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700 line-through"}`}
                              >
                                {r.employee_name}
                                {changed && ` → ${r.approved_start_time}–${r.approved_end_time}`}
                              </span>
                            );
                          }
                          return (
                            <span
                              key={r.id}
                              className={`flex items-center rounded-lg border text-xs ${selected.includes(r.id) ? "border-brand bg-brand/5" : "border-amber-300 bg-amber-50"}`}
                            >
                              <label className="flex cursor-pointer items-center gap-1.5 py-1 pl-2 pr-1.5">
                                <input type="checkbox" checked={selected.includes(r.id)} onChange={(e) => toggle([r.id], e.target.checked)} className="h-3.5 w-3.5 accent-brand" />
                                {r.employee_name}
                              </label>
                              {r.start_time && (
                                <button
                                  type="button"
                                  onClick={() => setEditing(r)}
                                  aria-label={`Sửa giờ rồi duyệt: ${r.employee_name}`}
                                  title="Sửa giờ rồi duyệt"
                                  className="border-l border-amber-300 px-1.5 py-1 text-amber-800 hover:bg-amber-100"
                                >
                                  ✎
                                </button>
                              )}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-xs text-neutral-500">
        Vàng = chờ duyệt (✎ = sửa giờ rồi duyệt) · Xanh = đã duyệt (đã thành ca nháp; “→” là giờ đã chỉnh) · Gạch đỏ = từ chối. “Nghỉ” chỉ để biết,
        không phải đơn xin phép. Biểu đồ: số người đã xếp mỗi {coverage?.step ?? rules.step} phút — xanh = đủ định mức, vàng = đủ nếu duyệt hết đăng ký chờ, đỏ = thiếu.
      </p>

      {rejecting && <RejectDialog ids={selected} onClose={() => setRejecting(false)} onDone={done} />}
      {editing && <ApproveEditDialog reg={editing} step={rules.step} onClose={() => setEditing(null)} onDone={done} />}
    </>
  );
}
