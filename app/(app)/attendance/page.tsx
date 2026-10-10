import type { Metadata } from "next";
import Link from "next/link";
import { requireEmployee } from "@/lib/auth/session";
import { canManageAttendance, mustClockIn } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import {
  formatDateTime,
  formatDay,
  formatDuration,
  formatTime,
  isForgotten,
  minutesBetween,
  vnDateString,
  vnDayRange,
} from "@/lib/time";
import { getRequestTime } from "@/lib/request-time";
import ClockCard from "./ClockCard";
import RequestCorrectionButton from "./RequestCorrectionButton";
import CancelCorrectionButton from "./CancelCorrectionButton";
import { CorrectionStatusBadge, MethodBadge } from "./badges";

export const metadata: Metadata = { title: "Chấm công" };
export const instant = false;

const HISTORY_DAYS = 31;

export default async function AttendancePage() {
  const me = await requireEmployee();

  if (!mustClockIn(me)) {
    return (
      <div className="mx-auto max-w-xl">
        <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">← Trang chủ</Link>
        <div className="card mt-4 p-6 text-center">
          <p className="text-4xl">🕐</p>
          <h1 className="mt-3 text-xl font-bold">
            {me.role === "admin" ? "Quản trị viên không cần chấm công" : "Tài khoản của bạn không cần chấm công"}
          </h1>
          {canManageAttendance(me.role) && (
            <Link href="/attendance/manage" className="btn-primary mt-5">Mở quản lý chấm công</Link>
          )}
        </div>
      </div>
    );
  }

  const supabase = await createClient();
  const now = getRequestTime();
  const since = new Date(now - HISTORY_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: records, error }, { data: corrections }, { data: myBranches }, { data: openRecord }] = await Promise.all([
    supabase
      .from("attendance_records")
      .select("id, check_in_at, check_out_at, check_in_method, check_out_method, is_corrected, correction_note, branches(name)")
      .eq("employee_id", me.id)
      .gte("check_in_at", since)
      .order("check_in_at", { ascending: false }),
    supabase
      .from("attendance_corrections")
      .select("id, attendance_id, requested_check_in_at, requested_check_out_at, reason, status, review_note, created_at")
      .eq("employee_id", me.id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("employee_branches").select("branches!inner(name, is_active)").eq("employee_id", me.id).eq("branches.is_active", true),
    // Ca đang mở (kể cả mở từ lâu, ngoài khoảng lịch sử)
    supabase
      .from("attendance_records")
      .select("id, check_in_at, branches(name)")
      .eq("employee_id", me.id)
      .is("check_out_at", null)
      .maybeSingle(),
  ]);

  if (error) throw new Error("Không tải được dữ liệu chấm công.");

  const pendingRecordIds = new Set(
    (corrections ?? []).filter((c) => c.status === "pending").map((c) => c.attendance_id)
  );

  const forgotten = openRecord ? isForgotten(openRecord.check_in_at, null, now) : false;
  const branchNames = (myBranches ?? []).map((row) => row.branches.name);

  // Tổng giờ (chỉ tính ca đã kết thúc)
  const today = vnDateString(new Date(now));
  const todayStart = vnDayRange(today).start;
  const weekStart = new Date(new Date(todayStart).getTime() - 6 * 24 * 60 * 60 * 1000).toISOString();
  const closed = records.filter((r) => r.check_out_at);
  const sumMinutes = (fromIso: string) =>
    closed
      .filter((r) => new Date(r.check_in_at).getTime() >= new Date(fromIso).getTime())
      .reduce((total, r) => total + minutesBetween(r.check_in_at, r.check_out_at), 0);

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">← Trang chủ</Link>
      <h1 className="mb-5 mt-2 text-2xl font-bold tracking-tight">Chấm công</h1>

      <ClockCard
        openShift={
          openRecord
            ? {
                id: openRecord.id,
                check_in_at: openRecord.check_in_at,
                branch_name: openRecord.branches?.name ?? "",
                has_pending_correction: pendingRecordIds.has(openRecord.id),
              }
            : null
        }
        forgotten={forgotten}
        branchNames={branchNames}
      />

      <div className="mt-4 grid grid-cols-3 gap-3">
        {[
          { label: "Hôm nay", minutes: sumMinutes(todayStart) },
          { label: "7 ngày", minutes: sumMinutes(weekStart) },
          { label: `${HISTORY_DAYS} ngày`, minutes: sumMinutes(since) },
        ].map((item) => (
          <div key={item.label} className="card p-3 text-center">
            <p className="text-xs text-neutral-500">{item.label}</p>
            <p className="mt-1 font-bold tabular-nums">{formatDuration(item.minutes)}</p>
          </div>
        ))}
      </div>

      {(corrections ?? []).length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 font-semibold">Yêu cầu sửa của tôi</h2>
          <ul className="card divide-y divide-neutral-100">
            {corrections!.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-3 p-4 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">
                    {formatDateTime(c.requested_check_in_at)} → {formatTime(c.requested_check_out_at)}
                  </p>
                  <p className="mt-0.5 text-neutral-500">{c.reason}</p>
                  {c.review_note && <p className="mt-1 text-xs text-neutral-500">Quản lý: {c.review_note}</p>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <CorrectionStatusBadge status={c.status} />
                  {c.status === "pending" && <CancelCorrectionButton correctionId={c.id} />}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Lịch sử {HISTORY_DAYS} ngày</h2>
          {/* Tải file Excel chấm công 1 tháng để đối chiếu */}
          <form action="/attendance/export" method="get" className="flex items-center gap-2">
            <label htmlFor="export-month" className="sr-only">Tháng</label>
            <input
              id="export-month"
              name="month"
              type="month"
              defaultValue={today.slice(0, 7)}
              max={today.slice(0, 7)}
              required
              className="input w-auto py-1.5 text-sm"
            />
            <button type="submit" className="btn-secondary whitespace-nowrap">⬇ Excel</button>
          </form>
        </div>
        {records.length === 0 ? (
          <div className="card px-6 py-10 text-center text-sm text-neutral-500">Chưa có ca làm nào.</div>
        ) : (
          <ul className="card divide-y divide-neutral-100">
            {records.map((record) => {
              const isOpen = !record.check_out_at;
              const recordForgotten = isForgotten(record.check_in_at, record.check_out_at, now);
              const canRequest = !pendingRecordIds.has(record.id) && (!isOpen || recordForgotten);
              return (
                <li key={record.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">
                        {formatDay(record.check_in_at)} · {record.branches?.name}
                      </p>
                      <p className="mt-0.5 text-sm tabular-nums text-neutral-700">
                        {formatTime(record.check_in_at)} → {record.check_out_at ? formatTime(record.check_out_at) : "…"}
                        {record.check_out_at && (
                          <span className="ml-2 text-neutral-500">
                            ({formatDuration(minutesBetween(record.check_in_at, record.check_out_at))})
                          </span>
                        )}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <MethodBadge method={record.check_in_method} prefix="Vào" />
                        {record.check_out_method && <MethodBadge method={record.check_out_method} prefix="Ra" />}
                        {record.is_corrected && (
                          <span className="rounded-md bg-violet-50 px-2 py-0.5 text-xs text-violet-700" title={record.correction_note ?? ""}>
                            Đã sửa
                          </span>
                        )}
                        {recordForgotten && (
                          <span className="rounded-md bg-red-50 px-2 py-0.5 text-xs text-red-700">Quên ra ca</span>
                        )}
                        {isOpen && !recordForgotten && (
                          <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">Đang làm</span>
                        )}
                        {pendingRecordIds.has(record.id) && (
                          <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs text-amber-800">Chờ duyệt sửa</span>
                        )}
                      </div>
                    </div>
                    {canRequest && (
                      <RequestCorrectionButton
                        attendanceId={record.id}
                        checkInAt={record.check_in_at}
                        checkOutAt={record.check_out_at}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
