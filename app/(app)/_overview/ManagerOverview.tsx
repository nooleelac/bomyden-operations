import Link from "next/link";
import type { CurrentEmployee } from "@/lib/auth/session";
import { canAccessPayroll, mustClockIn } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import type { BranchRef } from "@/lib/branches";
import { getRequestTime } from "@/lib/request-time";
import { formatDuration, formatTime, isForgotten, minutesBetween, vnDayRange } from "@/lib/time";
import { addDays, dayLabel, hm } from "@/lib/schedule";
import { DISPLAY_STATUS, displayStatus } from "@/lib/checklist";
import { formatMoney } from "@/lib/inventory";
import type { SalaryAdvanceQueueItem } from "@/lib/payroll";
import { ActionList, Badge, SectionCard, StatTile, type ActionItem, type Tone } from "./ui";
import RealtimeRefresh from "@/components/RealtimeRefresh";

const TREND_DAYS = 7;

type ShiftState = { label: string; tone: Tone; order: number };

/** Tổng quan cho Quản trị viên / Quản lý: tình hình hôm nay của các chi nhánh trong phạm vi. */
export default async function ManagerOverview({
  actor,
  branches,
  branchId,
  today,
}: {
  actor: CurrentEmployee;
  branches: BranchRef[];
  branchId: string;
  today: string;
}) {
  const scope = branchId ? [branchId] : branches.map((b) => b.id);
  const now = getRequestTime();
  const range = vnDayRange(today);
  const monthStart = `${today.slice(0, 7)}-01`;
  const trendFrom = addDays(today, -(TREND_DAYS - 1));
  const showBranch = !branchId && branches.length > 1;
  const supabase = await createClient();

  await supabase.rpc("ensure_task_instances");

  // Đơn/yêu cầu: RLS đã giới hạn theo chi nhánh quản lý; lọc thêm khi chọn 1 chi nhánh
  let correctionsQ = supabase
    .from("attendance_corrections")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .neq("employee_id", actor.id);
  let requestsQ = supabase
    .from("schedule_requests")
    .select("id, is_urgent")
    .eq("status", "pending")
    .neq("employee_id", actor.id);
  if (branchId) {
    correctionsQ = correctionsQ.eq("branch_id", branchId);
    requestsQ = requestsQ.eq("branch_id", branchId);
  }

  const [shiftsRes, attendanceRes, tasksRes, trendRes, correctionsRes, requestsRes, registrationsRes, draftsRes, leavesRes, debtRes, monthRes, advancesRes, minRes] =
    await Promise.all([
      supabase
        .from("shifts")
        .select("id, employee_id, start_time, end_time, start_at, end_at, branch:branches(name), employee:employees!shifts_employee_id_fkey(full_name, role, requires_attendance)")
        .eq("work_date", today)
        .eq("status", "published")
        .in("branch_id", scope)
        .order("start_at"),
      supabase
        .from("attendance_records")
        .select("id, employee_id, check_in_at, check_out_at, branch:branches(name), employee:employees!attendance_records_employee_id_fkey(full_name)")
        .in("branch_id", scope)
        .or(`check_out_at.is.null,check_in_at.gte."${range.start}"`)
        .order("check_in_at"),
      supabase
        .from("task_instances")
        .select("id, by_shift, title, status, start_at, due_at, completed_at, branch:branches(name), primary:employees!task_instances_primary_employee_id_fkey(full_name)")
        .eq("task_date", today)
        .neq("status", "cancelled")
        .in("branch_id", scope)
        .order("due_at"),
      supabase
        .from("task_instances")
        .select("task_date, status, start_at, due_at, completed_at")
        .gte("task_date", trendFrom)
        .lt("task_date", today)
        .neq("status", "cancelled")
        .in("branch_id", scope),
      correctionsQ,
      requestsQ,
      supabase
        .from("shift_registrations")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .gte("work_date", today)
        .in("branch_id", scope),
      supabase
        .from("shifts")
        .select("id", { count: "exact", head: true })
        .eq("status", "draft")
        .gte("work_date", today)
        .lte("work_date", addDays(today, 13))
        .in("branch_id", scope),
      supabase
        .from("schedule_requests")
        .select("employee_id")
        .eq("kind", "leave")
        .eq("status", "approved")
        .lte("start_date", today)
        .gte("end_date", today),
      supabase
        .from("stock_receipts")
        .select("debt_amount, due_date")
        .eq("status", "posted")
        .gt("debt_amount", 0)
        .in("branch_id", scope),
      supabase
        .from("stock_receipts")
        .select("total_amount")
        .eq("status", "posted")
        .gte("invoice_date", monthStart)
        .in("branch_id", scope),
      canAccessPayroll(actor) ? supabase.rpc("salary_advance_queue") : Promise.resolve({ data: [], error: null }),
      supabase
        .from("stock_balances")
        .select("branch_id, quantity, min_quantity, item:inventory_items!inner(name, is_active)")
        .not("min_quantity", "is", null)
        .eq("item.is_active", true)
        .in("branch_id", scope),
    ]);

  if (shiftsRes.error || attendanceRes.error || tasksRes.error) {
    throw new Error("Không tải được tổng quan.");
  }

  // ---------- Nhân sự hôm nay ----------
  const records = attendanceRes.data;
  const onLeave = new Set((leavesRes.data ?? []).map((l) => l.employee_id));
  const openRecords = records.filter((r) => !r.check_out_at);
  const forgotten = openRecords.filter((r) => isForgotten(r.check_in_at, null, now));
  const working = openRecords.filter((r) => !isForgotten(r.check_in_at, null, now));
  const recordsByEmployee = new Map<string, typeof records>();
  for (const r of records) {
    if (r.check_in_at < range.start && r.check_out_at) continue;
    recordsByEmployee.set(r.employee_id, [...(recordsByEmployee.get(r.employee_id) ?? []), r]);
  }

  const shiftRows = shiftsRes.data.map((s) => {
    const own = recordsByEmployee.get(s.employee_id) ?? [];
    const open = own.find((r) => !r.check_out_at);
    const start = new Date(s.start_at).getTime();
    const end = new Date(s.end_at).getTime();
    let state: ShiftState;
    if (onLeave.has(s.employee_id)) state = { label: "Nghỉ phép", tone: "info", order: 5 };
    else if (s.employee && !mustClockIn(s.employee)) state = { label: "Không chấm công", tone: "neutral", order: 6 };
    else if (open) state = { label: `Đang làm từ ${formatTime(open.check_in_at)}`, tone: "good", order: 2 };
    else if (own.length > 0) state = { label: "Đã ra ca", tone: "neutral", order: 4 };
    else if (now < start) state = { label: "Chưa đến giờ", tone: "neutral", order: 3 };
    else if (now <= end) state = { label: `Trễ ${formatDuration(minutesBetween(s.start_at, null, now))}`, tone: "bad", order: 0 };
    else state = { label: "Vắng mặt", tone: "bad", order: 1 };
    return {
      id: s.id,
      name: s.employee?.full_name ?? "—",
      time: `${hm(s.start_time)}–${hm(s.end_time)}`,
      branch: s.branch?.name ?? "",
      state,
    };
  });
  shiftRows.sort((a, b) => a.state.order - b.state.order);
  const missing = shiftRows.filter((r) => r.state.tone === "bad").length;

  // Đang làm nhưng không có ca trong lịch hôm nay
  const scheduledIds = new Set(shiftsRes.data.map((s) => s.employee_id));
  const unscheduled = working.filter((r) => !scheduledIds.has(r.employee_id));

  // ---------- Checklist ----------
  const tasks = tasksRes.data.map((t) => ({ ...t, display: displayStatus(t, now) }));
  const finished = tasks.filter((t) => t.display === "done" || t.display === "late").length;
  const overdueTasks = tasks.filter((t) => t.display === "overdue");
  const failedTasks = tasks.filter((t) => t.display === "failed");
  const problemTasks = [...overdueTasks, ...failedTasks];
  const taskProgress = tasks.length ? finished / tasks.length : 0;

  const trend = Array.from({ length: TREND_DAYS - 1 }, (_, i) => addDays(trendFrom, i)).map((day) => {
    const rows = (trendRes.data ?? []).filter((t) => t.task_date === day);
    const late = rows.filter((t) => displayStatus(t, now) === "late").length;
    const onTime = rows.filter((t) => displayStatus(t, now) === "done").length;
    return { day, total: rows.length, onTime, late, missed: rows.length - onTime - late };
  });
  trend.push({
    day: today,
    total: tasks.length,
    onTime: tasks.filter((t) => t.display === "done").length,
    late: tasks.filter((t) => t.display === "late").length,
    missed: overdueTasks.length + failedTasks.length,
  });
  const maxTrend = Math.max(1, ...trend.map((t) => t.total));

  // ---------- Đơn chờ duyệt ----------
  const requests = requestsRes.data ?? [];
  const urgentRequests = requests.filter((r) => r.is_urgent).length;
  const advances = ((advancesRes.data ?? []) as unknown as SalaryAdvanceQueueItem[]).filter((a) => a.status === "pending");
  const corrections = correctionsRes.count ?? 0;
  const registrations = registrationsRes.count ?? 0;
  const approvals = corrections + requests.length + registrations + advances.length;

  // ---------- Kho ----------
  const debts = debtRes.data ?? [];
  const totalDebt = debts.reduce((t, r) => t + Number(r.debt_amount ?? 0), 0);
  const overdueDebt = debts.filter((r) => r.due_date && r.due_date < today);
  const overdueDebtAmount = overdueDebt.reduce((t, r) => t + Number(r.debt_amount ?? 0), 0);
  const monthPurchases = (monthRes.data ?? []).reduce((t, r) => t + Number(r.total_amount), 0);

  const lowStock = (minRes.data ?? []).filter((b) => Number(b.quantity) < Number(b.min_quantity));
  const lowStockHref = branchId || branches.length === 1 ? `/inventory?branch=${branchId || branches[0].id}&low=1` : "/inventory?low=1";

  const branchQuery = branchId ? `branch=${branchId}` : "";
  const withBranch = (path: string) => (branchQuery ? `${path}${path.includes("?") ? "&" : "?"}${branchQuery}` : path);

  const actions: ActionItem[] = [
    {
      key: "missing",
      icon: "🚨",
      text: "Nhân viên có ca nhưng chưa vào",
      detail: "Đến giờ ca theo lịch mà chưa chấm công",
      href: withBranch("/attendance/manage"),
      tone: "bad",
      count: missing,
    },
    {
      key: "forgotten",
      icon: "⏰",
      text: "Quên ra ca (mở quá 16 giờ)",
      detail: forgotten.map((r) => r.employee?.full_name).filter(Boolean).join(", "),
      href: withBranch("/attendance/manage"),
      tone: "bad",
      count: forgotten.length,
    },
    {
      key: "overdue-tasks",
      icon: "📋",
      text: "Checklist quá hạn / không đạt hôm nay",
      href: withBranch("/checklist/manage"),
      tone: "bad",
      count: problemTasks.length,
    },
    {
      key: "requests",
      icon: "📝",
      text: "Đơn xin phép chờ duyệt",
      detail: urgentRequests ? `${urgentRequests} đơn gấp` : undefined,
      href: withBranch("/schedule/manage?tab=requests"),
      tone: urgentRequests ? "bad" : "warn",
      count: requests.length,
    },
    {
      key: "corrections",
      icon: "🕐",
      text: "Yêu cầu sửa chấm công",
      href: withBranch("/attendance/manage"),
      tone: "warn",
      count: corrections,
    },
    {
      key: "registrations",
      icon: "🙋",
      text: "Đăng ký ca chờ duyệt",
      href: withBranch("/schedule/manage?tab=registrations"),
      tone: "warn",
      count: registrations,
    },
    {
      key: "advances",
      icon: "💵",
      text: "Đơn ứng lương chờ duyệt",
      detail: advances.length ? formatMoney(advances.reduce((t, a) => t + Number(a.amount), 0)) : undefined,
      href: "/payroll/advances",
      tone: "warn",
      count: advances.length,
    },
    {
      key: "debts",
      icon: "🧾",
      text: "Công nợ nhà cung cấp quá hạn",
      detail: overdueDebt.length ? formatMoney(overdueDebtAmount) : undefined,
      href: "/inventory/debts",
      tone: "bad",
      count: overdueDebt.length,
    },
    {
      key: "low-stock",
      icon: "📦",
      text: "Nguyên liệu dưới mức tối thiểu",
      detail: lowStock.slice(0, 4).map((b) => b.item?.name).filter(Boolean).join(", "),
      href: lowStockHref,
      tone: "warn",
      count: lowStock.length,
    },
    {
      key: "drafts",
      icon: "🗓️",
      text: "Ca nháp chưa công bố (14 ngày tới)",
      detail: "Nhân viên chưa thấy các ca này",
      href: withBranch("/schedule/manage"),
      tone: "info",
      count: draftsRes.count ?? 0,
    },
  ];

  return (
    <div className="space-y-4">
      {/* Realtime: việc checklist hôm nay + vào / ra ca */}
      <RealtimeRefresh
        channel="manager-overview"
        watch={[{ table: "task_instances", filter: `task_date=eq.${today}` }, { table: "attendance_records" }]}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Đang trong ca"
          value={working.length}
          sub={shiftRows.length ? `${shiftRows.length} ca theo lịch hôm nay${missing ? ` · ${missing} chưa vào` : ""}` : "Hôm nay chưa xếp ca"}
          tone={missing ? "bad" : working.length ? "good" : "neutral"}
          href={withBranch("/attendance/manage")}
        />
        <StatTile
          label="Checklist hôm nay"
          value={tasks.length ? `${finished}/${tasks.length}` : "—"}
          progress={tasks.length ? taskProgress : undefined}
          sub={problemTasks.length ? `${overdueTasks.length} quá hạn · ${failedTasks.length} không đạt` : tasks.length ? `${Math.round(taskProgress * 100)}% hoàn thành` : "Không có việc"}
          tone={problemTasks.length ? "bad" : tasks.length && finished === tasks.length ? "good" : "neutral"}
          href={withBranch("/checklist/manage")}
        />
        <StatTile
          label="Chờ duyệt"
          value={approvals}
          sub={approvals ? `Đơn, đăng ký ca, sửa công${advances.length ? ", ứng lương" : ""}` : "Không có gì chờ"}
          tone={urgentRequests ? "bad" : approvals ? "warn" : "good"}
          href={withBranch("/schedule/manage?tab=requests")}
        />
        <StatTile
          label="Công nợ NCC"
          value={<span className="whitespace-nowrap text-lg sm:text-2xl">{formatMoney(totalDebt)}</span>}
          sub={overdueDebt.length ? `Quá hạn ${formatMoney(overdueDebtAmount)}` : `Nhập tháng này ${formatMoney(monthPurchases)}`}
          tone={overdueDebt.length ? "bad" : "neutral"}
          href="/inventory/debts"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <SectionCard title="Cần xử lý" className="lg:col-span-2">
          <ActionList items={actions} emptyText="Mọi thứ đang ổn, không có việc tồn đọng." />
        </SectionCard>

        <SectionCard title={`Ca làm hôm nay (${shiftRows.length})`} action={{ href: withBranch("/schedule/manage"), label: "Xếp lịch" }} className="lg:col-span-3">
          {shiftRows.length === 0 && unscheduled.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-neutral-500">Hôm nay chưa có ca nào được công bố.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-neutral-100 overflow-y-auto">
              {shiftRows.map((row) => (
                <li key={row.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{row.name}</span>
                    <span className="block truncate text-xs tabular-nums text-neutral-500">
                      {row.time}
                      {showBranch && row.branch ? ` · ${row.branch}` : ""}
                    </span>
                  </span>
                  <Badge tone={row.state.tone}>{row.state.label}</Badge>
                </li>
              ))}
              {unscheduled.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{r.employee?.full_name ?? "—"}</span>
                    <span className="block truncate text-xs text-neutral-500">
                      Ngoài lịch
                      {showBranch && r.branch?.name ? ` · ${r.branch.name}` : ""}
                    </span>
                  </span>
                  <Badge tone="good">Đang làm từ {formatTime(r.check_in_at)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <SectionCard title="Checklist cần chú ý" action={{ href: withBranch("/checklist/manage"), label: "Báo cáo" }} className="lg:col-span-3">
          {problemTasks.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-emerald-700">
              ✓ {tasks.length ? "Không có việc quá hạn hay không đạt." : "Hôm nay không có việc checklist."}
            </p>
          ) : (
            <ul className="max-h-80 divide-y divide-neutral-100 overflow-y-auto">
              {problemTasks.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{t.title}</span>
                    <span className="block truncate text-xs text-neutral-500">
                      {t.by_shift ? "Theo ca" : t.primary?.full_name ?? "—"} · hạn {formatTime(t.due_at)}
                      {showBranch && t.branch?.name ? ` · ${t.branch.name}` : ""}
                    </span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${DISPLAY_STATUS[t.display].className}`}>
                    {DISPLAY_STATUS[t.display].label}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Checklist 7 ngày qua" className="lg:col-span-2">
          <ChecklistTrend days={trend} max={maxTrend} today={today} />
        </SectionCard>
      </div>

      {!branchId && branches.length > 1 && (
        <p className="text-xs text-neutral-500">
          Đang xem tổng hợp {branches.length} chi nhánh. Chọn một chi nhánh ở trên để xem riêng.
        </p>
      )}
      <p className="text-right text-xs text-neutral-400">
        Cập nhật lúc {formatTime(new Date(now).toISOString())} ·{" "}
        <Link href={withBranch("/")} className="underline hover:text-neutral-600">Làm mới</Link>
      </p>
    </div>
  );
}

const TREND_SEGMENTS = [
  { key: "onTime", label: "Đúng hạn", className: "bg-emerald-500" },
  { key: "late", label: "Xong trễ", className: "bg-amber-400" },
  { key: "missed", label: "Không làm / không đạt", className: "bg-red-500" },
] as const;

/** Cột chồng theo ngày: đúng hạn / trễ / không làm. Hôm nay chỉ tính việc đã quá hạn hoặc không đạt là "không làm". */
function ChecklistTrend({ days, max, today }: { days: { day: string; total: number; onTime: number; late: number; missed: number }[]; max: number; today: string }) {
  const sum = days.reduce(
    (acc, d) => ({ total: acc.total + d.total, onTime: acc.onTime + d.onTime }),
    { total: 0, onTime: 0 }
  );
  return (
    <div className="px-4 py-4">
      <p className="text-sm text-neutral-600">
        Đúng hạn:{" "}
        <span className="font-semibold text-neutral-900">{sum.total ? `${Math.round((sum.onTime / sum.total) * 100)}%` : "—"}</span>{" "}
        <span className="text-neutral-400">({sum.onTime}/{sum.total} việc)</span>
      </p>
      <div className="mt-3 flex h-32 items-end gap-2" role="img" aria-label="Biểu đồ checklist 7 ngày">
        {days.map((d) => (
          <div
            key={d.day}
            className="group relative flex h-full flex-1 flex-col justify-end"
            title={`${dayLabel(d.day)}: ${d.onTime} đúng hạn, ${d.late} trễ, ${d.missed} không làm/không đạt (tổng ${d.total})`}
          >
            <div className="flex flex-col-reverse gap-0.5" style={{ height: `${(d.total / max) * 100}%` }}>
              {TREND_SEGMENTS.map((s) =>
                d[s.key] > 0 ? (
                  <div
                    key={s.key}
                    className={`${s.className} first:rounded-b last:rounded-t`}
                    style={{ flexGrow: d[s.key], minHeight: 3 }}
                  />
                ) : null
              )}
            </div>
            {d.total === 0 && <div className="h-0.5 rounded bg-neutral-200" />}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-2">
        {days.map((d) => (
          <span key={d.day} className={`flex-1 text-center text-[11px] ${d.day === today ? "font-semibold text-neutral-900" : "text-neutral-500"}`}>
            {d.day === today ? "Nay" : dayLabel(d.day).split(" ")[0]}
          </span>
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-600">
        {TREND_SEGMENTS.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-sm ${s.className}`} aria-hidden="true" />
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
