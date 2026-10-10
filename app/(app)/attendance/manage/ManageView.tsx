"use client";

import { useCallback, useEffect, useState } from "react";
import { AddManualButton, EditRecordButton, ReviewCorrection, type StaffOption } from "./ManageDialogs";
import { MethodBadge } from "../badges";
import { DAY_STATUS, type DayStatus, type EmployeeDay } from "@/lib/attendance-report";
import { formatDateTime, formatDay, formatDuration, formatTime, minutesBetween } from "@/lib/time";
import type { AttendanceMethod } from "@/lib/database.types";

export type PendingItem = {
  id: string;
  employeeName: string;
  branchName: string;
  recordCheckIn: string;
  recordCheckOut: string | null;
  requestedIn: string;
  requestedOut: string;
  reason: string;
  createdAt: string;
  isMine: boolean;
};

export type RecordItem = {
  id: string;
  employeeId: string;
  employeeName: string;
  branchName: string;
  checkIn: string;
  checkOut: string | null;
  inMethod: AttendanceMethod;
  outMethod: AttendanceMethod | null;
  isCorrected: boolean;
  correctionNote: string | null;
  forgotten: boolean;
  isMine: boolean;
};

type Props = {
  pending: PendingItem[];
  openShifts: RecordItem[];
  report: EmployeeDay<RecordItem>[];
  staff: StaffOption[];
  rangeLabel: string;
  /** Khoảng ngày có hôm nay → mới có "Chưa vào ca" / "Đang trong ca" */
  includesToday: boolean;
  multiDay: boolean;
};

const WEEKDAY_NAMES = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];

/** Một lượt vào/ra (dùng ở "Cần xử lý" và lịch sử) */
function SessionLine({ record, onDone, showDate }: { record: RecordItem; onDone: (m: string) => void; showDate?: boolean }) {
  const canEdit = !record.isMine && (record.checkOut !== null || record.forgotten);
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm tabular-nums text-neutral-800">
          {showDate ? formatDateTime(record.checkIn) : formatTime(record.checkIn)} → {record.checkOut ? formatTime(record.checkOut) : "…"}
          {record.checkOut && (
            <span className="ml-1.5 text-neutral-500">({formatDuration(minutesBetween(record.checkIn, record.checkOut))})</span>
          )}
        </p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <MethodBadge method={record.inMethod} prefix="Vào" />
          {record.outMethod && <MethodBadge method={record.outMethod} prefix="Ra" />}
          {record.isCorrected && (
            <span className="rounded-md bg-violet-50 px-2 py-0.5 text-xs text-violet-700" title={record.correctionNote ?? ""}>
              Đã sửa
            </span>
          )}
          {record.forgotten && <span className="rounded-md bg-red-50 px-2 py-0.5 text-xs text-red-700">Quên ra ca</span>}
          {!record.checkOut && !record.forgotten && <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">Đang làm</span>}
        </div>
        {record.isCorrected && record.correctionNote && <p className="mt-1 text-xs text-neutral-500">{record.correctionNote}</p>}
      </div>
      {canEdit && (
        <div className="shrink-0">
          <EditRecordButton recordId={record.id} employeeName={record.employeeName} checkIn={record.checkIn} checkOut={record.checkOut} onDone={onDone} />
        </div>
      )}
    </div>
  );
}

function statusText(d: EmployeeDay<RecordItem>) {
  if (d.status === "late") return `Trễ ${formatDuration(d.lateMinutes)}`;
  return DAY_STATUS[d.status].label;
}

