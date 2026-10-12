"use client";

import { endOptions, startOptions, type RegisterRules } from "@/lib/schedule";

export type TimeRange = { start: string; end: string };

/** Giờ ra hợp lệ gần `preferMin` phút nhất khi đổi giờ vào */
export function fitEnd(rules: RegisterRules, start: string, preferEnd?: string): string {
  const opts = endOptions(rules, start);
  if (preferEnd && opts.some((o) => o.value === preferEnd)) return preferEnd;
  // Mặc định ca 6 tiếng (hoặc gần nhất có thể)
  const target = opts.find((o) => o.label.includes("(6 tiếng)"));
  return (target ?? opts.at(-1) ?? opts[0])?.value ?? start;
}

/** 2 ô chọn giờ vào / giờ ra theo quy định (bước phút, khung giờ, độ dài ca) */
export default function TimeRangePicker({
  rules,
  value,
  onChange,
  idPrefix,
  startName,
  endName,
}: {
  rules: RegisterRules;
  value: TimeRange;
  onChange: (v: TimeRange) => void;
  idPrefix: string;
  /** Đặt name để gửi kèm form */
  startName?: string;
  endName?: string;
}) {
  const starts = startOptions(rules);
  const ends = endOptions(rules, value.start);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={`${idPrefix}-start`} className="sr-only">Giờ vào</label>
      <select
        id={`${idPrefix}-start`}
        name={startName}
        value={value.start}
        onChange={(e) => onChange({ start: e.target.value, end: fitEnd(rules, e.target.value, value.end) })}
        className="input w-auto py-1.5"
      >
        {!starts.some((o) => o.value === value.start) && <option value={value.start}>{value.start}</option>}
        {starts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <span className="text-neutral-500">→</span>
      <label htmlFor={`${idPrefix}-end`} className="sr-only">Giờ ra</label>
      <select
        id={`${idPrefix}-end`}
        name={endName}
        value={value.end}
        onChange={(e) => onChange({ ...value, end: e.target.value })}
        className="input w-auto py-1.5"
      >
        {!ends.some((o) => o.value === value.end) && <option value={value.end}>{value.end}</option>}
        {ends.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
