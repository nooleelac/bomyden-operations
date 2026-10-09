"use client";

import { useState } from "react";
import ActionForm from "@/components/ActionForm";
import { useFormAction } from "@/components/useFormAction";
import { saveMyRegistrations } from "./actions";
import { dayLabel, daysBetween, weekdayOf } from "@/lib/schedule";
import type { RegistrationStatus } from "@/lib/database.types";

export type MyRegistration = {
  id: string;
  work_date: string;
  template_id: string | null;
  status: RegistrationStatus;
  review_note: string | null;
};
type Template = { id: string; name: string; startTime: string; endTime: string };

const OFF = "off";
const WEEKDAY_SHORT = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

type Props = {
  branchId: string;
  from: string;
  to: string;
  openFrom: string;
  templates: Template[];
  registrations: MyRegistration[];
  shifts: { workDate: string; time: string }[];
};

/** Lựa chọn của 1 ngày: danh sách id mẫu ca, hoặc ["off"] = nghỉ */
type Picks = Record<string, string[]>;

export default function RegisterView({ branchId, from, to, openFrom, templates, registrations, shifts }: Props) {
  const days = daysBetween(from, to);
  const pending = registrations.filter((r) => r.status === "pending");
  const reviewed = registrations.filter((r) => r.status !== "pending");
  const [picks, setPicks] = useState<Picks>(() => {
    const p: Picks = {};
    for (const r of pending) p[r.work_date] = [...(p[r.work_date] ?? []), r.template_id ?? OFF];
    return p;
  });
  const [quick, setQuick] = useState<{ value: string; weekdays: number[] }>({ value: templates[0]?.id ?? OFF, weekdays: [1, 2, 3, 4, 5] });
  const [state, action, isPending] = useFormAction(saveMyRegistrations.bind(null, branchId, from, to));

  const open = (d: string) => d >= openFrom;
  const tplName = (id: string | null) => (id ? (templates.find((t) => t.id === id)?.name ?? "Ca") : "Nghỉ");

  const toggle = (day: string, value: string) =>
    setPicks((p) => {
      const cur = p[day] ?? [];
      if (cur.includes(value)) return { ...p, [day]: cur.filter((v) => v !== value) };
      // Nghỉ và đăng ký ca loại trừ nhau
      return { ...p, [day]: value === OFF ? [OFF] : [...cur.filter((v) => v !== OFF), value] };
    });

  const applyQuick = () =>
    setPicks((p) => {
      const next = { ...p };
      for (const d of days) {
        if (!open(d) || !quick.weekdays.includes(weekdayOf(d))) continue;
        const cur = next[d] ?? [];
        next[d] = quick.value === OFF ? [OFF] : [...new Set([...cur.filter((v) => v !== OFF), quick.value])];
      }
      return next;
    });

  const items = days
    .filter(open)
    .flatMap((d) => (picks[d] ?? []).map((v) => ({ work_date: d, template_id: v === OFF ? null : v })));
  const workDays = days.filter((d) => open(d) && (picks[d] ?? []).some((v) => v !== OFF)).length;
  const openCount = days.filter(open).length;

  return (
    <ActionForm action={action} className="space-y-4">
      <input type="hidden" name="payload" value={JSON.stringify(items)} />

      {openCount > 0 && (
        <div className="card space-y-2 p-3 text-sm">
          <p className="font-medium">Chọn nhanh</p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Ca chọn nhanh"
              value={quick.value}
              onChange={(e) => setQuick((q) => ({ ...q, value: e.target.value }))}
              className="input w-auto py-1.5"
            >
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.startTime}–{t.endTime})</option>)}
              <option value={OFF}>Nghỉ</option>
            </select>
            <span className="text-neutral-500">vào</span>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Các thứ">
              {[1, 2, 3, 4, 5, 6, 0].map((w) => {
                const on = quick.weekdays.includes(w);
                return (
                  <button
                    key={w}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setQuick((q) => ({ ...q, weekdays: on ? q.weekdays.filter((x) => x !== w) : [...q.weekdays, w] }))}
                    className={`w-9 rounded-md border py-1 text-xs font-medium ${on ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 text-neutral-500"}`}
                  >
                    {WEEKDAY_SHORT[w]}
                  </button>
                );
              })}
            </div>
            <button type="button" onClick={applyQuick} className="btn-secondary py-1.5">Áp dụng</button>
            <button type="button" onClick={() => setPicks({})} className="text-xs font-medium text-neutral-500 hover:underline">Xóa hết</button>
          </div>
        </div>
      )}

      <ul className="card divide-y divide-neutral-100">
        {days.map((d) => {
          const isOpen = open(d);
          const done = reviewed.filter((r) => r.work_date === d);
          const myShifts = shifts.filter((s) => s.workDate === d);
          const cur = picks[d] ?? [];
          const lockedPending = isOpen ? [] : pending.filter((r) => r.work_date === d);
          return (
            <li key={d} className={`flex flex-col gap-2 p-3 sm:flex-row sm:items-start ${weekdayOf(d) === 0 ? "bg-neutral-50/60" : ""}`}>
              <div className="w-24 shrink-0 text-sm font-semibold">
                {dayLabel(d)}
                {!isOpen && <span className="block text-xs font-normal text-neutral-400">Đã khóa</span>}
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                {isOpen &&
                  [...templates.map((t) => ({ value: t.id, label: t.name, sub: `${t.startTime}–${t.endTime}` })), { value: OFF, label: "Nghỉ", sub: "" }]
                    .filter((o) => !done.some((r) => (r.template_id ?? OFF) === o.value))
                    .map((o) => {
                      const on = cur.includes(o.value);
                      return (
                        <button
                          key={o.value}
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggle(d, o.value)}
                          className={`rounded-lg border px-2.5 py-1 text-xs ${
                            on
                              ? o.value === OFF
                                ? "border-neutral-500 bg-neutral-500 text-white"
                                : "border-emerald-700 bg-emerald-700 text-white"
                              : "border-neutral-300 text-neutral-700"
                          }`}
                        >
                          <span className="font-medium">{o.label}</span>
                          {o.sub && <span className={`ml-1 ${on ? "text-emerald-100" : "text-neutral-400"}`}>{o.sub}</span>}
                        </button>
                      );
                    })}
                {lockedPending.map((r) => (
                  <span key={r.id} className="rounded-lg bg-amber-50 px-2.5 py-1 text-xs text-amber-800">{tplName(r.template_id)} · chờ duyệt</span>
                ))}
                {done.map((r) => (
                  <span
                    key={r.id}
                    title={r.review_note ?? undefined}
                    className={`rounded-lg px-2.5 py-1 text-xs ${r.status === "approved" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}
                  >
                    {tplName(r.template_id)} · {r.status === "approved" ? "đã duyệt" : `từ chối${r.review_note ? `: ${r.review_note}` : ""}`}
                  </span>
                ))}
                {myShifts.map((s) => (
                  <span key={s.time} className="rounded-lg border border-neutral-200 px-2.5 py-1 text-xs text-neutral-600">Lịch: {s.time}</span>
                ))}
                {!isOpen && lockedPending.length === 0 && done.length === 0 && myShifts.length === 0 && (
                  <span className="py-1 text-xs text-neutral-400">—</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {state.message && <p role="status" className={state.ok ? "alert-success" : "alert-error"}>{state.message}</p>}
      <div className="sticky bottom-3 flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
        <span className="text-sm text-neutral-600">
          {openCount === 0 ? "Khoảng này đã hết hạn đăng ký." : <><strong>{workDays}</strong> ngày đi làm · {items.length} lựa chọn</>}
        </span>
        <button type="submit" disabled={isPending || openCount === 0} className="btn-primary">
          {isPending ? "Đang gửi..." : "Gửi đăng ký"}
        </button>
      </div>
      {openCount > 0 && (
        <p className="text-xs text-neutral-500">
          Đăng ký / sửa được từ ngày {dayLabel(openFrom)} trở đi. Đăng ký đã duyệt không sửa được — muốn đổi hãy gửi đơn xin phép.
        </p>
      )}
    </ActionForm>
  );
}
