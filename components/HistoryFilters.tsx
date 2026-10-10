"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import Dialog from "@/components/Dialog";
import { matchesSearch } from "@/lib/inventory";

type Option = { id: string; name: string };

const WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dayLabel(date: string, today: string) {
  if (date === today) return "Hôm nay";
  if (date === addDays(today, -1)) return "Hôm qua";
  const [y, m, d] = date.split("-");
  // Cùng năm → bỏ năm cho gọn trên điện thoại
  return `${WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]}, ${d}/${m}${y === today.slice(0, 4) ? "" : `/${y}`}`;
}

/** Phím chọn nhanh khoảng ngày (tính theo ngày hôm nay) */
function presets(today: string) {
  const monthStart = `${today.slice(0, 8)}01`;
  const lastMonthEnd = addDays(monthStart, -1);
  return [
    { key: "today", label: "Hôm nay", from: today, to: today },
    { key: "yesterday", label: "Hôm qua", from: addDays(today, -1), to: addDays(today, -1) },
    { key: "7d", label: "7 ngày", from: addDays(today, -6), to: today },
    { key: "30d", label: "30 ngày", from: addDays(today, -29), to: today },
    { key: "month", label: "Tháng này", from: monthStart, to: today },
    { key: "lastMonth", label: "Tháng trước", from: `${lastMonthEnd.slice(0, 8)}01`, to: lastMonthEnd },
  ];
}

/**
 * Bộ lọc lịch sử dùng chung (báo cáo checklist, chấm công): đổi là tự tải lại (không cần nút "Xem").
 * - Nhân viên: chọn nhiều người.
 * - Ngày: khoảng Từ–Đến (tối đa maxDays ngày) + phím chọn nhanh, nút ‹ › lùi/tới nguyên khoảng.
 * Ô ngày tự vẽ nhãn gọn ("Hôm nay", "T2, 06/10/2026"); ô chọn ngày gốc nằm trong suốt phía trên
 * → bấm vẫn mở bộ chọn ngày của điện thoại, không bị chữ dài "ngày 11 thg 10, 2026" của iPhone.
 */
