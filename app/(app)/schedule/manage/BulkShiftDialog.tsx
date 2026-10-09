"use client";

import { useMemo, useState } from "react";
import ActionForm from "@/components/ActionForm";
import Dialog from "@/components/Dialog";
import { useFormAction } from "@/components/useFormAction";
import { bulkCreateShifts } from "./actions";
import { addDays, dayLabel, daysBetween, monthEndOf, weekdayOf, type ScheduleShift } from "@/lib/schedule";
import type { TemplateOption } from "./ShiftDialog";

const MAX_DAYS = 62;
const WEEKDAY_SHORT = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

type Props = {
  branchId: string;
  branchName: string;
  weekStart: string;
  today: string;
  staff: { id: string; name: string }[];
  templates: TemplateOption[];
  shifts: ScheduleShift[];
  onClose: () => void;
  onDone: (message: string) => void;
};

/** Bỏ dấu để tìm tên tiếng Việt: "nguyen" khớp "Nguyễn" */
function fold(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
}

/**
 * Xếp nhanh theo ca: chọn ngày → chọn mẫu ca → tick nhân viên (lặp cho từng ca) → tạo hàng loạt ca nháp.
 */
export default function BulkShiftDialog({ branchId, branchName, weekStart, today, staff, templates, shifts, onClose, onDone }: Props) {
  const weekEnd = addDays(weekStart, 6);
  const firstOpen = weekStart < today ? today : weekStart;
  const [range, setRange] = useState({ from: firstOpen, to: weekEnd < firstOpen ? firstOpen : weekEnd });
  // Thứ được áp dụng (0 = CN … 6 = T7)
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5, 6, 0]);
  const rangeDays = range.from && range.to ? daysBetween(range.from, range.to) : [];
  const tooLong = rangeDays.length > MAX_DAYS;
  const dates = tooLong ? [] : rangeDays.filter((d) => d >= today && weekdays.includes(weekdayOf(d)));
  const inViewedWeek = dates.every((d) => d >= weekStart && d <= weekEnd);
  const nextMonth = addDays(monthEndOf(firstOpen), 1);
  const presets = [
    { label: "Tuần đang xem", from: firstOpen, to: weekEnd },
    { label: "2 tuần", from: firstOpen, to: addDays(weekStart, 13) },
    { label: "4 tuần", from: firstOpen, to: addDays(weekStart, 27) },
    { label: "Hết tháng này", from: firstOpen, to: monthEndOf(firstOpen) },
    { label: "Tháng sau", from: nextMonth, to: monthEndOf(nextMonth) },
  ];
  const [activeId, setActiveId] = useState(templates[0]?.id ?? "");
  // mẫu ca → danh sách NV đã tick
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [query, setQuery] = useState("");
  const [state, formAction, pending] = useFormAction(bulkCreateShifts.bind(null, branchId), (r) => onDone(r.message));

  const active = templates.find((t) => t.id === activeId);
  const activePicked = picked[activeId] ?? [];
  const visible = useMemo(() => {
    const q = fold(query.trim());
    return q ? staff.filter((s) => fold(s.name).includes(q)) : staff;
  }, [staff, query]);

  // Ca đã có (chưa hủy) trong các ngày đang chọn, theo NV
  const existing = new Map<string, ScheduleShift[]>();
  for (const s of shifts) {
    if (s.status === "cancelled" || !dates.includes(s.work_date)) continue;
    existing.set(s.employee_id, [...(existing.get(s.employee_id) ?? []), s]);
  }

  const assignments = templates
    .map((t) => ({ template_id: t.id, employee_ids: picked[t.id] ?? [] }))
    .filter((a) => a.employee_ids.length > 0);
  const totalPeople = assignments.reduce((n, a) => n + a.employee_ids.length, 0);
  const totalShifts = totalPeople * dates.length;

  const setActivePicked = (ids: string[]) => setPicked((p) => ({ ...p, [activeId]: ids }));
  const toggle = (id: string) =>
    setActivePicked(activePicked.includes(id) ? activePicked.filter((x) => x !== id) : [...activePicked, id]);
  const toggleWeekday = (w: number) => setWeekdays((ws) => (ws.includes(w) ? ws.filter((x) => x !== w) : [...ws, w]));
  const allVisiblePicked = visible.length > 0 && visible.every((s) => activePicked.includes(s.id));

  if (templates.length === 0) {
    return (
      <Dialog open onClose={onClose} title="Xếp nhanh theo ca" description={branchName}>
        <p className="text-sm text-neutral-600">
          Chi nhánh chưa có mẫu ca nào. Hãy tạo mẫu ca (ví dụ: Ca sáng, Ca trưa, Ca tối) ở mục <strong>Mẫu ca</strong> trước.
        </p>
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className="btn-secondary">Đóng</button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={onClose} title="Xếp nhanh theo ca" description={`${branchName} · chọn ngày, chọn ca rồi tick nhân viên`}>
      <ActionForm action={formAction} className="space-y-5">
        <input type="hidden" name="payload" value={JSON.stringify({ dates, assignments })} />

        {/* 1. Ngày */}
        <section>
          <h3 className="mb-2 text-sm font-semibold text-neutral-800">1. Áp dụng cho ngày</h3>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {presets.map((p) => {
              const on = range.from === p.from && range.to === p.to;
              return (
                <button
                  key={p.label}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setRange({ from: p.from, to: p.to })}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${on ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 text-neutral-700"}`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-neutral-500">
              Từ ngày
              <input type="date" min={today} value={range.from} required onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className="input mt-1" />
            </label>
            <label className="text-xs text-neutral-500">
              Đến ngày
              <input type="date" min={range.from || today} value={range.to} required onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className="input mt-1" />
            </label>
          </div>
          <div className="mt-2 grid grid-cols-7 gap-1.5" role="group" aria-label="Áp dụng cho các thứ">
            {[1, 2, 3, 4, 5, 6, 0].map((w) => {
              const on = weekdays.includes(w);
              return (
                <button
                  key={w}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleWeekday(w)}
                  className={`rounded-lg border py-1.5 text-xs font-medium ${on ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 text-neutral-400 line-through"}`}
                >
                  {WEEKDAY_SHORT[w]}
                </button>
              );
            })}
          </div>
          <p className={`mt-1.5 text-xs ${tooLong ? "text-red-600" : "text-neutral-500"}`}>
            {tooLong
              ? `Tối đa ${MAX_DAYS} ngày mỗi lần.`
              : dates.length
                ? `${dates.length} ngày: ${dayLabel(dates[0])} → ${dayLabel(dates[dates.length - 1])}${rangeDays.some((d) => d < today) ? " (bỏ qua ngày đã qua)" : ""}`
                : "Chưa có ngày nào được chọn."}
          </p>
        </section>

        {/* 2. Ca */}
        <section>
          <h3 className="mb-2 text-sm font-semibold text-neutral-800">2. Chọn ca</h3>
          <div className="flex flex-wrap gap-1.5">
            {templates.map((t) => {
              const n = picked[t.id]?.length ?? 0;
              const on = t.id === activeId;
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setActiveId(t.id)}
                  className={`rounded-lg border px-3 py-1.5 text-left text-sm ${on ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 text-neutral-700"}`}
                >
                  <span className="font-medium">{t.name}</span>
                  <span className={`ml-1 text-xs ${on ? "text-neutral-300" : "text-neutral-500"}`}>{t.startTime}–{t.endTime}</span>
                  {n > 0 && (
                    <span className={`ml-2 rounded-full px-1.5 py-0.5 text-xs font-semibold ${on ? "bg-white text-neutral-900" : "bg-emerald-100 text-emerald-800"}`}>{n}</span>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {/* 3. Nhân viên */}
        <section>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-neutral-800">
              3. Tick nhân viên cho <span className="text-emerald-700">{active?.name}</span>
              <span className="ml-1 font-normal text-neutral-500">({activePicked.length}/{staff.length})</span>
            </h3>
            <button
              type="button"
              onClick={() =>
                allVisiblePicked
                  ? setActivePicked(activePicked.filter((id) => !visible.some((s) => s.id === id)))
                  : setActivePicked([...new Set([...activePicked, ...visible.map((s) => s.id)])])
              }
              className="shrink-0 text-xs font-medium text-neutral-600 hover:underline"
            >
              {allVisiblePicked ? "Bỏ chọn tất cả" : "Chọn tất cả"}
            </button>
          </div>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm tên nhân viên..."
            aria-label="Tìm nhân viên"
            className="input mb-2"
          />
          <ul className="max-h-72 divide-y divide-neutral-100 overflow-y-auto rounded-lg border border-neutral-200">
            {visible.map((s) => {
              const otherCa = templates.filter((t) => t.id !== activeId && picked[t.id]?.includes(s.id)).map((t) => t.name);
              const had = existing.get(s.id) ?? [];
              return (
                <li key={s.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-neutral-50">
                    <input
                      type="checkbox"
                      checked={activePicked.includes(s.id)}
                      onChange={() => toggle(s.id)}
                      className="h-4 w-4 accent-neutral-900"
                    />
                    <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    {otherCa.length > 0 && (
                      <span className="shrink-0 rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-700">+ {otherCa.join(", ")}</span>
                    )}
                    {inViewedWeek && had.length > 0 && (
                      <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600" title="Số ca đã xếp trong các ngày đang chọn">
                        Đã có {had.length} ca
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
            {visible.length === 0 && <li className="px-3 py-4 text-center text-sm text-neutral-500">Không tìm thấy nhân viên.</li>}
          </ul>
        </section>

        <div className="rounded-lg bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
          {assignments.length === 0 ? (
            "Chưa tick nhân viên nào."
          ) : (
            <>
              {assignments.map((a) => `${templates.find((t) => t.id === a.template_id)?.name}: ${a.employee_ids.length} người`).join(" · ")}
              <span className="block text-xs text-neutral-500">
                × {dates.length} ngày = <strong>{totalShifts}</strong> ca nháp. Ca trùng giờ với ca đã có sẽ tự bỏ qua.
              </span>
            </>
          )}
        </div>

        {state.message && !state.ok && <p role="alert" className="alert-error">{state.message}</p>}
        <div className="flex justify-end gap-3 border-t border-neutral-100 pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">Đóng</button>
          <button type="submit" disabled={pending || totalShifts === 0} className="btn-primary">
            {pending ? "Đang xếp lịch..." : `Xếp ${totalShifts || ""} ca`}
          </button>
        </div>
      </ActionForm>
    </Dialog>
  );
}
