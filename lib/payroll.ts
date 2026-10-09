// Bảng lương: nhãn, định dạng tiền, tính kỳ lương (dùng chung client + server).

import type { PayPeriod, PayType, PayrollAdjustmentKind } from "@/lib/database.types";

export const PAY_TYPE_LABELS: Record<PayType, string> = {
  hourly: "Theo giờ",
  per_shift: "Theo ca",
  fixed: "Lương cố định",
};

export const PAY_PERIOD_LABELS: Record<PayPeriod, string> = {
  weekly: "Theo tuần",
  monthly: "Theo tháng",
};

export const ADJUSTMENT_KINDS: { value: PayrollAdjustmentKind; label: string; sign: 1 | -1 }[] = [
  { value: "kpi", label: "Thưởng KPI", sign: 1 },
  { value: "bonus", label: "Thưởng", sign: 1 },
  { value: "allowance", label: "Phụ cấp khác", sign: 1 },
  { value: "deduction", label: "Khoản trừ", sign: -1 },
  { value: "correction_plus", label: "Truy lĩnh (bù kỳ trước)", sign: 1 },
  { value: "correction_minus", label: "Truy thu (trừ lại kỳ trước)", sign: -1 },
];

const money = new Intl.NumberFormat("vi-VN");

export function formatMoney(amount: number): string {
  return `${money.format(amount)}đ`;
}

export function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} giờ` : `${h} giờ ${m} phút`;
}

// ---------------------------------------------------------------------
// Kỳ lương — làm việc với chuỗi ngày "YYYY-MM-DD" (giờ Việt Nam)
// ---------------------------------------------------------------------
function toUtcDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function fromUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Ngày bắt đầu kỳ chứa ngày `day`: thứ 2 của tuần hoặc ngày 1 của tháng. */
export function periodStartOf(period: PayPeriod, day: string): string {
  const d = toUtcDate(day);
  if (period === "weekly") {
    const isoDow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
    d.setUTCDate(d.getUTCDate() - (isoDow - 1));
    return fromUtcDate(d);
  }
  return `${day.slice(0, 7)}-01`;
}

export function periodEnd(period: PayPeriod, start: string): string {
  const d = toUtcDate(start);
  if (period === "weekly") {
    d.setUTCDate(d.getUTCDate() + 6);
  } else {
    d.setUTCMonth(d.getUTCMonth() + 1, 0);
  }
  return fromUtcDate(d);
}

export function shiftPeriod(period: PayPeriod, start: string, delta: number): string {
  const d = toUtcDate(start);
  if (period === "weekly") {
    d.setUTCDate(d.getUTCDate() + 7 * delta);
  } else {
    d.setUTCMonth(d.getUTCMonth() + delta, 1);
  }
  return fromUtcDate(d);
}

export function isValidPeriodStart(period: PayPeriod, start: unknown): start is string {
  if (typeof start !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return false;
  if (Number.isNaN(toUtcDate(start).getTime())) return false;
  return periodStartOf(period, start) === start;
}

function dm(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

/** `end`: ngày kết thúc thực tế của phiếu (chốt sớm) — ghi chú nếu sớm hơn hết kỳ. */
export function periodLabel(period: PayPeriod, start: string, end?: string | null): string {
  const label =
    period === "monthly"
      ? `Tháng ${start.slice(5, 7)}/${start.slice(0, 4)}`
      : `Tuần ${dm(start)} – ${dm(periodEnd(period, start))}/${periodEnd(period, start).slice(0, 4)}`;
  return end && end < periodEnd(period, start) ? `${label} (chốt sớm đến ${dm(end)})` : label;
}

/** Ngày chốt sớm hợp lệ: trong kỳ, từ đầu kỳ đến hôm nay. */
export function isValidEarlyEnd(period: PayPeriod, start: string, end: unknown, today: string): end is string {
  if (typeof end !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return false;
  if (Number.isNaN(toUtcDate(end).getTime())) return false;
  return end >= start && end <= today && end <= periodEnd(period, start);
}

export function formatDayMonth(day: string): string {
  return dm(day);
}

// ---------------------------------------------------------------------
// Dữ liệu phiếu lương (do hàm DB compute_payslip trả về)
// ---------------------------------------------------------------------
export type PayslipLine = {
  code: string;
  label: string;
  amount: number;
  quantity?: number;
  unit_amount?: number;
  detail?: string;
  adjustment_id?: string;
};

export type PayslipData = {
  employee_id: string;
  full_name: string;
  role: string;
  pay_type: PayType;
  pay_period: PayPeriod;
  period_start: string;
  period_end: string;
  /** Chốt sớm (NV nghỉ giữa kỳ): period_end trước ngày cuối kỳ */
  closed_early?: boolean;
  worked_minutes: number;
  overtime_minutes: number;
  shifts: number;
  work_days: number;
  late_count: number;
  // Có từ Phase 5 (phiếu chốt trước đó không có)
  early_count?: number;
  absent_count?: number;
  paid_leave_days?: number;
  lines: PayslipLine[];
  gross_amount: number;
  deductions_amount: number;
  raw_net_amount: number;
  net_amount: number;
  warnings: { blocking: boolean; message: string }[];
  can_finalize: boolean;
  finalized: boolean;
  payslip_id?: string;
  finalized_at?: string;
};

export type PayrollOverview = {
  period_start: string;
  period_end: string;
  items: PayslipData[];
  missing_profiles: { employee_id: string; full_name: string }[];
};
