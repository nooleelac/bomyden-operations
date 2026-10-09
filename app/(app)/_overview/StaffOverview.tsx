import Link from "next/link";
import type { CurrentEmployee } from "@/lib/auth/session";
import { mustClockIn } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { getRequestTime } from "@/lib/request-time";
import { formatDuration, formatTime, isForgotten, minutesBetween } from "@/lib/time";
import { addDays, dayLabel, hm } from "@/lib/schedule";
import { DISPLAY_STATUS, displayStatus } from "@/lib/checklist";
import { ActionList, Badge, SectionCard, StatTile, type ActionItem, type Tone } from "./ui";

const UPCOMING_DAYS = 14;

/** Tổng quan cá nhân: ca hôm nay, trạng thái chấm công, việc của tôi, đơn đang chờ. */
export default async function StaffOverview({ me, today, compact = false }: { me: CurrentEmployee; today: string; compact?: boolean }) {
  const now = getRequestTime();
  const needsClock = mustClockIn(me);
  const supabase = await createClient();

  await supabase.rpc("ensure_task_instances");

  const [shiftsRes, openRes, tasksRes, peerRes, myRequestsRes] = await Promise.all([
    supabase
      .from("shifts")
      .select("id, work_date, start_time, end_time, start_at, end_at, branch:branches(name)")
      .eq("employee_id", me.id)
      .eq("status", "published")
      .gte("work_date", today)
      .lte("work_date", addDays(today, UPCOMING_DAYS))
      .order("start_at")
      .limit(8),
    supabase
      .from("attendance_records")
      .select("check_in_at, branch:branches(name)")
      .eq("employee_id", me.id)
      .is("check_out_at", null)
      .maybeSingle(),
    supabase
      .from("task_instances")
      .select("id, title, status, start_at, due_at, completed_at, primary_employee_id")
      .eq("task_date", today)
      .neq("status", "cancelled")
      .or(`primary_employee_id.eq.${me.id},backup_employee_id.eq.${me.id}`)
      .order("due_at"),
    supabase
      .from("schedule_requests")
      .select("id", { count: "exact", head: true })
      .eq("target_employee_id", me.id)
      .eq("status", "awaiting_peer"),
    supabase
      .from("schedule_requests")
      .select("id", { count: "exact", head: true })
      .eq("employee_id", me.id)
      .in("status", ["pending", "awaiting_peer"]),
  ]);

  const shifts = shiftsRes.data ?? [];
  const todayShifts = shifts.filter((s) => s.work_date === today && new Date(s.end_at).getTime() > now - 60 * 60 * 1000);
  const upcoming = shifts.filter((s) => s.work_date > today).slice(0, 4);
  const open = openRes.data;
  const forgotten = open ? isForgotten(open.check_in_at, null, now) : false;

  // Việc của tôi: chỉ tính việc mình là người chính (việc thay thế chỉ làm khi người chính nghỉ)
  const tasks = (tasksRes.data ?? []).filter((t) => t.primary_employee_id === me.id).map((t) => ({ ...t, display: displayStatus(t, now) }));
  const finished = tasks.filter((t) => t.display === "done" || t.display === "late").length;
  const overdue = tasks.filter((t) => t.display === "overdue");
  const nextTasks = tasks.filter((t) => t.display === "open" || t.display === "overdue" || t.display === "upcoming").slice(0, 5);

  // ---------- Trạng thái ca hôm nay ----------
  const nextShift = todayShifts[0];
  let clock: { title: string; sub: string; tone: Tone; cta?: string } | null = null;
  if (needsClock) {
    if (open && forgotten) {
      clock = { title: "Bạn quên ra ca", sub: `Ca mở từ ${formatTime(open.check_in_at)} — gửi yêu cầu sửa giờ`, tone: "bad", cta: "Sửa chấm công" };
    } else if (open) {
      clock = {
        title: `Đang trong ca · ${formatDuration(minutesBetween(open.check_in_at, null, now))}`,
        sub: `Vào lúc ${formatTime(open.check_in_at)}${open.branch?.name ? ` tại ${open.branch.name}` : ""}${nextShift ? ` · ca kết thúc ${hm(nextShift.end_time)}` : ""}`,
        tone: "good",
        cta: "Ra ca",
      };
    } else if (nextShift) {
      const start = new Date(nextShift.start_at).getTime();
      const late = now > start;
      clock = {
        title: late ? `Bạn đã trễ ${formatDuration(minutesBetween(nextShift.start_at, null, now))}` : `Ca hôm nay ${hm(nextShift.start_time)}–${hm(nextShift.end_time)}`,
        sub: `${nextShift.branch?.name ?? ""}${late ? " · vào ca ngay" : ` · còn ${formatDuration(minutesBetween(new Date(now).toISOString(), nextShift.start_at, now))} nữa`}`,
        tone: late ? "bad" : "info",
        cta: "Vào ca",
      };
    } else {
      clock = { title: "Hôm nay bạn không có ca", sub: "Vẫn có thể vào ca nếu được quản lý gọi", tone: "neutral", cta: "Chấm công" };
    }
  }

  const actions: ActionItem[] = [
    { key: "peer", icon: "🔁", text: "Đồng nghiệp nhờ đổi / nhường ca", detail: "Cần bạn đồng ý hoặc từ chối", href: "/schedule", tone: "bad", count: peerRes.count ?? 0 },
    { key: "overdue", icon: "📋", text: "Việc checklist đã quá hạn", href: "/checklist", tone: "bad", count: overdue.length },
    { key: "mine", icon: "📝", text: "Đơn của tôi đang chờ duyệt", href: "/schedule", tone: "info", count: myRequestsRes.count ?? 0 },
  ];

  return (
    <div className="space-y-4">
      {clock && (
        <Link
          href="/attendance"
          className={`card flex flex-wrap items-center justify-between gap-3 p-5 transition hover:shadow-md ${
            clock.tone === "bad" ? "border-red-200 bg-red-50" : clock.tone === "good" ? "border-emerald-200 bg-emerald-50" : ""
          }`}
        >
          <span>
            <span className="block text-xs font-medium uppercase tracking-wide text-neutral-500">Chấm công</span>
            <span className="mt-1 block text-lg font-bold">{clock.title}</span>
            <span className="block text-sm text-neutral-600">{clock.sub}</span>
          </span>
          {clock.cta && <span className="btn-primary">{clock.cta}</span>}
        </Link>
      )}

      {!compact && (
        <div className="grid grid-cols-2 gap-3">
          <StatTile
            label="Việc của tôi hôm nay"
            value={tasks.length ? `${finished}/${tasks.length}` : "—"}
            progress={tasks.length ? finished / tasks.length : undefined}
            sub={overdue.length ? `${overdue.length} việc quá hạn` : tasks.length ? "Đúng tiến độ" : "Không có việc"}
            tone={overdue.length ? "bad" : tasks.length && finished === tasks.length ? "good" : "neutral"}
            href="/checklist"
          />
          <StatTile
            label="Ca sắp tới"
            value={upcoming.length ? dayLabel(upcoming[0].work_date) : "—"}
            sub={upcoming.length ? `${hm(upcoming[0].start_time)}–${hm(upcoming[0].end_time)} · ${upcoming[0].branch?.name ?? ""}` : "Chưa có lịch công bố"}
            href="/schedule"
          />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title={compact ? "Việc của tôi" : "Cần làm"}>
          <ActionList items={actions} emptyText="Không có việc tồn đọng." />
          {nextTasks.length > 0 && (
            <ul className="divide-y divide-neutral-100 border-t border-neutral-100">
              {nextTasks.map((t) => (
                <li key={t.id}>
                  <Link href="/checklist" className="flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-50">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{t.title}</span>
                      <span className="block text-xs text-neutral-500">Hạn {formatTime(t.due_at)}</span>
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${DISPLAY_STATUS[t.display].className}`}>
                      {DISPLAY_STATUS[t.display].label}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Lịch làm của tôi" action={{ href: "/schedule", label: "Xem lịch" }}>
          {todayShifts.length + upcoming.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-neutral-500">Chưa có ca nào trong {UPCOMING_DAYS} ngày tới.</p>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {[...todayShifts, ...upcoming].map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="w-20 shrink-0 text-sm font-medium">{s.work_date === today ? "Hôm nay" : dayLabel(s.work_date)}</span>
                  <span className="flex-1 text-sm tabular-nums">{hm(s.start_time)}–{hm(s.end_time)}</span>
                  {s.branch?.name && <Badge tone="neutral">{s.branch.name}</Badge>}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
