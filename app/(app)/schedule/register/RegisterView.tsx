"use client";

import { useState } from "react";
import ActionForm from "@/components/ActionForm";
import { useFormAction } from "@/components/useFormAction";
import { saveMyRegistrations } from "./actions";
import TimeRangePicker, { fitEnd, type TimeRange } from "../TimeRangePicker";
import {
  coverageGaps,
  dayLabel,
  daysBetween,
  hoursLabel,
  rangesOverlap,
  registrationTimeError,
  spanMin,
  startOptions,
  weekdayOf,
  type Coverage,
  type RegisterRules,
} from "@/lib/schedule";
import type { RegistrationStatus } from "@/lib/database.types";

export type MyRegistration = {
  id: string;
  work_date: string;
  template_id: string | null;
  start_time: string | null;
  end_time: string | null;
  approved_start_time: string | null;
  approved_end_time: string | null;
  status: RegistrationStatus;
  review_note: string | null;
};
type Template = { id: string; name: string; startTime: string; endTime: string };

/** 1 ca đang chọn */
type Pick = { start: string; end: string; tpl: string | null };
/** Lựa chọn của 1 ngày: "off" = nghỉ, hoặc danh sách ca */
type DayPick = "off" | Pick[];

const WEEKDAY_SHORT = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

type Props = {
  branchId: string;
  from: string;
  to: string;
  openFrom: string;
  rules: RegisterRules;
  templates: Template[];
  registrations: MyRegistration[];
  shifts: { workDate: string; time: string }[];
  coverage: Coverage | null;
};

const rangeText = (start: string | null, end: string | null) => (start && end ? `${start}–${end}` : "Nghỉ");

