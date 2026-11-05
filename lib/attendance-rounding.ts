// Làm tròn giờ công theo ca — cùng quy tắc với private.paid_minutes (migration 067):
//  * Vào sớm không quá earlyArrival phút → tính từ giờ bắt đầu ca; sớm hơn → giờ vào thực tế (có thể thành tăng ca).
//  * Ra trước giờ hết ca không quá earlyCheckout phút → tính đủ đến hết ca; ra muộn → giờ ra thực tế.
//  * Không khớp ca nào → giờ thực tế.
// Ghép ca giống private.record_shift: ca đã công bố sớm nhất chưa kết thúc lúc vào, bắt đầu không quá 3 giờ sau giờ vào.

export type Rounding = { earlyArrival: number; earlyCheckout: number };
export const DEFAULT_ROUNDING: Rounding = { earlyArrival: 30, earlyCheckout: 15 };

export type ShiftSpan = { employeeId: string; startAt: string; endAt: string };

const MIN = 60_000;

/** Kết quả rpc("attendance_rounding") → Rounding */
export function toRounding(rows: { early_arrival_minutes: number; early_checkout_minutes: number }[] | null | undefined): Rounding {
  const row = rows?.[0];
  return row ? { earlyArrival: row.early_arrival_minutes, earlyCheckout: row.early_checkout_minutes } : DEFAULT_ROUNDING;
}

export function matchShift<S extends ShiftSpan>(shifts: S[], employeeId: string, checkIn: string): S | null {
  const t = Date.parse(checkIn);
  let best: S | null = null;
  for (const s of shifts) {
    if (s.employeeId !== employeeId) continue;
    const start = Date.parse(s.startAt);
    if (Date.parse(s.endAt) > t && start < t + 180 * MIN && (!best || start < Date.parse(best.startAt))) best = s;
  }
  return best;
}

/** Số phút tính công của 1 lượt; null khi chưa ra ca */
export function paidMinutes(checkIn: string, checkOut: string | null, shift: ShiftSpan | null, rounding: Rounding): number | null {
  if (!checkOut) return null;
  let start = Date.parse(checkIn);
  let end = Date.parse(checkOut);
  if (shift) {
    const shiftStart = Date.parse(shift.startAt);
    const shiftEnd = Date.parse(shift.endAt);
    if (start < shiftStart && start >= shiftStart - rounding.earlyArrival * MIN) start = shiftStart;
    if (end < shiftEnd && end >= shiftEnd - rounding.earlyCheckout * MIN) end = shiftEnd;
  }
  return Math.max(0, Math.round((end - start) / MIN));
}