export default function HistoryFilters({
  mode,
  branches,
  staff,
  branchId,
  employeeIds,
  from,
  to,
  today,
  maxDays,
  query,
  staffFieldLabel = "Nhân viên",
}: {
  /** full = chi nhánh + nhân viên + khoảng ngày; branchOnly = chỉ chi nhánh */
  mode: "full" | "branchOnly";
  branches: Option[];
  staff: Option[];
  branchId: string;
  employeeIds: string[];
  from: string;
  to: string;
  today: string;
  maxDays: number;
  /** Tham số URL hiện tại (giữ nguyên tab, lọc gấp...) */
  query: Record<string, string>;
  /** Nhãn ô chọn người (mặc định "Nhân viên") */
  staffFieldLabel?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [pickerOpen, setPickerOpen] = useState(false);

  const go = (patch: Record<string, string>) => {
    const next = new URLSearchParams(query);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.delete("date");
    if (next.get("from") === today) next.delete("from");
    if (next.get("to") === today) next.delete("to");
    startTransition(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  const setRange = (f: string, t: string) => {
    if (t > today) t = today;
    if (f > t) f = t;
    if (f < addDays(t, -(maxDays - 1))) f = addDays(t, -(maxDays - 1));
    go({ from: f, to: t });
  };

  const isReport = mode === "full";
  if (branches.length === 0 && !isReport) return null;

  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  const activePreset = presets(today).find((p) => p.from === from && p.to === to)?.key;
  const pickedNames = staff.filter((s) => employeeIds.includes(s.id)).map((s) => s.name);
  const staffLabel =
    pickedNames.length === 0 ? "Tất cả nhân viên" : pickedNames.length === 1 ? pickedNames[0] : `${pickedNames.length} nhân viên`;

  return (
    <div className={`card mb-4 space-y-3 p-3 transition-opacity sm:p-4 ${pending ? "opacity-60" : ""}`} aria-busy={pending}>
      <div className={`grid gap-3 ${isReport ? "grid-cols-2" : "grid-cols-1"}`}>
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
        {isReport && (
          <Field label={staffFieldLabel} htmlFor="cf-emp">
            <button
              id="cf-emp"
              type="button"
              onClick={() => setPickerOpen(true)}
              aria-haspopup="dialog"
              className={`input flex items-center justify-between gap-2 text-left ${pickedNames.length ? "border-brand font-medium" : ""}`}
            >
              <span className="truncate">{staffLabel}</span>
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 text-neutral-400" aria-hidden="true">
                <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
              </svg>
            </button>
          </Field>
        )}
      </div>

      {isReport && (
        <div>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium text-neutral-600">Khoảng ngày</span>
            {days > 1 && <span className="text-xs text-neutral-500">{days} ngày · tối đa {maxDays}</span>}
          </div>
          <div className="scroll-x mb-2 gap-1.5" role="group" aria-label="Chọn nhanh khoảng ngày">
            {presets(today).map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setRange(p.from, p.to)}
                aria-pressed={activePreset === p.key}
                className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  activePreset === p.key ? "border-brand bg-brand text-brand-fg" : "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-500"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-stretch gap-2">
            <button
              type="button"
              onClick={() => setRange(addDays(from, -days), addDays(to, -days))}
              className="btn-secondary min-h-11 shrink-0 px-3"
              aria-label={days > 1 ? `Lùi ${days} ngày` : "Ngày trước"}
            >
              ‹
            </button>
            <DateBox id="cf-from" label="Từ" value={from} today={today} onChange={(v) => setRange(v, v > to ? v : to)} />
            <DateBox id="cf-to" label="Đến" value={to} today={today} onChange={(v) => setRange(v < from ? v : from, v)} />
            <button
              type="button"
              onClick={() => setRange(addDays(from, days), addDays(to, days))}
              disabled={to >= today}
              className="btn-secondary min-h-11 shrink-0 px-3"
              aria-label={days > 1 ? `Tới ${days} ngày` : "Ngày sau"}
            >
              ›
            </button>
          </div>
        </div>
      )}

      {isReport && (
        <StaffPicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          staff={staff}
          initial={employeeIds}
          onApply={(ids) => {
            setPickerOpen(false);
            go({ emp: ids.join(",") });
          }}
        />
      )}
    </div>
  );
}

/** Ô ngày: nhãn gọn + ô chọn ngày gốc trong suốt phía trên */
function DateBox({ id, label, value, today, onChange }: { id: string; label: string; value: string; today: string; onChange: (v: string) => void }) {
  return (
    <div className="relative min-w-0 flex-1">
      <span className="input flex flex-col items-start justify-center py-1.5 leading-tight" aria-hidden="true">
        <span className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">{label}</span>
        <span className="w-full truncate text-sm font-semibold tabular-nums">{dayLabel(value, today)}</span>
      </span>
      <input
        id={id}
        type="date"
        aria-label={`${label} ngày`}
        value={value}
        max={today}
        onClick={(e) => e.currentTarget.showPicker?.()}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </div>
  );
}

/** Chọn nhiều nhân viên: tìm kiếm không dấu, chọn tất cả / bỏ chọn, áp dụng một lần */
function StaffPicker({
  open,
  onClose,
  staff,
  initial,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  staff: Option[];
  initial: string[];
  onApply: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>(initial);
  const [search, setSearch] = useState("");
  const [wasOpen, setWasOpen] = useState(open);
  // Mỗi lần mở lại → bắt đầu từ lựa chọn đang áp dụng
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setSelected(initial);
      setSearch("");
    }
  }
  const visible = staff.filter((s) => matchesSearch(s.name, search));
  const toggle = (id: string) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <Dialog open={open} onClose={onClose} title="Chọn nhân viên" description="Để trống = xem tất cả nhân viên">
      <div className="space-y-3">
        {staff.length > 8 && (
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm tên nhân viên..."
            className="input"
            aria-label="Tìm nhân viên"
          />
        )}
        <div className="flex items-center justify-between text-sm">
          <span className="text-neutral-500">Đã chọn {selected.length}/{staff.length}</span>
          <span className="flex gap-3">
            <button type="button" className="font-medium text-brand hover:underline" onClick={() => setSelected([...new Set([...selected, ...visible.map((s) => s.id)])])}>
              Chọn tất cả
            </button>
            <button type="button" className="font-medium text-neutral-500 hover:underline" onClick={() => setSelected([])}>
              Bỏ chọn
            </button>
          </span>
        </div>
        <ul className="max-h-[45dvh] divide-y divide-neutral-100 overflow-y-auto rounded-xl border border-neutral-200">
          {visible.length === 0 && <li className="px-3 py-6 text-center text-sm text-neutral-500">Không tìm thấy nhân viên.</li>}
          {visible.map((s) => (
            <li key={s.id}>
              <label className="flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-neutral-50">
                <input type="checkbox" checked={selected.includes(s.id)} onChange={() => toggle(s.id)} className="h-5 w-5 shrink-0 accent-brand" />
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="flex gap-3 border-t border-neutral-100 pt-4">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Hủy</button>
          <button type="button" onClick={() => onApply(selected)} className="btn-primary flex-1">
            {selected.length ? `Xem ${selected.length} người` : "Xem tất cả"}
          </button>
        </div>
      </div>
    </Dialog>
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
