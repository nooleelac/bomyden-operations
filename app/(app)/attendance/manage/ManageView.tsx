"use client";

import { useCallback, useEffect, useState } from "react";
import { AddManualButton, EditRecordButton, ReviewCorrection, type StaffOption } from "./ManageDialogs";
import { MethodBadge } from "../badges";
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
  dayRecords: RecordItem[];
  staff: StaffOption[];
  dateLabel: string;
};

function RecordRow({ record, onDone, showDate }: { record: RecordItem; onDone: (m: string) => void; showDate?: boolean }) {
  return (
    <li className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-semibold">
          {record.employeeName}
          <span className="font-normal text-neutral-500"> · {record.branchName}</span>
        </p>
        <p className="mt-0.5 text-sm tabular-nums text-neutral-700">
          {showDate ? formatDateTime(record.checkIn) : formatTime(record.checkIn)} →{" "}
          {record.checkOut ? formatTime(record.checkOut) : "…"}
          {record.checkOut && (
            <span className="ml-2 text-neutral-500">({formatDuration(minutesBetween(record.checkIn, record.checkOut))})</span>
          )}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <MethodBadge method={record.inMethod} prefix="Vào" />
          {record.outMethod && <MethodBadge method={record.outMethod} prefix="Ra" />}
          {record.isCorrected && (
            <span className="rounded-md bg-violet-50 px-2 py-0.5 text-xs text-violet-700" title={record.correctionNote ?? ""}>
              Đã sửa
            </span>
          )}
          {record.forgotten && <span className="rounded-md bg-red-50 px-2 py-0.5 text-xs text-red-700">Quên ra ca</span>}
        </div>
        {record.isCorrected && record.correctionNote && (
          <p className="mt-1 text-xs text-neutral-500">{record.correctionNote}</p>
        )}
      </div>
      {!record.isMine && (!record.checkOut ? record.forgotten : true) && (
        <EditRecordButton
          recordId={record.id}
          employeeName={record.employeeName}
          checkIn={record.checkIn}
          checkOut={record.checkOut}
          onDone={onDone}
        />
      )}
    </li>
  );
}

export default function ManageView({ pending, openShifts, dayRecords, staff, dateLabel }: Props) {
  const [toast, setToast] = useState("");
  const notify = useCallback((message: string) => setToast(message), []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Tổng giờ theo nhân viên trong ngày (chỉ ca đã kết thúc)
  const totals = new Map<string, { name: string; minutes: number; shifts: number }>();
  for (const record of dayRecords) {
    const item = totals.get(record.employeeId) ?? { name: record.employeeName, minutes: 0, shifts: 0 };
    item.shifts += 1;
    if (record.checkOut) item.minutes += minutesBetween(record.checkIn, record.checkOut);
    totals.set(record.employeeId, item);
  }

  const forgotten = openShifts.filter((r) => r.forgotten);
  const working = openShifts.filter((r) => !r.forgotten);

  return (
    <div className="space-y-8">
      {/* CẦN XỬ LÝ */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 font-semibold">
          Cần xử lý
          {pending.length + forgotten.length > 0 && (
            <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">
              {pending.length + forgotten.length}
            </span>
          )}
        </h2>
        {pending.length === 0 && forgotten.length === 0 ? (
          <div className="card px-6 py-8 text-center text-sm text-neutral-500">Không có việc cần xử lý. 👍</div>
        ) : (
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
                  <ReviewCorrection
                    correctionId={item.id}
                    requestedIn={item.requestedIn}
                    requestedOut={item.requestedOut}
                    onDone={notify}
                  />
                )}
              </li>
            ))}
            {forgotten.map((record) => (
              <RecordRow key={record.id} record={record} onDone={notify} showDate />
            ))}
          </ul>
        )}
      </section>

      {/* ĐANG TRONG CA */}
      <section>
        <h2 className="mb-3 font-semibold">Đang trong ca ({working.length})</h2>
        {working.length === 0 ? (
          <div className="card px-6 py-6 text-center text-sm text-neutral-500">Không có ai đang trong ca.</div>
        ) : (
          <ul className="card divide-y divide-neutral-100">
            {working.map((record) => (
              <li key={record.id} className="flex items-center justify-between p-4 text-sm">
                <span>
                  <span className="font-semibold">{record.employeeName}</span>
                  <span className="text-neutral-500"> · {record.branchName}</span>
                </span>
                <span className="tabular-nums text-neutral-600">
                  từ {formatTime(record.checkIn)}
                  {formatDay(record.checkIn) !== formatDay(new Date().toISOString()) && ` (${formatDay(record.checkIn)})`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* THEO NGÀY */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Chấm công {dateLabel}</h2>
          <AddManualButton staff={staff} onDone={notify} />
        </div>

        {totals.size > 0 && (
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[...totals.entries()].map(([id, t]) => (
              <div key={id} className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm">
                <p className="truncate font-medium">{t.name}</p>
                <p className="text-xs text-neutral-500">
                  {formatDuration(t.minutes)} · {t.shifts} lượt
                </p>
              </div>
            ))}
          </div>
        )}

        {dayRecords.length === 0 ? (
          <div className="card px-6 py-8 text-center text-sm text-neutral-500">Không có ca nào trong ngày này.</div>
        ) : (
          <ul className="card divide-y divide-neutral-100">
            {dayRecords.map((record) => (
              <RecordRow key={record.id} record={record} onDone={notify} />
            ))}
          </ul>
        )}
      </section>

      {toast && (
        <p role="status" className="alert-success fixed inset-x-4 bottom-4 z-50 shadow-lg sm:left-auto sm:right-6 sm:w-96">
          {toast}
        </p>
      )}
    </div>
  );
}
