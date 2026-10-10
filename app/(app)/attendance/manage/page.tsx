import type { Metadata } from "next";
import Link from "next/link";
import { requireManager } from "@/lib/auth/session";
import { mustClockIn } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { getManageableBranches } from "@/lib/branches";
import { isForgotten, isValidDateString, vnDateString, vnDayRange } from "@/lib/time";
import { getRequestTime } from "@/lib/request-time";
import { buildAttendanceReport, type ReportEmployee } from "@/lib/attendance-report";
import HistoryFilters from "@/components/HistoryFilters";
import ManageView, { type PendingItem, type RecordItem } from "./ManageView";
import type { StaffOption } from "./ManageDialogs";

export const metadata: Metadata = { title: "Quản lý chấm công" };
export const instant = false;

/** Lịch sử xem tối đa 31 ngày một lần */
const MAX_RANGE_DAYS = 31;

const RECORD_FIELDS =
  "id, employee_id, check_in_at, check_out_at, check_in_method, check_out_method, is_corrected, correction_note, branch_id, employee:employees!attendance_records_employee_id_fkey(full_name), branch:branches(name)";

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default async function ManageAttendancePage({ searchParams }: PageProps<"/attendance/manage">) {
  const actor = await requireManager();
  const params = await searchParams;
  const branches = await getManageableBranches(actor);
  const branchIds = branches.map((b) => b.id);

  const branchId = typeof params.branch === "string" && branchIds.includes(params.branch) ? params.branch : "";
  const now = getRequestTime();
  const today = vnDateString(new Date(now));
  // Khoảng ngày: ?from=&to= (link cũ dùng ?date= = 1 ngày)
  const single = isValidDateString(params.date) ? params.date : null;
  let from = isValidDateString(params.from) ? params.from : single ?? today;
  // Bộ lọc bỏ "to" khỏi link khi = hôm nay → thiếu "to" nghĩa là đến hôm nay
  let to = isValidDateString(params.to) ? params.to : single ?? today;
  if (to > today) to = today;
  if (from > to) from = to;
  if (from < addDays(to, -(MAX_RANGE_DAYS - 1))) from = addDays(to, -(MAX_RANGE_DAYS - 1));
  const scope = branchId ? [branchId] : branchIds;
  const rangeStart = vnDayRange(from).start;
  const rangeEnd = vnDayRange(to).end;

  const supabase = await createClient();

  // Nhiều ngày có thể vượt 1000 dòng/lần đọc của Supabase → đọc theo trang
  const pageSize = 1000;
  const fetchRecords = (offset: number) =>
    supabase
      .from("attendance_records")
      .select(RECORD_FIELDS)
      .in("branch_id", scope)
      .gte("check_in_at", rangeStart)
      .lt("check_in_at", rangeEnd)
      .order("check_in_at")
      .order("id")
      .range(offset, offset + pageSize - 1);
  type RecordRow = NonNullable<Awaited<ReturnType<typeof fetchRecords>>["data"]>[number];
  const loadRecords = async () => {
    const rows: RecordRow[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await fetchRecords(offset);
      if (error) return { data: null, error };
      rows.push(...data);
      if (data.length < pageSize) return { data: rows, error: null };
    }
  };

  // RLS tự giới hạn theo chi nhánh người thao tác quản lý
  const [pendingRes, openRes, rangeRes, staffRes, shiftsRes, leavesRes] = await Promise.all([
    supabase
      .from("attendance_corrections")
      .select(
        "id, employee_id, requested_check_in_at, requested_check_out_at, reason, created_at, employee:employees!attendance_corrections_employee_id_fkey(full_name), branch:branches(name), record:attendance_records(check_in_at, check_out_at)"
      )
      .eq("status", "pending")
      .in("branch_id", scope)
      .order("created_at", { ascending: true }),
    supabase.from("attendance_records").select(RECORD_FIELDS).is("check_out_at", null).in("branch_id", scope).order("check_in_at"),
    loadRecords(),
    supabase
      .from("employee_branches")
      .select(
        "branch_id, employee:employees!employee_branches_employee_id_fkey!inner(id, full_name, is_active, role, requires_attendance, default_start_time), branch:branches!inner(id, name, is_active)"
      )
      .eq("employee.is_active", true)
      .eq("branch.is_active", true)
      .in("branch_id", branchIds),
    supabase
      .from("shifts")
      .select("id, employee_id, work_date, start_at, end_at, start_time")
      .eq("status", "published")
      .in("branch_id", scope)
      .gte("work_date", from)
      .lte("work_date", to),
    supabase
      .from("schedule_requests")
      .select("employee_id, start_date, end_date")
      .eq("kind", "leave")
      .eq("status", "approved")
      .lte("start_date", to)
      .gte("end_date", from),
  ]);
  if (pendingRes.error || openRes.error || rangeRes.error || staffRes.error || shiftsRes.error || leavesRes.error) {
    throw new Error("Không tải được dữ liệu chấm công.");
  }
  const rangeRecords = rangeRes.data as RecordRow[];

  // Đơn xin trễ đã duyệt → mốc tính trễ là giờ đã xin
  const shiftIds = shiftsRes.data.map((s) => s.id);
  const { data: lateRequests } = shiftIds.length
    ? await supabase
        .from("schedule_requests")
        .select("shift_id, requested_time")
        .eq("kind", "late")
        .eq("status", "approved")
        .in("shift_id", shiftIds)
    : { data: [] };
  const lateTime = new Map((lateRequests ?? []).map((q) => [q.shift_id, q.requested_time]));

  const manageable = new Set(branchIds);
  const inScope = new Set(scope);

  // Nhân viên phải chấm công thuộc chi nhánh đang xem (lọc + báo cáo)
  const employeesMap = new Map<string, ReportEmployee>();
  // Nhân viên có thể thêm ca thủ công: phải chấm công, không phải chính mình, chi nhánh trong phạm vi
  const staffMap = new Map<string, StaffOption>();
  for (const row of staffRes.data) {
    if (!row.employee || !row.branch || !manageable.has(row.branch.id) || !mustClockIn(row.employee)) continue;
    if (inScope.has(row.branch.id) && !employeesMap.has(row.employee.id)) {
      employeesMap.set(row.employee.id, {
        id: row.employee.id,
        name: row.employee.full_name,
        mustClock: true,
        defaultStart: row.employee.default_start_time,
        grace: 5,
      });
    }
    if (row.employee.id === actor.id) continue;
    const item = staffMap.get(row.employee.id) ?? { id: row.employee.id, name: row.employee.full_name, branches: [] };
    item.branches.push({ id: row.branch.id, name: row.branch.name });
    staffMap.set(row.employee.id, item);
  }
  const staff = [...staffMap.values()].sort((a, b) => a.name.localeCompare(b.name, "vi"));

  // Số phút ân hạn đi trễ theo đúng cài đặt bảng lương
  if (employeesMap.size > 0) {
    const { data: graces } = await supabase.rpc("attendance_late_grace", { p_employee_ids: [...employeesMap.keys()] });
    for (const g of graces ?? []) {
      const emp = employeesMap.get(g.employee_id);
      if (emp) emp.grace = g.grace_minutes;
    }
  }
  const staffOptions = [...employeesMap.values()]
    .map((e) => ({ id: e.id, name: e.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "vi"));

  // ?emp=id1,id2 → nhiều nhân viên
  const employeeIds = (typeof params.emp === "string" ? params.emp.split(",") : []).filter((id) => employeesMap.has(id));
  const picked = new Set(employeeIds);
  const keep = (employeeId: string) => picked.size === 0 || picked.has(employeeId);

  const toRecord = (r: RecordRow): RecordItem => ({
    id: r.id,
    employeeId: r.employee_id,
    employeeName: r.employee?.full_name ?? "—",
    branchName: r.branch?.name ?? "—",
    checkIn: r.check_in_at,
    checkOut: r.check_out_at,
    inMethod: r.check_in_method,
    outMethod: r.check_out_method,
    isCorrected: r.is_corrected,
    correctionNote: r.correction_note,
    forgotten: isForgotten(r.check_in_at, r.check_out_at, now),
    isMine: r.employee_id === actor.id,
  });

  const pending: PendingItem[] = pendingRes.data
    .filter((c) => keep(c.employee_id))
    .map((c) => ({
      id: c.id,
      employeeName: c.employee?.full_name ?? "—",
      branchName: c.branch?.name ?? "—",
      recordCheckIn: c.record?.check_in_at ?? c.requested_check_in_at,
      recordCheckOut: c.record?.check_out_at ?? null,
      requestedIn: c.requested_check_in_at,
      requestedOut: c.requested_check_out_at,
      reason: c.reason,
      createdAt: c.created_at,
      isMine: c.employee_id === actor.id,
    }));

  // Lịch sử vẫn hiện lượt chấm công của người đã chuyển chi nhánh / đã nghỉ việc (không tính trễ)
  const reportEmployees = new Map(picked.size ? [...employeesMap].filter(([id]) => picked.has(id)) : employeesMap);
  for (const r of rangeRecords) {
    if (!reportEmployees.has(r.employee_id) && keep(r.employee_id)) {
      reportEmployees.set(r.employee_id, { id: r.employee_id, name: r.employee?.full_name ?? "—", mustClock: true, defaultStart: null, grace: 5 });
    }
  }

  const report = buildAttendanceReport({
    from,
    to,
    now,
    employees: reportEmployees,
    shifts: shiftsRes.data.map((s) => ({
      id: s.id,
      employeeId: s.employee_id,
      workDate: s.work_date,
      startAt: s.start_at,
      endAt: s.end_at,
      startTime: s.start_time,
      lateRequestTime: lateTime.get(s.id) ?? null,
    })),
    records: rangeRecords.filter((r) => keep(r.employee_id)).map(toRecord),
    leaves: leavesRes.data.map((l) => ({ employeeId: l.employee_id, startDate: l.start_date!, endDate: l.end_date! })),
  });

  const fmt = (s: string) => s.split("-").reverse().join("/");
  const rangeLabel = from === to ? (from === today ? "hôm nay" : `ngày ${fmt(from)}`) : `${fmt(from)} – ${fmt(to)}`;
  const filters: Record<string, string> = {
    ...(branchId && { branch: branchId }),
    ...(employeeIds.length > 0 && { emp: employeeIds.join(",") }),
    ...(from !== today && { from }),
    ...(to !== today && { to }),
  };

  return (
    <div>
      <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">← Trang chủ</Link>
      <div className="mb-4 mt-2 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Quản lý chấm công</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {actor.role === "admin" ? "Tất cả chi nhánh." : "Chi nhánh bạn quản lý."} Mọi lần sửa đều được ghi lại kèm lý do.
          </p>
        </div>
        {branches.length > 0 && (
          <a
            href={`/attendance/manage/export?month=${to.slice(0, 7)}${branchId ? `&branch=${branchId}` : ""}`}
            className="btn-secondary"
            download
          >
            ⬇ Excel tháng {to.slice(5, 7)}/{to.slice(0, 4)}
          </a>
        )}
      </div>

      {branches.length === 0 ? (
        <div className="card p-6 text-center text-sm text-neutral-500">
          {actor.role === "admin"
            ? "Chưa có chi nhánh nào. Hãy tạo chi nhánh trước."
            : "Bạn chưa được gán chi nhánh nào. Liên hệ Quản trị viên."}
        </div>
      ) : (
        <>
          <HistoryFilters
            mode="full"
            branches={branches.map((b) => ({ id: b.id, name: b.name }))}
            staff={staffOptions}
            branchId={branchId}
            employeeIds={employeeIds}
            from={from}
            to={to}
            today={today}
            maxDays={MAX_RANGE_DAYS}
            query={filters}
          />

          <ManageView
            pending={pending}
            openShifts={openRes.data.filter((r) => keep(r.employee_id)).map(toRecord)}
            report={report}
            staff={staff}
            rangeLabel={rangeLabel}
            includesToday={to === today}
            multiDay={from !== to}
          />
        </>
      )}
    </div>
  );
}
