// Báo cáo chấm công theo (nhân viên × ngày) — dùng chung quy tắc với bảng lương:
//  * Đi trễ: lần vào ca ĐẦU TIÊN trong ngày muộn hơn mốc + số phút ân hạn.
//    Mốc = giờ bắt đầu ca đầu tiên theo lịch đã công bố (có đơn xin trễ đã duyệt → giờ đã xin);
//    không có lịch → giờ vào ca mặc định của nhân viên; không có cả hai → không tính trễ.
//  * Vắng: có ca theo lịch đã kết thúc mà không chấm công, không có đơn nghỉ đã duyệt.
//  * Chưa vào ca: ca đã bắt đầu, chưa kết thúc, chưa chấm công.

import { formatTime, vnDateString } from "@/lib/time";

const VN_OFFSET = "+07:00";

export type DayStatus = "late" | "ontime" | "offschedule" | "missing" | "absent" | "leave" | "notyet";

export const DAY_STATUS: Record<DayStatus, { label: string; className: string; order: number }> = {
  missing: { label: "Chưa vào ca", className: "bg-red-600 text-white", order: 0 },
  absent: { label: "Vắng mặt", className: "bg-red-50 text-red-700", order: 1 },
  late: { label: "Đi trễ", className: "bg-amber-50 text-amber-800", order: 2 },
  ontime: { label: "Đúng giờ", className: "bg-emerald-50 text-emerald-700", order: 3 },
  offschedule: { label: "Ngoài lịch", className: "bg-sky-50 text-sky-700", order: 4 },
  notyet: { label: "Chưa đến giờ", className: "bg-neutral-100 text-neutral-600", order: 5 },
  leave: { label: "Nghỉ phép", className: "bg-violet-50 text-violet-700", order: 6 },
};

export type ReportEmployee = { id: string; name: string; mustClock: boolean; defaultStart: string | null; grace: number };
export type ReportShift = { id: string; employeeId: string; workDate: string; startAt: string; endAt: string; startTime: string; lateRequestTime: string | null };
export type ReportRecord = { id: string; employeeId: string; checkIn: string; checkOut: string | null };
export type ReportLeave = { employeeId: string; startDate: string; endDate: string };

export type EmployeeDay<R extends ReportRecord = ReportRecord> = {
  key: string;
  employeeId: string;
  name: string;
  day: string;
  status: DayStatus;
  /** Ca theo lịch trong ngày, VD "08:00–14:00" */
  shiftLabel: string | null;
  lateMinutes: number;
  /** Phút làm của các lượt đã ra ca */
  minutes: number;
  records: R[];
};

const hm = (t: string) => t.slice(0, 5);

/** Ngày giờ VN của (ngày, giờ "HH:MM[:SS]") → ms; giờ nhỏ hơn giờ bắt đầu ca = sang ngày hôm sau */
function vnTime(day: string, time: string, startTime?: string): number {
  const base = Date.parse(`${day}T${hm(time)}:00${VN_OFFSET}`);
  return startTime && hm(time) < hm(startTime) ? base + 86_400_000 : base;
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; ) {
    out.push(d);
    const next = new Date(`${d}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    d = next.toISOString().slice(0, 10);
  }
  return out;
}

export function buildAttendanceReport<R extends ReportRecord>({
  from,
  to,
  now,
  employees,
  shifts,
  records,
  leaves,
}: {
  from: string;
  to: string;
  now: number;
  employees: Map<string, ReportEmployee>;
  shifts: ReportShift[];
  records: R[];
  leaves: ReportLeave[];
}): EmployeeDay<R>[] {
  const group = <T,>(items: T[], key: (t: T) => string) => {
    const map = new Map<string, T[]>();
    for (const item of items) map.set(key(item), [...(map.get(key(item)) ?? []), item]);
    return map;
  };
  const shiftsBy = group(shifts, (s) => `${s.employeeId}|${s.workDate}`);
  const recordsBy = group(records, (r) => `${r.employeeId}|${vnDateString(new Date(r.checkIn))}`);
  const onLeave = (employeeId: string, day: string) =>
    leaves.some((l) => l.employeeId === employeeId && l.startDate <= day && l.endDate >= day);

  const result: EmployeeDay<R>[] = [];
  const keys = new Set([...shiftsBy.keys(), ...recordsBy.keys()]);
  for (const key of keys) {
    const [employeeId, day] = key.split("|");
    if (day < from || day > to) continue;
    const emp = employees.get(employeeId);
    if (!emp) continue;

    const dayShifts = (shiftsBy.get(key) ?? []).sort((a, b) => a.startAt.localeCompare(b.startAt));
    const dayRecords = (recordsBy.get(key) ?? []).sort((a, b) => a.checkIn.localeCompare(b.checkIn));
    const first = dayShifts[0];
    const shiftLabel = dayShifts.length ? dayShifts.map((s) => `${formatTime(s.startAt)}–${formatTime(s.endAt)}`).join(", ") : null;

    let status: DayStatus;
    let lateMinutes = 0;
    const minutes = dayRecords.reduce(
      (total, r) => total + (r.checkOut ? Math.max(0, Math.round((Date.parse(r.checkOut) - Date.parse(r.checkIn)) / 60_000)) : 0),
      0
    );

    if (dayRecords.length > 0) {
      const firstIn = Date.parse(dayRecords[0].checkIn);
      let base: number | null = null;
      if (first) base = first.lateRequestTime ? vnTime(first.workDate, first.lateRequestTime, first.startTime) : Date.parse(first.startAt);
      else if (emp.defaultStart) base = vnTime(day, emp.defaultStart);

      if (base !== null && firstIn > base + emp.grace * 60_000) {
        status = "late";
        lateMinutes = Math.round((firstIn - base) / 60_000);
      } else status = base !== null ? "ontime" : "offschedule";
    } else {
      if (!emp.mustClock) continue;
      if (onLeave(employeeId, day)) status = "leave";
      else if (now < Date.parse(first.startAt)) status = "notyet";
      else if (now <= Math.max(...dayShifts.map((s) => Date.parse(s.endAt)))) status = "missing";
      else status = "absent";
    }

    result.push({ key, employeeId, name: emp.name, day, status, shiftLabel, lateMinutes, minutes, records: dayRecords });
  }
  return result;
}
