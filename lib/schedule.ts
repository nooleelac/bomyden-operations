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
