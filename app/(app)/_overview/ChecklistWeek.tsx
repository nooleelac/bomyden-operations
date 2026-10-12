import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatDayMonth, formatMoney } from "@/lib/payroll";

type WeekProgress = {
  week_start: string;
  today: string;
  days: { date: string; total: number; ok: number }[];
  total: number;
  ok: number;
  bonus: number;
  target_percent: number;
};

const WEEKDAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

/** Tiến độ checklist tuần này (xong đúng hạn / tổng việc) + nhắc thưởng KPI. Cùng công thức với phiếu lương. */
export default async function ChecklistWeek() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_checklist_week");
  const w = data as WeekProgress | null;
  if (!w) return null;

  const percent = w.total ? Math.floor((w.ok * 100) / w.total) : 0;
  const reached = w.total > 0 && w.ok * 100 >= w.target_percent * w.total;
  const missing = Math.max(0, Math.ceil((w.target_percent * w.total) / 100) - w.ok);
  const weekEnd = w.days[6]?.date ?? w.week_start;

  return (
    <Link href="/checklist" className="card block p-4 transition hover:border-neutral-400 hover:shadow-md sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            Checklist tuần này · {formatDayMonth(w.week_start)}–{formatDayMonth(weekEnd)}
          </p>
          <p className="mt-1 flex items-baseline gap-2">
            <span className={`text-3xl font-bold tabular-nums ${reached ? "text-emerald-700" : "text-neutral-900"}`}>
              {w.total ? `${percent}%` : "—"}
            </span>
            <span className="text-sm text-neutral-500">
              {w.total ? `${w.ok}/${w.total} việc xong đúng hạn` : "Chưa có việc nào"}
            </span>
          </p>
        </div>
        {w.total > 0 && (
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${reached ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
            {reached ? "✓ Đang đạt chỉ tiêu" : `Cần thêm ${missing} việc đúng hạn`}
          </span>
        )}
      </div>

      {/* Thanh tiến độ tuần + vạch chỉ tiêu */}
      <div className="relative mt-3" aria-hidden="true">
        <div className="h-2.5 overflow-hidden rounded-full bg-neutral-100">
          <div
            className={`h-full rounded-full ${reached ? "bg-emerald-500" : "bg-brand"}`}
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="absolute -top-1 h-4.5 w-0.5 rounded bg-neutral-700" style={{ left: `calc(${w.target_percent}% - 1px)` }} />
      </div>
      <p className="mt-1 text-right text-xs text-neutral-500">Chỉ tiêu {w.target_percent}%</p>

      {/* Từng ngày trong tuần */}
      <ul className="mt-2 grid grid-cols-7 gap-1.5" aria-label="Tiến độ từng ngày">
        {w.days.map((d, i) => {
          const future = d.date > w.today;
          const isToday = d.date === w.today;
          const ratio = d.total ? d.ok / d.total : 0;
          const color =
            !d.total ? "" : ratio === 1 ? "bg-emerald-500" : isToday ? "bg-brand" : ratio >= w.target_percent / 100 ? "bg-amber-400" : "bg-red-400";
          const label = `${WEEKDAYS[i]} ${formatDayMonth(d.date)}: ${
            future ? "chưa tới" : d.total ? `${d.ok}/${d.total} việc xong đúng hạn` : "không có việc"
          }`;
          return (
            <li key={d.date} title={label} aria-label={label} className="flex flex-col items-center gap-1">
              <span className={`relative flex h-14 w-full items-end overflow-hidden rounded-md ${future ? "bg-neutral-50" : "bg-neutral-100"} ${isToday ? "ring-2 ring-brand ring-offset-1" : ""}`}>
                {d.total > 0 && <span className={`block w-full rounded-t-[4px] ${color}`} style={{ height: `${Math.max(ratio * 100, 6)}%` }} />}
              </span>
              <span className={`text-[11px] leading-tight ${isToday ? "font-semibold text-neutral-900" : "text-neutral-500"}`}>{WEEKDAYS[i]}</span>
              <span className="text-[10px] leading-tight tabular-nums text-neutral-400">{!future && d.total ? `${d.ok}/${d.total}` : " "}</span>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
        🎯 <strong>Hãy hoàn thành đủ checklist trong ngày để nhận thưởng.</strong>
        {w.bonus > 0 && (
          <span className="block text-xs text-amber-800">
            Tuần đạt từ {w.target_percent}% việc xong đúng hạn → thưởng {formatMoney(w.bonus)} vào lương.
          </span>
        )}
      </p>
    </Link>
  );
}
