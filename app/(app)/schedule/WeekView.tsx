"use client";

import { SHIFT_STATUS, dayLabel, weekDays, type ScheduleShift, type WeekSchedule } from "@/lib/schedule";

type Props = {
  weekStart: string;
  today: string;
  data: WeekSchedule;
  myId?: string;
  /** Có = chế độ quản lý: bấm vào ca để sửa, nút "+" để thêm ca */
  onShiftClick?: (shift: ScheduleShift) => void;
  onAdd?: (day: string) => void;
};

export default function WeekView({ weekStart, today, data, myId, onShiftClick, onAdd }: Props) {
  return (
    <ul className="space-y-2">
      {weekDays(weekStart).map((day) => {
        const shifts = data.shifts.filter((s) => s.work_date === day);
        const leaves = data.leaves.filter((l) => l.start_date <= day && l.end_date >= day);
        const isToday = day === today;
        return (
          <li key={day} className={`card p-3 ${isToday ? "ring-2 ring-brand" : ""}`}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className={`text-sm font-semibold ${day < today ? "text-neutral-400" : ""}`}>
                {dayLabel(day)}
                {isToday && <span className="ml-2 rounded-full bg-brand px-2 py-0.5 text-xs font-medium text-brand-fg">Hôm nay</span>}
              </p>
              {onAdd && (
                <button
                  type="button"
                  onClick={() => onAdd(day)}
                  className="rounded-lg border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                  aria-label={`Thêm ca ${dayLabel(day)}`}
                >
                  + Ca
                </button>
              )}
            </div>

            {shifts.length === 0 && leaves.length === 0 ? (
              <p className="text-xs text-neutral-400">Chưa có ca.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {shifts.map((s) => {
                  const mine = s.employee_id === myId;
                  const style = SHIFT_STATUS[s.status].className;
                  const content = (
                    <>
                      <span className="font-semibold tabular-nums">{s.start_time}–{s.end_time}</span>
                      <span className="ml-1.5">{s.employee_name}</span>
                      {s.status === "draft" && <span className="ml-1.5 text-[11px] font-medium">(nháp)</span>}
                      {s.status === "cancelled" && s.cancel_reason && (
                        <span className="ml-1.5 text-[11px] no-underline">— hủy: {s.cancel_reason}</span>
                      )}
                    </>
                  );
                  const cls = `rounded-lg border px-2.5 py-1.5 text-left text-xs ${style} ${mine && s.status !== "cancelled" ? "border-sky-500 bg-sky-50 text-sky-900" : ""}`;
                  return onShiftClick && s.status !== "cancelled" ? (
                    <button key={s.id} type="button" onClick={() => onShiftClick(s)} className={`${cls} hover:border-neutral-500`}>
                      {content}
                    </button>
                  ) : (
                    <span key={s.id} className={cls} title={s.note ?? undefined}>
                      {content}
                    </span>
                  );
                })}
                {leaves.map((l) => (
                  <span key={`${l.employee_id}-${l.start_date}`} className="rounded-lg bg-violet-50 px-2.5 py-1.5 text-xs text-violet-800">
                    🌴 Nghỉ: {l.employee_name}
                  </span>
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
