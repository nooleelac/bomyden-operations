import type { Metadata } from "next";
import Link from "next/link";
import { requireEmployee } from "@/lib/auth/session";
import { canManageAttendance } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { getRequestTime } from "@/lib/request-time";
import { vnDateString } from "@/lib/time";
import { addDays, hm, isMonday, weekStartOf, type MyRequest, type WeekSchedule } from "@/lib/schedule";
import WeekNav from "./WeekNav";
import ScheduleView from "./ScheduleView";
import type { UpcomingShift } from "./RequestDialog";

export const metadata: Metadata = { title: "Lịch làm việc" };
export const instant = false;

/** Ca sắp tới trong bao nhiêu ngày được phép chọn khi gửi đơn */
const UPCOMING_DAYS = 28;

export default async function SchedulePage({ searchParams }: PageProps<"/schedule">) {
  const me = await requireEmployee();
  const params = await searchParams;
  const supabase = await createClient();
  const now = getRequestTime();
  const today = vnDateString(new Date(now));
  const currentWeek = weekStartOf(today);
  const weekStart = isMonday(params.week) ? params.week : currentWeek;

  const { data: myBranches } = await supabase
    .from("employee_branches")
    .select("branches!inner(id, name, is_active)")
    .eq("employee_id", me.id)
    .eq("branches.is_active", true);
  const branches = (myBranches ?? [])
    .map((row) => ({ id: row.branches.id, name: row.branches.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "vi"));
  const branchIds = branches.map((b) => b.id);
  const branchId = typeof params.branch === "string" && branchIds.includes(params.branch) ? params.branch : (branchIds[0] ?? "");

  const [weekRes, requestsRes, upcomingRes, ...colleagueRes] = await Promise.all([
    branchId ? supabase.rpc("branch_week_schedule", { p_branch_id: branchId, p_week_start: weekStart }) : Promise.resolve({ data: null, error: null }),
    supabase.rpc("my_schedule_requests"),
    branchIds.length
      ? supabase
          .from("shifts")
          .select("id, branch_id, employee_id, work_date, start_time, end_time")
          .in("branch_id", branchIds)
          .eq("status", "published")
          .gt("start_at", new Date(now).toISOString())
          .lte("work_date", addDays(today, UPCOMING_DAYS))
          .order("start_at")
      : Promise.resolve({ data: [], error: null }),
    ...branchIds.map((id) => supabase.rpc("branch_colleagues", { p_branch_id: id })),
  ]);
  if (weekRes.error || requestsRes.error || upcomingRes.error) throw new Error("Không tải được lịch làm việc.");

  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const upcoming: UpcomingShift[] = (upcomingRes.data ?? []).map((s) => ({
    id: s.id,
    branchId: s.branch_id,
    branchName: branchName.get(s.branch_id) ?? "",
    employeeId: s.employee_id,
    workDate: s.work_date,
    startTime: hm(s.start_time),
    endTime: hm(s.end_time),
  }));
  const colleagues = Object.fromEntries(
    branchIds.map((id, i) => [id, (colleagueRes[i]?.data ?? []).map((c) => ({ id: c.id, name: c.full_name }))])
  );

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">← Trang chủ</Link>
      <div className="mb-4 mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Lịch làm việc</h1>
        {canManageAttendance(me.role) && (
          <Link href="/schedule/manage" className="btn-secondary">Xếp lịch & duyệt đơn</Link>
        )}
      </div>

      {branches.length > 0 && <WeekNav weekStart={weekStart} currentWeek={currentWeek} branches={branches} branchId={branchId} />}

      <ScheduleView
        myId={me.id}
        today={today}
        weekStart={weekStart}
        data={(weekRes.data as WeekSchedule | null) ?? null}
        requests={(requestsRes.data as MyRequest[] | null) ?? []}
        upcoming={upcoming}
        colleagues={colleagues}
      />
    </div>
  );
}