export default function RegisterView({ branchId, from, to, openFrom, rules, templates, registrations, shifts, coverage }: Props) {
  const days = daysBetween(from, to);
  const pending = registrations.filter((r) => r.status === "pending");
  const reviewed = registrations.filter((r) => r.status !== "pending");
  // Mẫu ca nằm trong quy định mới dùng làm nút chọn nhanh
  const quickTemplates = templates.filter((t) => !registrationTimeError(rules, t.startTime, t.endTime));
  const firstStart = quickTemplates[0]?.startTime ?? startOptions(rules)[0]?.value ?? rules.earliest;
  const defaultRange: TimeRange = quickTemplates[0]
    ? { start: quickTemplates[0].startTime, end: quickTemplates[0].endTime }
    : { start: firstStart, end: fitEnd(rules, firstStart) };

  const [picks, setPicks] = useState<Record<string, DayPick>>(() => {
    const p: Record<string, DayPick> = {};
    for (const r of pending) {
      if (!r.start_time || !r.end_time) {
        if (!p[r.work_date]) p[r.work_date] = "off";
        continue;
      }
      const cur = p[r.work_date];
      p[r.work_date] = [...(Array.isArray(cur) ? cur : []), { start: r.start_time, end: r.end_time, tpl: r.template_id }];
    }
    return p;
  });
  const [editing, setEditing] = useState<{ day: string; range: TimeRange; tpl: string | null } | null>(null);
  const [quick, setQuick] = useState<{ mode: string; range: TimeRange; weekdays: number[] }>({
    mode: quickTemplates[0] ? `tpl:${quickTemplates[0].id}` : "custom",
    range: defaultRange,
    weekdays: [1, 2, 3, 4, 5],
  });
  const [quickMsg, setQuickMsg] = useState("");
  const [state, action, isPending] = useFormAction(saveMyRegistrations.bind(null, branchId, from, to));

  const open = (d: string) => d >= openFrom;
  const tplName = (id: string | null) => (id ? templates.find((t) => t.id === id)?.name : undefined);

  /** Ca đã duyệt trong ngày (không đổi được) */
  const fixedOf = (day: string) =>
    reviewed
      .filter((r) => r.work_date === day && r.status === "approved" && r.approved_start_time && r.approved_end_time)
      .map((r) => ({ start: r.approved_start_time!, end: r.approved_end_time! }));

  /** Lý do không thêm được ca `p` vào ngày (null = thêm được) */
  const checkAdd = (day: string, list: Pick[], p: TimeRange): string | null => {
    const err = registrationTimeError(rules, p.start, p.end);
    if (err) return err;
    const others = [...fixedOf(day), ...list];
    const clash = others.find((o) => rangesOverlap(o, p));
    if (clash) return `Trùng giờ với ca ${clash.start}–${clash.end}.`;
    if (others.length + 1 > rules.max_per_day) return `Tối đa ${rules.max_per_day} ca/ngày.`;
    const total = others.reduce((sum, o) => sum + spanMin(o.start, o.end), 0) + spanMin(p.start, p.end);
    if (others.length >= 1 && total > rules.max_day) return `Có từ 2 ca trở lên thì tổng tối đa ${hoursLabel(rules.max_day)}/ngày (đang ${hoursLabel(total)}).`;
    return null;
  };

  const listOf = (day: string): Pick[] => {
    const cur = picks[day];
    return Array.isArray(cur) ? cur : [];
  };

  const addPick = (day: string, p: Pick) => setPicks((s) => ({ ...s, [day]: [...listOf(day), p].sort((a, b) => a.start.localeCompare(b.start)) }));
  const removePick = (day: string, start: string) => setPicks((s) => ({ ...s, [day]: listOf(day).filter((x) => x.start !== start) }));
  const toggleOff = (day: string) =>
    setPicks((s) => {
      const next = { ...s };
      if (s[day] === "off") delete next[day];
      else next[day] = "off";
      return next;
    });

  const quickRange = (): (TimeRange & { tpl: string | null }) | null => {
    if (quick.mode === "off") return null;
    if (quick.mode.startsWith("tpl:")) {
      const t = quickTemplates.find((x) => `tpl:${x.id}` === quick.mode);
      if (t) return { start: t.startTime, end: t.endTime, tpl: t.id };
    }
    return { ...quick.range, tpl: null };
  };

  const applyQuick = () => {
    const r = quickRange();
    let done = 0;
    let skipped = 0;
    const next = { ...picks };
    for (const d of days) {
      if (!open(d) || !quick.weekdays.includes(weekdayOf(d))) continue;
      if (!r) {
        next[d] = "off";
        done++;
        continue;
      }
      const cur = Array.isArray(next[d]) ? (next[d] as Pick[]) : [];
      if (cur.some((x) => x.start === r.start && x.end === r.end)) continue;
      if (checkAdd(d, cur, r)) {
        skipped++;
        continue;
      }
      next[d] = [...cur, { start: r.start, end: r.end, tpl: r.tpl }].sort((a, b) => a.start.localeCompare(b.start));
      done++;
    }
    setPicks(next);
    setQuickMsg(`Đã áp dụng cho ${done} ngày.` + (skipped ? ` Bỏ qua ${skipped} ngày vì trùng giờ hoặc vượt giới hạn trong ngày.` : ""));
  };

  type Item = { work_date: string; start_time: string | null; end_time: string | null; template_id: string | null };
  const items = days
    .filter(open)
    .flatMap((d): Item[] => {
      const cur = picks[d];
      if (cur === "off") return [{ work_date: d, start_time: null, end_time: null, template_id: null }];
      return (cur ?? []).map((p) => ({ work_date: d, start_time: p.start, end_time: p.end, template_id: p.tpl }));
    });
  const workItems = items.filter((i) => i.start_time);
  const workDays = new Set(workItems.map((i) => i.work_date)).size;
  const totalMin = workItems.reduce((sum, i) => sum + spanMin(i.start_time!, i.end_time!), 0);
  const openCount = days.filter(open).length;
  const editErr = editing ? checkAdd(editing.day, listOf(editing.day), editing.range) : null;

  return (
    <ActionForm action={action} className="space-y-4">
      <input type="hidden" name="payload" value={JSON.stringify(items)} />

      {openCount > 0 && (
        <div className="card space-y-2 p-3 text-sm">
          <p className="font-medium">Chọn nhanh cho nhiều ngày</p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Ca chọn nhanh"
              value={quick.mode}
              onChange={(e) => setQuick((q) => ({ ...q, mode: e.target.value }))}
              className="input w-auto py-1.5"
            >
              {quickTemplates.map((t) => <option key={t.id} value={`tpl:${t.id}`}>{t.name} ({t.startTime}–{t.endTime})</option>)}
              <option value="custom">Tự chọn giờ…</option>
              <option value="off">Nghỉ</option>
            </select>
            {quick.mode === "custom" && (
              <TimeRangePicker rules={rules} idPrefix="quick" value={quick.range} onChange={(range) => setQuick((q) => ({ ...q, range }))} />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
                    className={`w-9 rounded-md border py-1 text-xs font-medium ${on ? "border-brand bg-brand text-brand-fg" : "border-neutral-300 text-neutral-500"}`}
                  >
                    {WEEKDAY_SHORT[w]}
                  </button>
                );
              })}
            </div>
            <button type="button" onClick={applyQuick} className="btn-secondary py-1.5">Áp dụng</button>
            <button type="button" onClick={() => { setPicks({}); setQuickMsg(""); }} className="text-xs font-medium text-neutral-500 hover:underline">Xóa hết</button>
          </div>
          {quickMsg && <p className="text-xs text-neutral-600">{quickMsg}</p>}
        </div>
      )}

      <ul className="card divide-y divide-neutral-100">
        {days.map((d) => {
          const isOpen = open(d);
          const done = reviewed.filter((r) => r.work_date === d);
          const myShifts = shifts.filter((s) => s.workDate === d);
          const cur = picks[d];
          const list = listOf(d);
          const lockedPending = isOpen ? [] : pending.filter((r) => r.work_date === d);
          const canAdd = isOpen && cur !== "off" && fixedOf(d).length + list.length < rules.max_per_day;
          const covDay = coverage?.days.find((c) => c.date === d);
          const gaps = isOpen && coverage && covDay ? coverageGaps(coverage, covDay) : [];
          const isEditing = editing?.day === d;
          return (
            <li key={d} className={`flex flex-col gap-2 p-3 sm:flex-row sm:items-start ${weekdayOf(d) === 0 ? "bg-neutral-50/60" : ""}`}>
              <div className="w-24 shrink-0 text-sm font-semibold">
                {dayLabel(d)}
                {!isOpen && <span className="block text-xs font-normal text-neutral-400">Đã khóa</span>}
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {cur === "off" && isOpen && (
                    <span className="flex items-center gap-1 rounded-lg bg-neutral-500 px-2.5 py-1 text-xs font-medium text-white">
                      Nghỉ
                      <button type="button" aria-label="Bỏ chọn nghỉ" onClick={() => toggleOff(d)} className="ml-1 text-neutral-200 hover:text-white">✕</button>
                    </span>
                  )}
                  {isOpen &&
                    list.map((p) => (
                      <span key={p.start} className="flex items-center gap-1 rounded-lg bg-emerald-700 px-2.5 py-1 text-xs text-white">
                        <span className="font-medium">{p.start}–{p.end}</span>
                        <span className="text-emerald-100">{tplName(p.tpl) ?? hoursLabel(spanMin(p.start, p.end))}</span>
                        <button type="button" aria-label={`Bỏ ca ${p.start}–${p.end}`} onClick={() => removePick(d, p.start)} className="ml-1 text-emerald-200 hover:text-white">✕</button>
                      </span>
                    ))}
                  {lockedPending.map((r) => (
                    <span key={r.id} className="rounded-lg bg-amber-50 px-2.5 py-1 text-xs text-amber-800">{rangeText(r.start_time, r.end_time)} · chờ duyệt</span>
                  ))}
                  {done.map((r) => {
                    const changed = r.status === "approved" && r.start_time && (r.approved_start_time !== r.start_time || r.approved_end_time !== r.end_time);
                    return (
                      <span
                        key={r.id}
                        title={r.review_note ?? undefined}
                        className={`rounded-lg px-2.5 py-1 text-xs ${r.status === "approved" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}
                      >
                        {r.status === "approved"
                          ? `${rangeText(r.approved_start_time ?? r.start_time, r.approved_end_time ?? r.end_time)} · đã duyệt${changed ? ` (bạn xin ${r.start_time}–${r.end_time})` : ""}`
                          : `${rangeText(r.start_time, r.end_time)} · từ chối${r.review_note ? `: ${r.review_note}` : ""}`}
                      </span>
                    );
                  })}
                  {myShifts.map((s) => (
                    <span key={s.time} className="rounded-lg border border-neutral-200 px-2.5 py-1 text-xs text-neutral-600">Lịch: {s.time}</span>
                  ))}
                  {isOpen && !isEditing && canAdd && (
                    <button
                      type="button"
                      onClick={() => setEditing({ day: d, range: list.length ? { start: firstStart, end: fitEnd(rules, firstStart) } : defaultRange, tpl: null })}
                      className="rounded-lg border border-dashed border-emerald-600 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                    >
                      + {list.length ? "Thêm ca" : "Đăng ký ca"}
                    </button>
                  )}
                  {isOpen && cur !== "off" && list.length === 0 && !isEditing && (
                    <button type="button" onClick={() => toggleOff(d)} className="rounded-lg border border-neutral-300 px-2.5 py-1 text-xs text-neutral-600 hover:bg-neutral-50">
                      Nghỉ
                    </button>
                  )}
                  {!isOpen && lockedPending.length === 0 && done.length === 0 && myShifts.length === 0 && (
                    <span className="py-1 text-xs text-neutral-400">—</span>
                  )}
                </div>

                {isEditing && editing && (
                  <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/40 p-2.5">
                    {quickTemplates.length > 0 && (
                      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Mẫu ca chọn nhanh">
                        {quickTemplates.map((t) => {
                          const on = editing.range.start === t.startTime && editing.range.end === t.endTime;
                          return (
                            <button
                              key={t.id}
                              type="button"
                              aria-pressed={on}
                              onClick={() => setEditing({ ...editing, range: { start: t.startTime, end: t.endTime }, tpl: t.id })}
                              className={`rounded-lg border px-2 py-0.5 text-xs ${on ? "border-emerald-700 bg-emerald-700 text-white" : "border-neutral-300 bg-white text-neutral-700"}`}
                            >
                              <span className="font-medium">{t.name}</span> <span className={on ? "text-emerald-100" : "text-neutral-400"}>{t.startTime}–{t.endTime}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <TimeRangePicker
                      rules={rules}
                      idPrefix={`d-${d}`}
                      value={editing.range}
                      onChange={(range) => setEditing({ ...editing, range, tpl: null })}
                    />
                    {editErr && <p className="text-xs text-red-600">{editErr}</p>}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={!!editErr}
                        onClick={() => {
                          const t = editing.tpl ?? quickTemplates.find((x) => x.startTime === editing.range.start && x.endTime === editing.range.end)?.id ?? null;
                          addPick(d, { ...editing.range, tpl: t });
                          setEditing(null);
                        }}
                        className="btn-primary py-1 text-xs"
                      >
                        Thêm ca này
                      </button>
                      <button type="button" onClick={() => setEditing(null)} className="btn-secondary py-1 text-xs">Hủy</button>
                    </div>
                  </div>
                )}

                {gaps.length > 0 && (
                  <p className="text-xs text-amber-700">
                    Đang cần thêm người: {gaps.map((g) => `${g.from}–${g.to} (thiếu ${g.missing})`).join(", ")}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {state.message && <p role="status" className={state.ok ? "alert-success" : "alert-error"}>{state.message}</p>}
      <div className="sticky bottom-[calc(var(--nav-h)+0.75rem)] flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
        <span className="text-sm text-neutral-600">
          {openCount === 0 ? (
            "Khoảng này đã hết hạn đăng ký."
          ) : (
            <><strong>{workDays}</strong> ngày đi làm · {workItems.length} ca · {hoursLabel(totalMin)}</>
          )}
        </span>
        <button type="submit" disabled={isPending || openCount === 0 || !!editing} className="btn-primary">
          {isPending ? "Đang gửi..." : "Gửi đăng ký"}
        </button>
      </div>
      {openCount > 0 && (
        <p className="text-xs text-neutral-500">
          Đăng ký / sửa được từ ngày {dayLabel(openFrom)} trở đi. Giờ vào từ {rules.earliest}, ra muộn nhất {rules.latest}
          {windowNextDay(rules) ? " hôm sau" : ""}; mỗi ca {hoursLabel(rules.min)}–{hoursLabel(rules.max)}, tối đa {rules.max_per_day} ca/ngày
          {rules.max_per_day > 1 ? ` (từ 2 ca trở lên tổng tối đa ${hoursLabel(rules.max_day)})` : ""}. Đăng ký đã duyệt không sửa được — muốn đổi hãy gửi đơn xin phép.
        </p>
      )}
    </ActionForm>
  );
}

function windowNextDay(rules: RegisterRules) {
  return rules.latest <= rules.earliest;
}
