// Nhãn & quy tắc hiển thị cho Checklist (dùng chung client + server).

import type { TaskFrequency, TaskPriority, TaskStatus } from "@/lib/database.types";

export const TASK_CATEGORIES = ["Chuẩn bị phục vụ", "Kiểm kê", "Vệ sinh", "Đóng ca", "Khác"] as const;

export const CATEGORY_ICONS: Record<string, string> = {
  "Chuẩn bị phục vụ": "🍳",
  "Kiểm kê": "📦",
  "Vệ sinh": "🧹",
  "Đóng ca": "🌙",
  Khác: "📌",
};

export const PRIORITY_LABELS: Record<TaskPriority, { label: string; className: string }> = {
  low: { label: "Lưu ý", className: "bg-neutral-100 text-neutral-600" },
  normal: { label: "Bình thường", className: "bg-sky-50 text-sky-700" },
  high: { label: "Quan trọng", className: "bg-orange-50 text-orange-700" },
  critical: { label: "Khẩn cấp", className: "bg-red-50 text-red-700" },
};

export const PRIORITIES: TaskPriority[] = ["low", "normal", "high", "critical"];

export const WEEKDAY_LABELS: Record<number, string> = {
  1: "T2",
  2: "T3",
  3: "T4",
  4: "T5",
  5: "T6",
  6: "T7",
  7: "CN",
};

export function describeSchedule(frequency: TaskFrequency, weekdays: number[], monthDays: number[]): string {
  if (frequency === "daily") return "Hằng ngày";
  if (frequency === "weekly") return `Hằng tuần: ${weekdays.map((d) => WEEKDAY_LABELS[d]).join(", ")}`;
  return `Hằng tháng: ngày ${monthDays.join(", ")}`;
}

export type DisplayStatus = "upcoming" | "open" | "overdue" | "done" | "late" | "failed" | "cancelled";

export const DISPLAY_STATUS: Record<DisplayStatus, { label: string; className: string }> = {
  upcoming: { label: "Chưa đến giờ", className: "bg-neutral-100 text-neutral-600" },
  open: { label: "Cần làm", className: "bg-sky-50 text-sky-700" },
  overdue: { label: "Quá hạn", className: "bg-red-50 text-red-700" },
  done: { label: "Đã xong", className: "bg-emerald-50 text-emerald-700" },
  late: { label: "Xong (trễ)", className: "bg-amber-50 text-amber-800" },
  failed: { label: "Không đạt", className: "bg-red-100 text-red-800" },
  cancelled: { label: "Đã hủy", className: "bg-neutral-100 text-neutral-400" },
};

export function displayStatus(
  task: { status: TaskStatus; start_at: string; due_at: string; completed_at: string | null },
  now: number
): DisplayStatus {
  if (task.status === "cancelled") return "cancelled";
  if (task.status === "failed") return "failed";
  if (task.status === "done") {
    return task.completed_at && new Date(task.completed_at).getTime() > new Date(task.due_at).getTime() ? "late" : "done";
  }
  if (now > new Date(task.due_at).getTime()) return "overdue";
  if (now < new Date(task.start_at).getTime()) return "upcoming";
  return "open";
}

/**
 * Việc "giao theo ca": ca (đã công bố, cùng chi nhánh) trùng khung giờ của việc thì người đó nhận việc.
 * Khớp với private.on_task_shift trong CSDL.
 */
export function shiftCoversTask(
  shift: { branch_id: string; start_at: string; end_at: string },
  task: { branch_id: string; start_at: string; due_at: string }
): boolean {
  return (
    shift.branch_id === task.branch_id &&
    new Date(shift.start_at).getTime() < new Date(task.due_at).getTime() &&
    new Date(shift.end_at).getTime() > new Date(task.start_at).getTime()
  );
}

/** "1,15, 31" → [1, 15, 31] (bỏ trùng, chỉ nhận 1..31) */
export function parseMonthDays(value: string): number[] | null {
  const items = value.split(/[\s,;]+/).filter(Boolean);
  const days = new Set<number>();
  for (const item of items) {
    const n = Number(item);
    if (!Number.isInteger(n) || n < 1 || n > 31) return null;
    days.add(n);
  }
  return [...days].sort((a, b) => a - b);
}
