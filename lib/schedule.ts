// Lịch làm việc & đơn xin phép: nhãn, tuần, kiểu dữ liệu RPC (dùng chung client + server).

import type { RequestKind, RequestStatus, ShiftStatus } from "@/lib/database.types";

export const REQUEST_KIND_LABELS: Record<RequestKind, string> = {
  leave: "Xin nghỉ",
  late: "Xin đi trễ",
  early_leave: "Xin về sớm",
  swap: "Đổi / nhường ca",
};

export const REQUEST_STATUS: Record<RequestStatus, { label: string; className: string }> = {
  awaiting_peer: { label: "Chờ người nhận", className: "bg-violet-50 text-violet-700" },
  pending: { label: "Chờ duyệt", className: "bg-amber-50 text-amber-800" },
  approved: { label: "Đã duyệt", className: "bg-emerald-50 text-emerald-700" },
  rejected: { label: "Từ chối", className: "bg-red-50 text-red-700" },
  cancelled: { label: "Đã hủy", className: "bg-neutral-100 text-neutral-500" },
};

export const SHIFT_STATUS: Record<ShiftStatus, { label: string; className: string }> = {
  draft: { label: "Nháp", className: "border-dashed border-amber-400 bg-amber-50 text-amber-900" },
  published: { label: "Đã công bố", className: "border-neutral-200 bg-white text-neutral-900" },
  cancelled: { label: "Đã hủy", className: "border-neutral-200 bg-neutral-50 text-neutral-400 line-through" },
};

const WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

