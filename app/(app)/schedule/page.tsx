import type { Metadata } from "next";
import Link from "next/link";
import { requireEmployee } from "@/lib/auth/session";
import { canManageAttendance } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { getRequestTime } from "@/lib/request-time";
import { vnDateString } from "@/lib/time";
import { isMonday, weekStartOf, type WeekSchedule } from "@/lib/schedule";
import WeekNav from "./WeekNav";
import ScheduleView from "./ScheduleView";

export const metadata: Metadata = { title: "Lịch làm việc" };
export const instant = false;

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

  const weekRes = branchId
    ? await supabase.rpc("branch_week_schedule", { p_branch_id: branchId, p_week_start: weekStart })
    : { data: null, error: null };
  if (weekRes.error) throw new Error("Không tải được lịch làm việc.");

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">← Trang chủ</Link>
      <div className="mb-4 mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Lịch làm việc</h1>
        <div className="flex flex-wrap gap-2">
          {me.self_schedule && <Link href="/schedule/register" className="btn-primary">Đăng ký ca</Link>}
          {canManageAttendance(me.role) && (
            <Link href="/schedule/manage" className="btn-secondary">Xếp lịch & duyệt đơn</Link>
          )}
        </div>
      </div>

      {branches.length > 0 && <WeekNav weekStart={weekStart} currentWeek={currentWeek} branches={branches} branchId={branchId} />}

      <ScheduleView myId={me.id} today={today} weekStart={weekStart} data={(weekRes.data as WeekSchedule | null) ?? null} />
    </div>
  );
}
