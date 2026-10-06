// Xử lý thời gian theo giờ Việt Nam (UTC+7, không có giờ mùa hè).

export const TIME_ZONE = "Asia/Ho_Chi_Minh";
const VN_OFFSET = "+07:00";

/** Ca mở quá số giờ này được coi là "quên ra ca" (khớp với DB). */
export const FORGOT_CHECKOUT_HOURS = 16;

const dateTimeFormat = new Intl.DateTimeFormat("vi-VN", {
  timeZone: TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const timeFormat = new Intl.DateTimeFormat("vi-VN", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const dateFormat = new Intl.DateTimeFormat("vi-VN", {
  timeZone: TIME_ZONE,
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
});

// en-CA cho ra dạng YYYY-MM-DD
const isoDateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function formatDateTime(iso: string): string {
  return dateTimeFormat.format(new Date(iso));
}

export function formatTime(iso: string): string {
  return timeFormat.format(new Date(iso));
}

/** "T2, 07/10" */
export function formatDay(iso: string): string {
  return dateFormat.format(new Date(iso));
}

/** Ngày (YYYY-MM-DD) theo giờ Việt Nam. */
export function vnDateString(date: Date = new Date()): string {
  return isoDateFormat.format(date);
}

/** Khoảng thời gian [start, end) của một ngày theo giờ Việt Nam, dạng ISO. */
export function vnDayRange(dateStr: string): { start: string; end: string } {
  const start = new Date(`${dateStr}T00:00:00${VN_OFFSET}`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function isValidDateString(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

/** ISO → giá trị cho <input type="datetime-local"> theo giờ Việt Nam. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const date = isoDateFormat.format(d);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return `${date}T${time}`;
}

/** Giá trị <input type="datetime-local"> (giờ VN) → ISO. Trả null nếu không hợp lệ. */
export function fromLocalInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00${VN_OFFSET}`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function minutesBetween(startIso: string, endIso: string | null, now: number = Date.now()): number {
  const end = endIso ? new Date(endIso).getTime() : now;
  return Math.max(0, Math.round((end - new Date(startIso).getTime()) / 60000));
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} phút`;
  return m === 0 ? `${h} giờ` : `${h} giờ ${m} phút`;
}

export function isForgotten(checkInIso: string, checkOutIso: string | null, now: number = Date.now()): boolean {
  return !checkOutIso && now - new Date(checkInIso).getTime() > FORGOT_CHECKOUT_HOURS * 60 * 60 * 1000;
}
