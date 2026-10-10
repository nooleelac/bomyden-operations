import type { Metadata } from "next";
import Link from "next/link";
import { requireManager } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getManageableBranches } from "@/lib/branches";
import { getRequestTime } from "@/lib/request-time";
import { isValidDateString, vnDateString, vnDayRange } from "@/lib/time";
import { displayStatus, shiftCoversTask } from "@/lib/checklist";
import { signTaskPhotos } from "@/lib/task-photos";
import ManageChecklistView, { type ReportItem } from "./ManageChecklistView";
import HistoryFilters from "@/components/HistoryFilters";
import type { BranchStaff, TaskSetItem, TemplateItem } from "./TemplateDialog";

export const metadata: Metadata = { title: "Quản lý checklist" };
export const instant = false;

/** Báo cáo xem tối đa 31 ngày một lần */
const MAX_RANGE_DAYS = 31;

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const REPORT_COLUMNS =
  "id, task_date, branch_id, by_shift, title, category, start_at, due_at, status, completed_at, completed_by, note, photo_path, photo_purged_at, primary_employee_id, backup_employee_id, is_urgent, urgent_resolved_at, branch:branches(name), resolver:employees!task_instances_urgent_resolved_by_fkey(full_name), primary:employees!task_instances_primary_employee_id_fkey(full_name), backup:employees!task_instances_backup_employee_id_fkey(full_name), completer:employees!task_instances_completed_by_fkey(full_name)";

