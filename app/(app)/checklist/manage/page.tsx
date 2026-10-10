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
import ReportFilters from "./ReportFilters";
import type { BranchStaff, TaskSetItem, TemplateItem } from "./TemplateDialog";

export const metadata: Metadata = { title: "Quản lý checklist" };
export const instant = false;

export default async function ManageChecklistPage({ searchParams }: PageProps<"/checklist/manage">) {
  const actor = await requireManager();
  const params = await searchParams;
  const branches = await getManageableBranches(actor);
  const branchIds = branches.map((b) => b.id);

  const tab = params.tab === "templates" ? "templates" : "report";
  const branchId = typeof params.branch === "string" && branchIds.includes(params.branch) ? params.branch : "";
  const now = getRequestTime();
  const today = vnDateString(new Date(now));
  const date = isValidDateString(params.date) ? params.date : today;
  const scope = branchId ? [branchId] : branchIds;
  const urgentOnly = params.urgent === "1";

  const supabase = await createClient();
  if (date === today) await supabase.rpc("ensure_task_instances");

  const dayRange = vnDayRange(date);
  const [reportRes, templatesRes, staffRes, shiftsRes, setsRes] = await Promise.all([
    supabase
      .from("task_instances")
      .select(
        "id, branch_id, by_shift, title, category, start_at, due_at, status, completed_at, completed_by, note, photo_path, photo_purged_at, primary_employee_id, backup_employee_id, is_urgent, urgent_resolved_at, branch:branches(name), resolver:employees!task_instances_urgent_resolved_by_fkey(full_name), primary:employees!task_instances_primary_employee_id_fkey(full_name), backup:employees!task_instances_backup_employee_id_fkey(full_name), completer:employees!task_instances_completed_by_fkey(full_name)"
      )
      .eq("task_date", date)
      .neq("status", "cancelled")
      .in("branch_id", scope)
      .order("due_at"),
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
    // Ca đã công bố trong ngày → biết ai nhận việc "giao theo ca"
    supabase
      .from("shifts")
      .select("branch_id, start_at, end_at, employee:employees!shifts_employee_id_fkey(id, full_name, is_active)")
      .eq("status", "published")
      .in("branch_id", scope)
      .lt("start_at", dayRange.end)
      .gt("end_at", dayRange.start),
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
  const employeeId = typeof params.emp === "string" && staffOptions.some((s) => s.id === params.emp) ? params.emp : "";
  // Việc liên quan tới nhân viên: người chính / người thay / người đánh dấu / có ca trùng giờ (việc theo ca)
  const involves = (r: (typeof reportRes.data)[number]) =>
    !employeeId ||
    r.primary_employee_id === employeeId ||
    r.backup_employee_id === employeeId ||
    r.completed_by === employeeId ||
    (r.by_shift && shiftEmployeesOf(r).some((e) => e.id === employeeId));

  const report: ReportItem[] = reportRes.data.filter(involves).map((r) => ({
    id: r.id,
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
    canReopen: date === today && (r.status === "done" || r.status === "failed"),
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

  const [y, m, d] = date.split("-");
  const dateLabel = date === today ? "hôm nay" : `ngày ${d}/${m}/${y}`;
  const query = (next: Record<string, string>) =>
    "?" + new URLSearchParams({ ...(branchId && { branch: branchId }), ...(date !== today && { date }), ...next }).toString();

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

          <ReportFilters
            tab={tab}
            branches={branches.map((b) => ({ id: b.id, name: b.name }))}
            staff={staffOptions}
            branchId={branchId}
            employeeId={employeeId}
            date={date}
            today={today}
            query={{
              ...(tab !== "report" && { tab }),
              ...(branchId && { branch: branchId }),
              ...(employeeId && { emp: employeeId }),
              ...(date !== today && { date }),
              ...(urgentOnly && { urgent: "1" }),
            }}
          />

          <ManageChecklistView tab={tab} report={report} urgentOnly={urgentOnly} urgentHref={query({ ...(employeeId && { emp: employeeId }), urgent: "1" })} allHref={query({ ...(employeeId && { emp: employeeId }) })} templates={templates} sets={sets} branches={branchStaff} dateLabel={dateLabel} />
        </>
      )}
    </div>
  );
}