// ---------------------------------------------------------------------
// Tuần (T2–CN) — chuỗi ngày "YYYY-MM-DD"
// ---------------------------------------------------------------------
function toUtc(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

export function addDays(day: string, n: number): string {
  const d = toUtc(day);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function weekStartOf(day: string): string {
  const dow = toUtc(day).getUTCDay();
  return addDays(day, -((dow + 6) % 7));
}

export function isMonday(day: unknown): day is string {
  return typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(toUtc(day).getTime()) && toUtc(day).getUTCDay() === 1;
}

export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** Thứ trong tuần: 0 = CN … 6 = T7 */
export function weekdayOf(day: string): number {
  return toUtc(day).getUTCDay();
}

/** Danh sách ngày từ `from` đến `to` (gồm cả 2 đầu) */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

export function monthStartOf(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

export function monthEndOf(day: string): string {
  const d = toUtc(monthStartOf(day));
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
}

export type Period = { mode: "week" | "month"; from: string; to: string; prev: string; next: string; label: string };

/**
 * Kỳ xem theo tuần (start = thứ Hai) hoặc theo tháng (start = "YYYY-MM").
 * `fallback` là ngày nằm trong kỳ mặc định khi `start` không hợp lệ.
 */
export function resolvePeriod(mode: unknown, start: unknown, fallback: string): Period {
  if (mode === "month") {
    const month = typeof start === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(start) ? start : fallback.slice(0, 7);
    const from = `${month}-01`;
    const to = monthEndOf(from);
    return {
      mode: "month",
      from,
      to,
      prev: monthStartOf(addDays(from, -1)).slice(0, 7),
      next: addDays(to, 1).slice(0, 7),
      label: `Tháng ${Number(month.slice(5, 7))}/${month.slice(0, 4)}`,
    };
  }
  const from = isMonday(start) ? start : weekStartOf(fallback);
  return { mode: "week", from, to: addDays(from, 6), prev: addDays(from, -7), next: addDays(from, 7), label: weekLabel(from) };
}

/** "T2 12/10" */
export function dayLabel(day: string): string {
  return `${WEEKDAYS[toUtc(day).getUTCDay()]} ${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

/** "12/10 – 18/10/2026" */
export function weekLabel(weekStart: string): string {
  const end = addDays(weekStart, 6);
  return `${weekStart.slice(8, 10)}/${weekStart.slice(5, 7)} – ${end.slice(8, 10)}/${end.slice(5, 7)}/${end.slice(0, 4)}`;
}

/** "08:00" từ "08:00:00" */
export function hm(time: string | null | undefined): string {
  return time ? time.slice(0, 5) : "";
}

// ---------------------------------------------------------------------
// Dữ liệu RPC
// ---------------------------------------------------------------------
export type ScheduleShift = {
  id: string;
  employee_id: string;
  employee_name: string;
  work_date: string;
  start_time: string;
  end_time: string;
  start_at: string;
  end_at: string;
  template_id: string | null;
  note: string | null;
  status: ShiftStatus;
  cancel_reason: string | null;
};

export type WeekSchedule = {
  can_manage: boolean;
  shifts: ScheduleShift[];
  leaves: { employee_id: string; employee_name: string; start_date: string; end_date: string }[];
};

type ShiftInfo = { work_date: string; start_time: string; end_time: string; branch_name?: string };

export type MyRequest = {
  id: string;
  kind: RequestKind;
  status: RequestStatus;
  employee_id: string;
  employee_name: string;
  target_employee_id: string | null;
  target_name: string | null;
  start_date: string | null;
  end_date: string | null;
  requested_time: string | null;
  shift: ShiftInfo | null;
  target_shift: ShiftInfo | null;
  reason: string;
  is_urgent: boolean;
  over_limit: boolean;
  is_paid: boolean;
  review_note: string | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
  created_at: string;
};

export function shiftText(s: ShiftInfo | null): string {
  return s ? `${dayLabel(s.work_date)} ${s.start_time}–${s.end_time}` : "";
}

function dmy(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

/** Mô tả ngắn nội dung đơn. */
export function describeRequest(r: {
  kind: RequestKind;
  start_date: string | null;
  end_date: string | null;
  requested_time: string | null;
  shift: ShiftInfo | null;
  target_shift: ShiftInfo | null;
  target_name: string | null;
}): string {
  switch (r.kind) {
    case "leave":
      return r.start_date === r.end_date ? `Nghỉ ngày ${dmy(r.start_date!)}` : `Nghỉ ${dmy(r.start_date!)} – ${dmy(r.end_date!)}`;
    case "late":
      return `Ca ${shiftText(r.shift)} · vào lúc ${hm(r.requested_time)}`;
    case "early_leave":
      return `Ca ${shiftText(r.shift)} · về lúc ${hm(r.requested_time)}`;
    case "swap":
      return r.target_shift
        ? `Đổi ca ${shiftText(r.shift)} với ${r.target_name} (ca ${shiftText(r.target_shift)})`
        : `Nhường ca ${shiftText(r.shift)} cho ${r.target_name}`;
  }
}

// ---------------------------------------------------------------------
// Đăng ký ca tự chọn giờ (khớp private.registration_time_error trong DB)
// ---------------------------------------------------------------------
export type RegisterRules = {
  earliest: string;
  latest: string;
  step: number;
  min: number;
  max: number;
  max_per_day: number;
  max_day: number;
  /** Ghi đè mốc ra muộn nhất (phút từ 00:00 ngày làm) — dùng cho QL */
  window_end?: number;
};

/** Phút từ 00:00 của "HH:MM" */
export function toMin(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/** "HH:MM" từ số phút (quá 24:00 → quay vòng) */
export function fromMin(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Độ dài ca (phút); giờ ra <= giờ vào → qua đêm */
export function spanMin(start: string, end: string): number {
  const d = toMin(end) - toMin(start);
  return d <= 0 ? d + 1440 : d;
}

/** "3 tiếng", "8,5 tiếng" */
export function hoursLabel(min: number): string {
  return `${String(Math.round((min / 60) * 100) / 100).replace(".", ",")} tiếng`;
}

/** Mốc ra muộn nhất theo phút từ 00:00 ngày làm (01:00 hôm sau = 1500) */
export function windowEnd(rules: RegisterRules): number {
  if (rules.window_end) return rules.window_end;
  const l = toMin(rules.latest);
  return l <= toMin(rules.earliest) ? l + 1440 : l;
}

/** Lỗi của 1 ca tự chọn so với quy định (null = hợp lệ) */
export function registrationTimeError(rules: RegisterRules, start: string, end: string): string | null {
  if (start === end) return "Giờ vào và giờ ra trùng nhau.";
  const s = toMin(start);
  const dur = spanMin(start, end);
  if (s % rules.step !== 0 || toMin(end) % rules.step !== 0) return `Giờ phải tròn ${rules.step} phút.`;
  if (s < toMin(rules.earliest) || s + dur > windowEnd(rules)) return `Ngoài khung giờ cho phép (${rules.earliest}–${rules.latest}).`;
  if (dur < rules.min) return `Ca ngắn nhất ${hoursLabel(rules.min)}.`;
  if (dur > rules.max) return `Ca dài nhất ${hoursLabel(rules.max)}.`;
  return null;
}

/** Hai ca trong cùng ngày làm có chồng giờ nhau không */
export function rangesOverlap(a: { start: string; end: string }, b: { start: string; end: string }): boolean {
  const s1 = toMin(a.start);
  const s2 = toMin(b.start);
  return s1 < s2 + spanMin(b.start, b.end) && s2 < s1 + spanMin(a.start, a.end);
}

export type TimeOption = { value: string; label: string };

/** Giờ vào chọn được: từ giờ sớm nhất đến (giờ muộn nhất − ca ngắn nhất) */
export function startOptions(rules: RegisterRules): TimeOption[] {
  const out: TimeOption[] = [];
  for (let m = toMin(rules.earliest); m + rules.min <= windowEnd(rules) && m < 1440; m += rules.step) out.push({ value: fromMin(m), label: fromMin(m) });
  return out;
}

/** Giờ ra chọn được với giờ vào `start` (kèm số tiếng; qua 00:00 ghi "hôm sau") */
export function endOptions(rules: RegisterRules, start: string): TimeOption[] {
  const out: TimeOption[] = [];
  const s = toMin(start);
  for (let d = rules.min; d <= rules.max && s + d <= windowEnd(rules); d += rules.step) {
    out.push({ value: fromMin(s + d), label: `${fromMin(s + d)}${s + d >= 1440 ? " hôm sau" : ""} (${hoursLabel(d)})` });
  }
  return out;
}

/** Quy định rộng cho QL sửa giờ khi duyệt: cả ngày, ca 1–16 tiếng */
export function managerRules(step: number): RegisterRules {
  return { earliest: "00:00", latest: "00:00", step, min: 60, max: 960, max_per_day: 3, max_day: 1440, window_end: 1440 + 960 };
}

/** Phủ ca theo ô giờ của 1 ngày (RPC branch_coverage) */
export type CoverageDay = { date: string; need: number[]; scheduled: number[]; pending: number[] };
export type Coverage = { start: number; step: number; days: CoverageDay[] };

/** Các khung đang thiếu người (định mức − đã xếp − chờ duyệt), gộp ô liền nhau cùng số người thiếu */
export function coverageGaps(cov: Coverage, day: CoverageDay): { from: string; to: string; missing: number }[] {
  const gaps: { from: string; to: string; missing: number }[] = [];
  for (let i = 0; i < day.need.length; i++) {
    const missing = day.need[i] - day.scheduled[i] - day.pending[i];
    if (missing <= 0) continue;
    const t = cov.start + i * cov.step;
    const last = gaps.at(-1);
    if (last && toMin(last.to) === t % 1440 && last.missing === missing) {
      last.to = fromMin(t + cov.step);
    } else {
      gaps.push({ from: fromMin(t), to: fromMin(t + cov.step), missing });
    }
  }
  return gaps;
}
