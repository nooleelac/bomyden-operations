import type { Metadata } from "next";
import Link from "next/link";
import { requireManager } from "@/lib/auth/session";
import { mustClockIn } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { getManageableBranches } from "@/lib/branches";
import { isForgotten, isValidDateString, vnDateString, vnDayRange } from "@/lib/time";
import { getRequestTime } from "@/lib/request-time";
import ManageView, { type PendingItem, type RecordItem } from "./ManageView";
import type { StaffOption } from "./ManageDialogs";

export const metadata: Metadata = { title: "Quản lý chấm công" };
export const instant = false;

const RECORD_FIELDS =
  "id, employee_id, check_in_at, check_out_at, check_in_method, check_out_method, is_corrected, correction_note, branch_id, employee:employees!attendance_records_employee_id_fkey(full_name), branch:branches(name)";

export default async function ManageAttendancePage({ searchParams }: PageProps<"/attendance/manage">) {
  const actor = await requireManager();
  const params = await searchParams;
  const branches = await getManageableBranches(actor);

  const branchId =
    typeof params.branch === "string" && branches.some((b) => b.id === params.branch) ? params.branch : "";
  const today = vnDateString();
  const date = isValidDateString(params.date) ? params.date : today;
  const range = vnDayRange(date);

  const supabase = await createClient();

  // RLS tự giới hạn theo chi nhánh người thao tác quản lý
  let pendingQuery = supabase
    .from("attendance_corrections")
    .select(
      "id, employee_id, requested_check_in_at, requested_check_out_at, reason, created_at, employee:employees!attendance_corrections_employee_id_fkey(full_name), branch:branches(name), record:attendance_records(check_in_at, check_out_at)"
    )
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  let openQuery = supabase.from("attendance_records").select(RECORD_FIELDS).is("check_out_at", null).order("check_in_at");
  let dayQuery = supabase
    .from("attendance_records")
    .select(RECORD_FIELDS)
    .gte("check_in_at", range.start)
    .lt("check_in_at", range.end)
    .order("check_in_at");
  let staffQuery = supabase
    .from("employee_branches")
    .select("branch_id, employee:employees!employee_branches_employee_id_fkey!inner(id, full_name, is_active, role, requires_attendance), branch:branches!inner(id, name, is_active)")
    .eq("employee.is_active", true)
    .eq("branch.is_active", true);

  if (branchId) {
    pendingQuery = pendingQuery.eq("branch_id", branchId);
    openQuery = openQuery.eq("branch_id", branchId);
    dayQuery = dayQuery.eq("branch_id", branchId);
    staffQuery = staffQuery.eq("branch_id", branchId);
  }

  const [pendingRes, openRes, dayRes, staffRes] = await Promise.all([pendingQuery, openQuery, dayQuery, staffQuery]);
  if (pendingRes.error || openRes.error || dayRes.error || staffRes.error) {
    throw new Error("Không tải được dữ liệu chấm công.");
  }

  const now = getRequestTime();
  const manageable = new Set(branches.map((b) => b.id));

  const toRecord = (r: NonNullable<typeof openRes.data>[number]): RecordItem => ({
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

  const pending: PendingItem[] = pendingRes.data.map((c) => ({
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

  // Nhân viên có thể thêm ca thủ công: phải chấm công, không phải chính mình, chi nhánh trong phạm vi
  const staffMap = new Map<string, StaffOption>();
  for (const row of staffRes.data) {
    if (!row.employee || !row.branch || !manageable.has(row.branch.id)) continue;
    if (row.employee.id === actor.id || !mustClockIn(row.employee)) continue;
    const item = staffMap.get(row.employee.id) ?? { id: row.employee.id, name: row.employee.full_name, branches: [] };
    item.branches.push({ id: row.branch.id, name: row.branch.name });
    staffMap.set(row.employee.id, item);
  }
  const staff = [...staffMap.values()].sort((a, b) => a.name.localeCompare(b.name, "vi"));

  const [y, m, d] = date.split("-");
  const dateLabel = date === today ? "hôm nay" : `ngày ${d}/${m}/${y}`;

  return (
    <div>
      <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">← Trang chủ</Link>
      <div className="mb-5 mt-2">
        <h1 className="text-2xl font-bold tracking-tight">Quản lý chấm công</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {actor.role === "admin" ? "Tất cả chi nhánh." : "Chi nhánh bạn quản lý."} Mọi lần sửa đều được ghi lại kèm lý do.
        </p>
      </div>

      {branches.length === 0 ? (
        <div className="card p-6 text-center text-sm text-neutral-500">
          {actor.role === "admin"
            ? "Chưa có chi nhánh nào. Hãy tạo chi nhánh trước."
            : "Bạn chưa được gán chi nhánh nào. Liên hệ Quản trị viên."}
        </div>
      ) : (
        <>
          <form method="get" className="card mb-6 flex flex-wrap items-end gap-3 p-4">
            <div className="min-w-40 flex-1">
              <label htmlFor="f-branch" className="mb-1 block text-xs font-medium text-neutral-600">Chi nhánh</label>
              <select id="f-branch" name="branch" defaultValue={branchId} className="input">
                <option value="">Tất cả{actor.role === "manager" ? " (của tôi)" : ""}</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div className="min-w-40 flex-1">
              <label htmlFor="f-date" className="mb-1 block text-xs font-medium text-neutral-600">Ngày</label>
              <input id="f-date" name="date" type="date" defaultValue={date} max={today} className="input" />
            </div>
            <button type="submit" className="btn-primary">Xem</button>
          </form>

          <ManageView
            pending={pending}
            openShifts={openRes.data.map(toRecord)}
            dayRecords={dayRes.data.map(toRecord)}
            staff={staff}
            dateLabel={dateLabel}
          />
        </>
      )}
    </div>
  );
}