export default function ManageView({ pending, openShifts, report, staff, rangeLabel, includesToday, multiDay }: Props) {
  const [toast, setToast] = useState("");
  const [statusFilter, setStatusFilter] = useState<DayStatus | null>(null);
  const notify = useCallback((message: string) => setToast(message), []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const forgotten = openShifts.filter((r) => r.forgotten);
  const working = openShifts.filter((r) => !r.forgotten);
  const count = (s: DayStatus) => report.filter((d) => d.status === s).length;
  const missing = report.filter((d) => d.status === "missing");
  const lateDays = report.filter((d) => d.status === "late");
  const totalMinutes = report.reduce((t, d) => t + d.minutes, 0);
  const workDays = report.filter((d) => d.records.length > 0).length;

  const toggle = (s: DayStatus) => setStatusFilter((cur) => (cur === s ? null : s));
  const visible = report
    .filter((d) => !statusFilter || d.status === statusFilter)
    .sort((a, b) => b.day.localeCompare(a.day) || DAY_STATUS[a.status].order - DAY_STATUS[b.status].order || a.name.localeCompare(b.name, "vi"));
  const byDay = new Map<string, EmployeeDay<RecordItem>[]>();
  for (const d of visible) byDay.set(d.day, [...(byDay.get(d.day) ?? []), d]);

  return (
    <div className="space-y-6">
      {/* SỐ LIỆU NHANH — bấm ô để lọc lịch sử bên dưới */}
      <section aria-label="Tổng quan chấm công">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="Đang trong ca"
            value={includesToday ? working.length : "—"}
            sub={includesToday ? (working.length ? "Ngay lúc này" : "Chưa có ai trong ca") : "Chỉ xem được hôm nay"}
            tone={working.length ? "good" : "neutral"}
            onClick={includesToday && working.length ? () => document.getElementById("dang-trong-ca")?.scrollIntoView({ behavior: "smooth" }) : undefined}
          />
          <Stat
            label="Chưa vào ca"
            value={includesToday ? missing.length : "—"}
            sub={
              includesToday
                ? missing.length
                  ? missing.map((d) => d.name).slice(0, 3).join(", ") + (missing.length > 3 ? "…" : "")
                  : "Ai có ca đều đã vào"
                : "Chỉ xem được hôm nay"
            }
            tone={missing.length ? "bad" : "neutral"}
            active={statusFilter === "missing"}
            onClick={missing.length ? () => toggle("missing") : undefined}
          />
          <Stat
            label="Đi trễ"
            value={lateDays.length}
            sub={lateDays.length ? `Tổng ${formatDuration(lateDays.reduce((t, d) => t + d.lateMinutes, 0))}` : "Không ai đi trễ"}
            tone={lateDays.length ? "warn" : "good"}
            active={statusFilter === "late"}
            onClick={lateDays.length ? () => toggle("late") : undefined}
          />
          <Stat
            label="Vắng mặt"
            value={count("absent")}
            sub={count("absent") ? "Có ca nhưng không chấm công" : "Không có ai vắng"}
            tone={count("absent") ? "bad" : "good"}
            active={statusFilter === "absent"}
            onClick={count("absent") ? () => toggle("absent") : undefined}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <Chip label="Đúng giờ" value={count("ontime")} active={statusFilter === "ontime"} onClick={() => toggle("ontime")} className="text-emerald-700" />
          <Chip label="Ngoài lịch" value={count("offschedule")} active={statusFilter === "offschedule"} onClick={() => toggle("offschedule")} className="text-sky-700" />
          <Chip label="Nghỉ phép" value={count("leave")} active={statusFilter === "leave"} onClick={() => toggle("leave")} className="text-violet-700" />
          <span className="rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-neutral-600">
            Giờ công <strong className="tabular-nums text-neutral-900">{formatDuration(totalMinutes)}</strong> · {workDays} ngày công
          </span>
        </div>
      </section>

      {/* CẦN XỬ LÝ */}
      {(pending.length > 0 || forgotten.length > 0) && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 font-semibold">
            Cần xử lý
            <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">{pending.length + forgotten.length}</span>
          </h2>
          <ul className="card divide-y divide-neutral-100">
            {pending.map((item) => (
              <li key={item.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 text-sm">
                  <p className="font-semibold">
                    📝 {item.employeeName} <span className="font-normal text-neutral-500">· {item.branchName}</span>
                  </p>
                  <p className="mt-1 text-neutral-600">
                    Ghi nhận: {formatDateTime(item.recordCheckIn)} → {item.recordCheckOut ? formatTime(item.recordCheckOut) : "chưa ra ca"}
                  </p>
                  <p className="text-neutral-900">
                    Đề xuất: <strong>{formatDateTime(item.requestedIn)} → {formatTime(item.requestedOut)}</strong>
                    <span className="ml-1 text-neutral-500">({formatDuration(minutesBetween(item.requestedIn, item.requestedOut))})</span>
                  </p>
                  <p className="mt-1 text-neutral-500">Lý do: {item.reason}</p>
                </div>
                {item.isMine ? (
                  <span className="text-xs text-neutral-400">Yêu cầu của bạn — người khác duyệt</span>
                ) : (
                  <ReviewCorrection correctionId={item.id} requestedIn={item.requestedIn} requestedOut={item.requestedOut} onDone={notify} />
                )}
              </li>
            ))}
            {forgotten.map((record) => (
              <li key={record.id} className="p-4">
                <p className="mb-1 text-sm font-semibold">
                  ⏰ {record.employeeName} <span className="font-normal text-neutral-500">· {record.branchName}</span>
                </p>
                <SessionLine record={record} onDone={notify} showDate />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ĐANG TRONG CA */}
      {includesToday && working.length > 0 && (
        <section id="dang-trong-ca" className="scroll-mt-20">
          <h2 className="mb-3 font-semibold">Đang trong ca ({working.length})</h2>
          <ul className="card divide-y divide-neutral-100">
            {working.map((record) => (
              <li key={record.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="min-w-0">
                  <span className="font-semibold">{record.employeeName}</span>
                  <span className="text-neutral-500"> · {record.branchName}</span>
                </span>
                <span className="shrink-0 tabular-nums text-neutral-600">
                  từ {formatTime(record.checkIn)}
                  {formatDay(record.checkIn) !== formatDay(new Date().toISOString()) && ` (${formatDay(record.checkIn)})`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* TỔNG HỢP THEO NHÂN VIÊN */}
      {multiDay && <StaffSummary report={report} />}

      {/* LỊCH SỬ */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="min-w-0 font-semibold">
            Lịch sử · {rangeLabel}
            {statusFilter && (
              <button type="button" onClick={() => setStatusFilter(null)} className="ml-2 rounded-full bg-neutral-900/5 px-2.5 py-0.5 text-xs font-medium text-neutral-600 hover:bg-neutral-900/10">
                {DAY_STATUS[statusFilter].label} ✕
              </button>
            )}
          </h2>
          <AddManualButton staff={staff} onDone={notify} />
        </div>

        {visible.length === 0 ? (
          <div className="card px-6 py-8 text-center text-sm text-neutral-500">
            {statusFilter ? `Không có ai "${DAY_STATUS[statusFilter].label}" trong khoảng này.` : "Không có ca làm hay lượt chấm công nào trong khoảng này."}
          </div>
        ) : (
          <div className="space-y-5">
            {[...byDay].map(([day, items]) => (
              <div key={day}>
                {multiDay && <DayHeader day={day} items={items} />}
                <ul className="card divide-y divide-neutral-100 overflow-hidden">
                  {items.map((d) => {
                    const meta = DAY_STATUS[d.status];
                    return (
                      <li key={d.key} className={`p-4 ${d.status === "missing" ? "bg-red-50/60 shadow-[inset_4px_0_0_var(--color-red-600)]" : ""}`}>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-semibold">{d.name}</span>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${meta.className}`}>{statusText(d)}</span>
                          {d.minutes > 0 && <span className="ml-auto text-xs tabular-nums text-neutral-500">{formatDuration(d.minutes)}</span>}
                        </div>
                        {d.shiftLabel && <p className="mt-0.5 text-xs text-neutral-500">Ca theo lịch: <span className="tabular-nums">{d.shiftLabel}</span></p>}
                        {d.records.length > 0 && (
                          <div className="mt-2.5 space-y-2.5 border-l-2 border-neutral-100 pl-3">
                            {d.records.map((r) => (
                              <SessionLine key={r.id} record={r} onDone={notify} />
                            ))}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {toast && (
        <p role="status" className="alert-success fixed inset-x-4 bottom-[calc(var(--nav-h)+1rem)] z-50 shadow-lg sm:left-auto sm:right-6 sm:w-96">
          {toast}
        </p>
      )}
    </div>
  );
}

const TONE: Record<"neutral" | "good" | "warn" | "bad", string> = {
  neutral: "text-neutral-900",
  good: "text-emerald-700",
  warn: "text-amber-700",
  bad: "text-red-700",
};

/** Ô số liệu: bấm để lọc lịch sử theo trạng thái */
function Stat({
  label,
  value,
  sub,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  sub: string;
  tone: keyof typeof TONE;
  active?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</span>
      <span className={`mt-1 text-3xl font-bold tabular-nums ${TONE[tone]}`}>{value}</span>
      <span className="mt-1 line-clamp-2 text-xs text-neutral-500">{sub}</span>
    </>
  );
  const cls = `card flex min-w-0 flex-col p-3.5 text-left sm:p-4 ${tone === "bad" && value !== 0 && value !== "—" ? "border-red-200" : ""} ${active ? "ring-2 ring-brand" : ""}`;
  return onClick ? (
    <button type="button" onClick={onClick} aria-pressed={active} className={`${cls} transition hover:border-neutral-400 active:scale-[0.98]`}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function Chip({ label, value, active, onClick, className }: { label: string; value: number; active: boolean; onClick: () => void; className: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!value && !active}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1.5 transition disabled:opacity-50 ${active ? "border-brand bg-brand/5" : "border-neutral-200 bg-white hover:border-neutral-400"}`}
    >
      <span className="text-neutral-600">{label}</span> <strong className={`tabular-nums ${className}`}>{value}</strong>
    </button>
  );
}

/** Tiêu đề ngày khi xem nhiều ngày: "Thứ hai, 06/10/2026 · 5 người · 1 trễ" */
function DayHeader({ day, items }: { day: string; items: EmployeeDay<RecordItem>[] }) {
  const [y, m, d] = day.split("-");
  const weekday = WEEKDAY_NAMES[new Date(`${day}T00:00:00Z`).getUTCDay()];
  const worked = items.filter((i) => i.records.length > 0).length;
  const late = items.filter((i) => i.status === "late").length;
  const absent = items.filter((i) => i.status === "absent").length;
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
      <h3 className="text-sm font-semibold">
        {weekday}, <span className="tabular-nums">{d}/{m}/{y}</span>
      </h3>
      <p className="shrink-0 text-xs text-neutral-500">
        {worked} người làm
        {late > 0 && <span className="ml-1.5 font-medium text-amber-700">· {late} trễ</span>}
        {absent > 0 && <span className="ml-1.5 font-medium text-red-700">· {absent} vắng</span>}
      </p>
    </div>
  );
}

/** Giờ công gọn cho bảng: 125 phút → "2g05" */
function shortHours(minutes: number) {
  return `${Math.floor(minutes / 60)}g${String(minutes % 60).padStart(2, "0")}`;
}

/** Bảng tổng hợp theo nhân viên cho khoảng nhiều ngày */
function StaffSummary({ report }: { report: EmployeeDay<RecordItem>[] }) {
  type Row = { name: string; days: number; minutes: number; late: number; lateMinutes: number; absent: number };
  const rows = new Map<string, Row>();
  for (const d of report) {
    const row = rows.get(d.employeeId) ?? { name: d.name, days: 0, minutes: 0, late: 0, lateMinutes: 0, absent: 0 };
    if (d.records.length > 0) row.days++;
    row.minutes += d.minutes;
    if (d.status === "late") {
      row.late++;
      row.lateMinutes += d.lateMinutes;
    }
    if (d.status === "absent") row.absent++;
    rows.set(d.employeeId, row);
  }
  const list = [...rows.values()].sort((a, b) => b.absent + b.late - (a.absent + a.late) || a.name.localeCompare(b.name, "vi"));
  if (list.length === 0) return null;

  return (
    <section className="card overflow-hidden">
      <h2 className="border-b border-neutral-100 px-4 py-3 text-sm font-semibold">Tổng hợp theo nhân viên</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-neutral-50 text-xs text-neutral-500">
              <th className="px-3 py-2 text-left font-medium sm:px-4">Nhân viên</th>
              <th className="px-1.5 py-2 text-right font-medium sm:px-2">Ngày</th>
              <th className="px-1.5 py-2 text-right font-medium sm:px-2">Giờ công</th>
              <th className="px-1.5 py-2 text-right font-medium sm:px-2">Trễ</th>
              <th className="px-3 py-2 text-right font-medium sm:px-4">Vắng</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {list.map((r) => (
              <tr key={r.name}>
                <td className="max-w-0 truncate px-3 py-2.5 font-medium sm:px-4">{r.name}</td>
                <td className="w-1 px-1.5 py-2.5 text-right tabular-nums sm:px-2">{r.days}</td>
                <td className="w-1 whitespace-nowrap px-1.5 py-2.5 text-right tabular-nums sm:px-2">{shortHours(r.minutes)}</td>
                <td className={`w-1 whitespace-nowrap px-1.5 py-2.5 text-right tabular-nums sm:px-2 ${r.late ? "font-semibold text-amber-700" : "text-neutral-400"}`} title={r.late ? `Tổng ${formatDuration(r.lateMinutes)}` : undefined}>
                  {r.late || "—"}
                </td>
                <td className={`w-1 px-3 py-2.5 text-right tabular-nums sm:px-4 ${r.absent ? "font-semibold text-red-700" : "text-neutral-400"}`}>{r.absent || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-neutral-100 px-4 py-2 text-xs text-neutral-500">
        Trễ = số ngày vào ca muộn quá thời gian ân hạn (giống bảng lương) · Vắng = có ca theo lịch nhưng không chấm công, không có đơn nghỉ.
      </p>
    </section>
  );
}
