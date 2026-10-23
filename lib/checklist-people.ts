import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { vnDayRange } from "@/lib/time";

/**
 * Ai nghỉ phép (đơn đã duyệt) / ai đã chấm công trong ngày — để biết người phụ trách thực tế của checklist
 * (xem taskAssignee trong lib/checklist.ts). Đọc bằng quyền server, chỉ cho các nhân viên được hỏi.
 */
export async function loadChecklistPeople(date: string, employeeIds: (string | null)[]) {
  const ids = [...new Set(employeeIds.filter(Boolean) as string[])];
  if (ids.length === 0) return { onLeave: new Set<string>(), checkedIn: new Set<string>() };

  const admin = createAdminClient();
  const range = vnDayRange(date);
  const [leaves, checkIns] = await Promise.all([
    admin
      .from("schedule_requests")
      .select("employee_id")
      .eq("kind", "leave")
      .eq("status", "approved")
      .lte("start_date", date)
      .gte("end_date", date)
      .in("employee_id", ids),
    admin
      .from("attendance_records")
      .select("employee_id")
      .in("employee_id", ids)
      .gte("check_in_at", range.start)
      .lt("check_in_at", range.end),
  ]);
  if (leaves.error || checkIns.error) throw new Error("Không tải được tình trạng nghỉ phép / chấm công.");

  return {
    onLeave: new Set(leaves.data.map((l) => l.employee_id)),
    checkedIn: new Set(checkIns.data.map((c) => c.employee_id)),
  };
}
