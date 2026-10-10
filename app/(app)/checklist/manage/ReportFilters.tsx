"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

type Option = { id: string; name: string };

const WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

function shiftDate(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dateLabel(date: string, today: string) {
  if (date === today) return "Hôm nay";
  if (date === shiftDate(today, -1)) return "Hôm qua";
  const [y, m, d] = date.split("-");
  const weekday = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  return `${weekday}, ${d}/${m}/${y}`;
}

/**
 * Bộ lọc báo cáo / mẫu checklist: đổi là tự tải lại (không cần nút "Xem").
 * Ô ngày tự vẽ nhãn ngắn gọn ("Hôm nay", "T2, 06/10/2026"), ô chọn ngày gốc nằm trong suốt phía trên
 * → bấm vào vẫn mở bộ chọn ngày của điện thoại, nhưng không bị chữ dài "ngày 11 thg 10, 2026" của iPhone.
 */
export default function ReportFilters({
  tab,
  branches,
  staff,
  branchId,
  employeeId,
  date,
  today,
  query,
}: {
  tab: "report" | "templates";
  branches: Option[];
  staff: Option[];
  branchId: string;
  employeeId: string;
  date: string;
  today: string;
  /** Tham số URL hiện tại (giữ nguyên tab, lọc gấp...) */
  query: Record<string, string>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const go = (patch: Record<string, string>) => {
    const next = new URLSearchParams(query);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (next.get("date") === today) next.delete("date");
    startTransition(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  const showBranch = branches.length > 1;
  const isReport = tab === "report";
  if (!showBranch && !isReport) return null;

  return (
    <div className={`card mb-4 space-y-3 p-3 transition-opacity sm:p-4 ${pending ? "opacity-60" : ""}`} aria-busy={pending}>
      {(showBranch || isReport) && (
        <div className={`grid gap-3 ${showBranch && isReport ? "grid-cols-2" : "grid-cols-1"}`}>
          {showBranch && (
            <Field label="Chi nhánh" htmlFor="cf-branch">
              <select
                id="cf-branch"
                value={branchId}
                // Đổi chi nhánh → bỏ lọc nhân viên (có thể không thuộc chi nhánh mới)
                onChange={(e) => go({ branch: e.target.value, emp: "" })}
                className="input truncate pr-8"
              >
                <option value="">Tất cả</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </Field>
          )}
          {isReport && (
            <Field label="Nhân viên" htmlFor="cf-emp">
              <select id="cf-emp" value={employeeId} onChange={(e) => go({ emp: e.target.value })} className="input truncate pr-8">
                <option value="">Tất cả nhân viên</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </Field>
          )}
        </div>
      )}

      {isReport && (
        <Field label="Ngày" htmlFor="cf-date">
          <div className="flex items-stretch gap-2">
            <button type="button" onClick={() => go({ date: shiftDate(date, -1) })} className="btn-secondary min-h-11 shrink-0 px-3.5" aria-label="Ngày trước">
              ‹
            </button>
            <div className="relative min-w-0 flex-1">
              <span className="input flex items-center justify-center gap-2 font-medium tabular-nums" aria-hidden="true">
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 text-neutral-400">
                  <path fillRule="evenodd" d="M5.75 2a.75.75 0 0 1 .75.75V4h7V2.75a.75.75 0 0 1 1.5 0V4h.25A2.75 2.75 0 0 1 18 6.75v8.5A2.75 2.75 0 0 1 15.25 18H4.75A2.75 2.75 0 0 1 2 15.25v-8.5A2.75 2.75 0 0 1 4.75 4H5V2.75A.75.75 0 0 1 5.75 2Zm-1 5.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6.5c0-.69-.56-1.25-1.25-1.25H4.75Z" clipRule="evenodd" />
                </svg>
                <span className="truncate">{dateLabel(date, today)}</span>
              </span>
              <input
                id="cf-date"
                type="date"
                value={date}
                max={today}
                onClick={(e) => e.currentTarget.showPicker?.()}
                onChange={(e) => e.target.value && go({ date: e.target.value })}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
            </div>
            <button
              type="button"
              onClick={() => go({ date: shiftDate(date, 1) })}
              disabled={date >= today}
              className="btn-secondary min-h-11 shrink-0 px-3.5"
              aria-label="Ngày sau"
            >
              ›
            </button>
          </div>
        </Field>
      )}
    </div>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-neutral-600">{label}</label>
      {children}
    </div>
  );
}