export default async function ManageChecklistPage({ searchParams }: PageProps<"/checklist/manage">) {
  const actor = await requireManager();
  const params = await searchParams;
  const branches = await getManageableBranches(actor);
  const branchIds = branches.map((b) => b.id);

  const tab = params.tab === "templates" ? "templates" : "report";
  const branchId = typeof params.branch === "string" && branchIds.includes(params.branch) ? params.branch : "";
  const now = getRequestTime();
  const today = vnDateString(new Date(now));
  // Khoảng ngày: ?from=&to= (link cũ / thông báo dùng ?date= = 1 ngày)
  const single = isValidDateString(params.date) ? params.date : null;
  let from = isValidDateString(params.from) ? params.from : single ?? today;
  // Bộ lọc bỏ "to" khỏi link khi = hôm nay → thiếu "to" nghĩa là đến hôm nay
  let to = isValidDateString(params.to) ? params.to : single ?? today;
  if (to > today) to = today;
  if (from > to) from = to;
  if (from < addDays(to, -(MAX_RANGE_DAYS - 1))) from = addDays(to, -(MAX_RANGE_DAYS - 1));
  const scope = branchId ? [branchId] : branchIds;
  const urgentOnly = params.urgent === "1";

  const supabase = await createClient();
  if (to === today) await supabase.rpc("ensure_task_instances");

  const rangeStart = vnDayRange(from).start;
  const rangeEnd = vnDayRange(to).end;

  // Nhiều ngày × nhiều việc có thể vượt 1000 dòng/lần đọc của Supabase → đọc theo trang
  const pageSize = 1000;
  const fetchPage = (offset: number) =>
    supabase
      .from("task_instances")
      .select(REPORT_COLUMNS)
      .gte("task_date", from)
      .lte("task_date", to)
      .neq("status", "cancelled")
      .in("branch_id", scope)
      .order("task_date", { ascending: false })
      .order("due_at")
      .order("id")
      .range(offset, offset + pageSize - 1);
  type ReportRow = NonNullable<Awaited<ReturnType<typeof fetchPage>>["data"]>[number];
  const loadReport = async () => {
    const rows: ReportRow[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await fetchPage(offset);
      if (error) return { data: null, error };
      rows.push(...data);
      if (data.length < pageSize) return { data: rows, error: null };
    }
  };

  const [reportRes, templatesRes, staffRes, shiftsRes, setsRes] = await Promise.all([
    tab === "report" ? loadReport() : Promise.resolve({ data: [], error: null }),
    supabase
      .from("task_templates")
      .select(
        "id, branch_id, title, description, category, priority, start_time, due_time, frequency, weekdays, month_days, requires_photo, requires_note, assign_by_shift, set_id, primary_employee_id, backup_employee_id, is_active, sort_order, branch:branches(name), primary:employees!task_templates_primary_employee_id_fkey(full_name), backup:employees!task_templates_backup_employee_id_fkey(full_name)"
      )
      .in("branch_id", scope)
      .is("deleted_at", null)
      .order("is_active", { ascending: false })
      .order("sort_order")
      .order("start_time"),
    supabase
      .from("employee_branches")
      .select("branch_id, employee:employees!employee_branches_employee_id_fkey!inner(id, full_name, is_active)")
      .in("branch_id", branchIds)
      .eq("employee.is_active", true),
    // Ca đã công bố trong khoảng ngày → biết ai nhận việc "giao theo ca"
    supabase
      .from("shifts")
      .select("branch_id, start_at, end_at, employee:employees!shifts_employee_id_fkey(id, full_name, is_active)")
      .eq("status", "published")
      .in("branch_id", scope)
      .lt("start_at", rangeEnd)
      .gt("end_at", rangeStart),
    supabase.from("task_sets").select("id, branch_id, name, branch:branches(name)").in("branch_id", scope).order("name"),
  ]);

  if (reportRes.error || templatesRes.error || staffRes.error || shiftsRes.error || setsRes.error) {
    throw new Error("Không tải được dữ liệu checklist.");
  }

  const photoUrls = await signTaskPhotos(reportRes.data.map((r) => (r.photo_purged_at ? null : r.photo_path)));

  const shiftEmployeesOf = (r: { branch_id: string; start_at: string; due_at: string }) =>
    shiftsRes.data.filter((s) => s.employee?.is_active && shiftCoversTask(s, r)).map((s) => s.employee!);
  const shiftStaffOf = (r: { branch_id: string; start_at: string; due_at: string }) => [...new Set(shiftEmployeesOf(r).map((e) => e.full_name))];

  // Nhân viên để lọc báo cáo: người thuộc chi nhánh đang xem
  const staffOptions = [
    ...new Map(
      staffRes.data
        .filter((row) => row.employee && scope.includes(row.branch_id))
        .map((row) => [row.employee.id, { id: row.employee.id, name: row.employee.full_name }] as const)
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name, "vi"));
  // ?emp=id1,id2 → nhiều nhân viên
  const staffIds = new Set(staffOptions.map((s) => s.id));
  const employeeIds = (typeof params.emp === "string" ? params.emp.split(",") : []).filter((id) => staffIds.has(id));
  const picked = new Set(employeeIds);
  // Việc liên quan tới nhân viên: người chính / người thay / người đánh dấu / có ca trùng giờ (việc theo ca)
  const involves = (r: ReportRow) =>
    picked.size === 0 ||
    (r.primary_employee_id !== null && picked.has(r.primary_employee_id)) ||
    (r.backup_employee_id !== null && picked.has(r.backup_employee_id)) ||
    (r.completed_by !== null && picked.has(r.completed_by)) ||
    (r.by_shift && shiftEmployeesOf(r).some((e) => picked.has(e.id)));

  const report: ReportItem[] = (reportRes.data as ReportRow[]).filter(involves).map((r) => ({
    id: r.id,
    taskDate: r.task_date,
    byShift: r.by_shift,
    shiftStaff: r.by_shift ? shiftStaffOf(r) : [],
    title: r.title,
    category: r.category,
    branchName: r.branch?.name ?? "",
    startAt: r.start_at,
    dueAt: r.due_at,
    displayStatus: displayStatus(r, now),
    primaryName: r.primary?.full_name ?? "—",
    backupName: r.backup?.full_name ?? null,
    completedByName: r.completer?.full_name ?? null,
    completedAt: r.completed_at,
    note: r.note,
    photoUrl: r.photo_path && !r.photo_purged_at ? photoUrls.get(r.photo_path) ?? null : null,
    photoPurged: Boolean(r.photo_purged_at),
    canReopen: r.task_date === today && (r.status === "done" || r.status === "failed"),
    isUrgent: r.is_urgent,
    urgentResolvedAt: r.urgent_resolved_at,
    urgentResolvedByName: r.resolver?.full_name ?? null,
  }));

  const templates: TemplateItem[] = templatesRes.data.map((t) => ({
    id: t.id,
    branchId: t.branch_id,
    branchName: t.branch?.name ?? "",
    title: t.title,
    description: t.description,
    category: t.category,
    priority: t.priority,
    startTime: t.start_time.slice(0, 5),
    dueTime: t.due_time.slice(0, 5),
    frequency: t.frequency,
    weekdays: t.weekdays,
    monthDays: t.month_days,
    requiresPhoto: t.requires_photo,
    requiresNote: t.requires_note,
    assignByShift: t.assign_by_shift,
    setId: t.set_id,
    primaryId: t.primary_employee_id,
    primaryName: t.primary?.full_name ?? null,
    backupId: t.backup_employee_id,
    backupName: t.backup?.full_name ?? null,
    isActive: t.is_active,
    sortOrder: t.sort_order,
  }));

  const sets: TaskSetItem[] = setsRes.data.map((s) => ({ id: s.id, branchId: s.branch_id, branchName: s.branch?.name ?? "", name: s.name }));

  const branchStaff: BranchStaff[] = branches.map((b) => ({
    id: b.id,
    name: b.name,
    staff: staffRes.data
      .filter((row) => row.branch_id === b.id && row.employee)
      .map((row) => ({ id: row.employee.id, name: row.employee.full_name }))
      .sort((x, y) => x.name.localeCompare(y.name, "vi")),
  }));

  const fmt = (s: string) => s.split("-").reverse().join("/");
  const dateLabel = from === to ? (from === today ? "hôm nay" : `ngày ${fmt(from)}`) : `từ ${fmt(from)} đến ${fmt(to)}`;
  // Tham số lọc hiện tại (giữ khi chuyển tab / bật lọc việc gấp)
  const filters: Record<string, string> = {
    ...(branchId && { branch: branchId }),
    ...(employeeIds.length > 0 && { emp: employeeIds.join(",") }),
    ...(from !== today && { from }),
    ...(to !== today && { to }),
  };
  const query = (next: Record<string, string>) => "?" + new URLSearchParams({ ...filters, ...next }).toString();

  return (
    <div>
      <Link href="/checklist" className="text-sm text-neutral-500 hover:text-neutral-900">← Checklist</Link>
      <h1 className="mb-4 mt-2 text-2xl font-bold tracking-tight">Quản lý checklist</h1>

      {branches.length === 0 ? (
        <div className="card p-6 text-center text-sm text-neutral-500">
          {actor.role === "admin" ? "Chưa có chi nhánh nào. Hãy tạo chi nhánh trước." : "Bạn chưa được gán chi nhánh nào."}
        </div>
      ) : (
        <>
          <div className="mb-4 inline-flex rounded-lg border border-neutral-200 bg-white p-1 text-sm">
            <Link href={query({ tab: "report" })} className={`rounded-md px-3 py-1.5 font-medium ${tab === "report" ? "bg-brand text-brand-fg" : "text-neutral-600"}`}>
              Báo cáo
            </Link>
            <Link href={query({ tab: "templates" })} className={`rounded-md px-3 py-1.5 font-medium ${tab === "templates" ? "bg-brand text-brand-fg" : "text-neutral-600"}`}>
              Mẫu công việc
            </Link>
          </div>

          <HistoryFilters
            mode={tab === "report" ? "full" : "branchOnly"}
            branches={branches.map((b) => ({ id: b.id, name: b.name }))}
            staff={staffOptions}
            branchId={branchId}
            employeeIds={employeeIds}
            from={from}
            to={to}
            today={today}
            maxDays={MAX_RANGE_DAYS}
            query={{ ...filters, ...(tab !== "report" && { tab }), ...(urgentOnly && { urgent: "1" }) }}
          />

          <ManageChecklistView tab={tab} report={report} urgentOnly={urgentOnly} urgentHref={query({ urgent: "1" })} allHref={query({})} multiDay={from !== to} templates={templates} sets={sets} branches={branchStaff} dateLabel={dateLabel} />
        </>
      )}
    </div>
  );
}
