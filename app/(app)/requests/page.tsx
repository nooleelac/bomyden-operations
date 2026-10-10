import type { Metadata } from "next";
import Link from "next/link";
import { requireEmployee } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getRequestTime } from "@/lib/request-time";
import { vnDateString } from "@/lib/time";
import { addDays, hm, type MyRequest } from "@/lib/schedule";
import RequestsView from "./RequestsView";
import type { UpcomingShift } from "./RequestDialog";

export const metadata: Metadata = { title: "Đơn xin phép" };
export const instant = false;

/** Ca sắp tới trong bao nhiêu ngày được phép chọn khi gửi đơn */
const UPCOMING_DAYS = 28;

export default async function RequestsPage({ searchParams }: PageProps<"/requests">) {
  const me = await requireEmployee();
  const params = await searchParams;
  const supabase = await createClient();
  const now = getRequestTime();
  const today = vnDateString(new Date(now));

  const { data: myBranches } = await supabase
    .from("employee_branches")
    .select("branches!inner(id, name, is_active)")
    .eq("employee_id", me.id)
    .eq("branches.is_active", true);
  const branches = (myBranches ?? []).map((row) => ({ id: row.branches.id, name: row.branches.name }));
  const branchIds = branches.map((b) => b.id);

  const [requestsRes, upcomingRes, ...colleagueRes] = await Promise.all([
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
  if (requestsRes.error || upcomingRes.error) throw new Error("Không tải được đơn xin phép.");

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
      <h1 className="mb-4 mt-2 text-2xl font-bold tracking-tight">Đơn xin phép</h1>

      <RequestsView
        myId={me.id}
        today={today}
        hasBranch={branches.length > 0}
        autoOpen={params.new === "1"}
        requests={(requestsRes.data as MyRequest[] | null) ?? []}
        upcoming={upcoming}
        colleagues={colleagues}
      />
    </div>
  );
}
