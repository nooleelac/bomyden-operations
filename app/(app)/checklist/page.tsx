import type { Metadata } from "next";
import Link from "next/link";
import { requireEmployee } from "@/lib/auth/session";
import { canManageAttendance, mustClockIn } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRequestTime } from "@/lib/request-time";
import { vnDateString, vnDayRange } from "@/lib/time";
import { displayStatus, shiftCoversTask, taskAssignee } from "@/lib/checklist";
import { loadChecklistPeople } from "@/lib/checklist-people";
import { signTaskPhotos } from "@/lib/task-photos";
import ChecklistView from "./ChecklistView";
import type { TaskCardData } from "./TaskCard";

export const metadata: Metadata = { title: "Checklist" };
export const instant = false;

export default async function ChecklistPage() {
  const me = await requireEmployee();
  const supabase = await createClient();
  const now = getRequestTime();
  const today = vnDateString(new Date(now));

  // Việc hôm nay do cron sinh sẵn (bomyden-ensure-tasks, mỗi 10 phút) và ngay khi sửa mẫu
  const range = vnDayRange(today);
  const [{ data: allTasks, error }, { data: openShift }, { data: myShifts }] = await Promise.all([
    supabase
      .from("task_instances")
      .select(
        "id, branch_id, title, description, category, priority, start_at, due_at, requires_photo, requires_note, status, completed_by, completed_at, note, photo_path, reopen_reason, is_urgent, urgent_resolved_at, by_shift, primary_employee_id, backup_employee_id, branch:branches(name)"
      )
      .eq("task_date", today)
      .neq("status", "cancelled")
      .or(`primary_employee_id.eq.${me.id},backup_employee_id.eq.${me.id},by_shift.eq.true`)
      .order("due_at"),
    supabase.from("attendance_records").select("branch_id").eq("employee_id", me.id).is("check_out_at", null).maybeSingle(),
    // Ca đã công bố của tôi hôm nay → việc "giao theo ca" trùng giờ ca
    supabase
      .from("shifts")
      .select("branch_id, start_at, end_at")
      .eq("employee_id", me.id)
      .eq("status", "published")
      .lt("start_at", range.end)
      .gt("end_at", range.start),
  ]);

  if (error) throw new Error("Không tải được checklist.");

  // Ai nghỉ phép / đã chấm công hôm nay → người phụ trách thực tế của việc giao đích danh
  const people = await loadChecklistPeople(
    today,
    [me.id, ...allTasks.flatMap((t) => (t.by_shift ? [] : [t.primary_employee_id, t.backup_employee_id]))]
  );
  const meOnLeave = people.onLeave.has(me.id);

  // Quản lý đọc được mọi việc theo ca của chi nhánh → chỉ giữ việc trùng ca của chính mình (nghỉ phép → không nhận việc của ca)
  const tasks = allTasks.filter((t) => !t.by_shift || (!meOnLeave && (myShifts ?? []).some((s) => shiftCoversTask(s, t))));
  const assignee = new Map(tasks.map((t) => [t.id, t.by_shift ? null : taskAssignee(t, people)]));

  // Tên đồng nghiệp (đọc bằng quyền server, chỉ cho các việc của chính mình)
  const admin = createAdminClient();
  const peopleIds = [...new Set(tasks.flatMap((t) => [t.primary_employee_id, t.completed_by]).filter(Boolean) as string[])];

  const [{ data: employees }, photoUrls] = await Promise.all([
    peopleIds.length
      ? admin.from("employees").select("id, full_name").in("id", peopleIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    signTaskPhotos(tasks.map((t) => t.photo_path)),
  ]);

  const names = new Map((employees ?? []).map((p) => [p.id, p.full_name]));
  const needsShift = mustClockIn(me);

  const cards: TaskCardData[] = tasks.map((t) => {
    const role = t.by_shift ? "shift" : t.primary_employee_id === me.id ? "primary" : "backup";
    let blockedReason: string | null = null;
    if (role === "backup" && assignee.get(t.id) !== me.id) {
      blockedReason = `${names.get(t.primary_employee_id!) ?? "Người phụ trách chính"} đã đi làm hôm nay nên sẽ làm việc này.`;
    } else if (needsShift && openShift?.branch_id !== t.branch_id) {
      blockedReason = `Vào ca tại ${t.branch?.name ?? "chi nhánh"} để đánh dấu việc này.`;
    }
    return {
      id: t.id,
      title: t.title,
      description: t.description,
      category: t.category,
      priority: t.priority,
      startAt: t.start_at,
      dueAt: t.due_at,
      requiresPhoto: t.requires_photo,
      requiresNote: t.requires_note,
      displayStatus: displayStatus(t, now),
      completedByName: t.completed_by ? names.get(t.completed_by) ?? null : null,
      completedAt: t.completed_at,
      note: t.note,
      photoUrl: t.photo_path ? photoUrls.get(t.photo_path) ?? null : null,
      reopenReason: t.reopen_reason,
      isUrgent: t.is_urgent,
      urgentResolved: Boolean(t.urgent_resolved_at),
      role,
      primaryName: t.primary_employee_id
        ? `${names.get(t.primary_employee_id) ?? ""}${people.onLeave.has(t.primary_employee_id) ? " (nghỉ phép)" : ""}`
        : "",
      blockedReason,
    };
  });

  // Việc của tôi: việc mình là người chính (trừ ngày mình nghỉ phép — đã chuyển cho người thay) + việc của ca mình
  const mine = cards.filter((c) => c.role === "shift" || (c.role === "primary" && (!meOnLeave || c.completedAt)));
  // Việc làm thay: khi người chính nghỉ / chưa đi làm, hoặc khi chính mình đã làm — tính như việc chính của mình
  const covering = cards.filter((c) => c.role === "backup" && (assignee.get(c.id) === me.id || c.completedAt));
  const handedOver = cards.filter((c) => c.role === "primary" && !mine.includes(c)).length;

  const counted = [...mine, ...covering];
  const total = counted.length;
  const finished = counted.filter((c) => ["done", "late", "failed"].includes(c.displayStatus)).length;

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">← Trang chủ</Link>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Checklist hôm nay</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {total > 0 ? `Đã xong ${finished}/${total} việc của bạn` : "Hôm nay bạn không có việc nào."}
          </p>
        </div>
        {canManageAttendance(me.role) && (
          <Link href="/checklist/manage" className="btn-secondary px-3 py-2 text-xs">Quản lý checklist</Link>
        )}
      </div>

      {total > 0 && (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-neutral-200">
          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${(finished / total) * 100}%` }} />
        </div>
      )}

      {meOnLeave && (
        <p className="alert-info mt-4">
          Hôm nay bạn nghỉ phép
          {handedOver > 0 ? ` — ${handedOver} việc của bạn đã chuyển cho người làm thay` : ""}. Bạn không bị tính phạt checklist hôm nay.
        </p>
      )}

      {needsShift && !openShift && counted.some((c) => !c.completedAt) && (
        <p className="alert-info mt-4">
          Bạn chưa vào ca. <Link href="/attendance" className="font-semibold underline">Vào ca</Link> để đánh dấu công việc.
        </p>
      )}

      <ChecklistView mine={mine} covering={covering} />
    </div>
  );
}
