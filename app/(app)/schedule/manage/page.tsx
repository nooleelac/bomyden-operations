import type { Metadata } from "next";
import Link from "next/link";
import { requireManager } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getManageableBranches } from "@/lib/branches";
import { getRequestTime } from "@/lib/request-time";
import { vnDateString } from "@/lib/time";
import { addDays, hm, isMonday, resolvePeriod, weekStartOf, type WeekSchedule } from "@/lib/schedule";
import { ROLE_LABELS } from "@/lib/auth/roles";
import PeriodNav from "../PeriodNav";
import { RegistrationsManager, type BranchRegistration } from "./RegistrationsManager";
import WeekNav from "../WeekNav";
import { RequestsManager, ScheduleManager, ScheduleSettingsForm, TemplatesManager, type ManageRequest, type TemplateRow } from "./ManageViews";

export const metadata: Metadata = { title: "Xếp lịch & duyệt đơn" };
export const instant = false;

const TABS = [
  { key: "schedule", label: "Xếp lịch" },
  { key: "registrations", label: "Đăng ký ca" },
  { key: "requests", label: "Đơn xin phép" },
  { key: "templates", label: "Mẫu ca" },
  { key: "settings", label: "Cài đặt", adminOnly: true },
] as const;
type Tab = (typeof TABS)[number]["key"];

const REQUEST_HISTORY_DAYS = 60;

export default async function ManageSchedulePage({ searchParams }: PageProps<"/schedule/manage">) {
  const actor = await requireManager();
  const isAdmin = actor.role === "admin";
  const params = await searchParams;
  const branches = await getManageableBranches(actor);
  const branchIds = branches.map((b) => b.id);
  const tabs = TABS.filter((t) => !("adminOnly" in t) || isAdmin);
  const tab: Tab = tabs.find((t) => t.key === params.tab)?.key ?? "schedule";

  const now = getRequestTime();
  const today = vnDateString(new Date(now));
  const currentWeek = weekStartOf(today);
  const weekStart = isMonday(params.week) ? params.week : currentWeek;
  const branchId = typeof params.branch === "string" && branchIds.includes(params.branch) ? params.branch : (branchIds[0] ?? "");
  const branch = branches.find((b) => b.id === branchId);
  const supabase = await createClient();

  let content: React.ReactNode = null;

  if (branches.length === 0) {
    content = (
      <div className="card p-6 text-center text-sm text-neutral-500">
        {isAdmin ? "Chưa có chi nhánh nào. Hãy tạo chi nhánh trước." : "Bạn chưa được gán chi nhánh nào."}
      </div>
    );
  } else if (tab === "schedule") {
    const [weekRes, staffRes, tplRes] = await Promise.all([
      supabase.rpc("branch_week_schedule", { p_branch_id: branchId, p_week_start: weekStart }),
      supabase
        .from("employee_branches")
        .select("employee:employees!employee_branches_employee_id_fkey!inner(id, full_name, is_active, sort_order)")
        .eq("branch_id", branchId)
        .eq("employee.is_active", true),
      supabase.from("shift_templates").select("id, name, start_time, end_time").eq("branch_id", branchId).eq("is_active", true).order("sort_order").order("start_time"),
    ]);
    if (weekRes.error || staffRes.error || tplRes.error) throw new Error("Không tải được lịch làm việc.");
    const staff = staffRes.data
      .map((row) => row.employee)
      .sort((a, b) => a.sort_order - b.sort_order || a.full_name.localeCompare(b.full_name, "vi"))
      .map((e) => ({ id: e.id, name: e.full_name }));
    content = (
      <>
        <WeekNav weekStart={weekStart} currentWeek={currentWeek} branches={branches} branchId={branchId} extra={{ tab }} />
        <ScheduleManager
          key={`${branchId}-${weekStart}`}
          branchId={branchId}
          branchName={branch?.name ?? ""}
          weekStart={weekStart}
          today={today}
          data={weekRes.data as WeekSchedule}
          staff={staff}
          templates={tplRes.data.map((t) => ({ id: t.id, name: t.name, startTime: hm(t.start_time), endTime: hm(t.end_time) }))}
        />
      </>
    );
  } else if (tab === "registrations") {
    const period = resolvePeriod(params.mode, params.start, params.mode === "month" ? today : addDays(today, 7));
    const [regRes, tplRes, shiftRes, staffRes] = await Promise.all([
      supabase.rpc("branch_shift_registrations", { p_branch_id: branchId, p_from: period.from, p_to: period.to }),
      supabase.from("shift_templates").select("id, name, start_time, end_time").eq("branch_id", branchId).order("sort_order").order("start_time"),
      supabase.from("shifts").select("work_date, template_id").eq("branch_id", branchId).neq("status", "cancelled").gte("work_date", period.from).lte("work_date", period.to),
      supabase
        .from("employee_branches")
        .select("employee:employees!employee_branches_employee_id_fkey!inner(id, full_name, role, is_active, sort_order, self_schedule)")
        .eq("branch_id", branchId)
        .eq("employee.is_active", true),
    ]);
    if (regRes.error || tplRes.error || shiftRes.error || staffRes.error) throw new Error("Không tải được đăng ký ca.");
    const scheduled: Record<string, number> = {};
    for (const s of shiftRes.data) if (s.template_id) scheduled[`${s.work_date}|${s.template_id}`] = (scheduled[`${s.work_date}|${s.template_id}`] ?? 0) + 1;
    const staff = staffRes.data
      .map((row) => row.employee)
      .filter((e) => e.role !== "admin" && e.role !== "manager")
      .sort((a, b) => Number(b.self_schedule) - Number(a.self_schedule) || a.sort_order - b.sort_order || a.full_name.localeCompare(b.full_name, "vi"))
      .map((e) => ({ id: e.id, name: e.full_name, roleLabel: ROLE_LABELS[e.role], enabled: e.self_schedule }));
    content = (
      <>
        <PeriodNav period={period} branches={branches} branchId={branchId} extra={{ tab }} />
        <RegistrationsManager
          key={`${branchId}-${period.from}`}
          registrations={regRes.data as BranchRegistration[]}
          templates={tplRes.data.map((t) => ({ id: t.id, name: t.name, startTime: hm(t.start_time), endTime: hm(t.end_time) }))}
          scheduled={scheduled}
          staff={staff}
        />
      </>
    );
  } else if (tab === "requests") {
    const since = new Date(now - REQUEST_HISTORY_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const shiftCols = "work_date, start_time, end_time";
    const { data, error } = await supabase
      .from("schedule_requests")
      .select(
        `id, kind, status, employee_id, target_employee_id, start_date, end_date, requested_time, reason, is_urgent, over_limit, is_paid, review_note, reviewed_at, created_at,
         employee:employees!schedule_requests_employee_id_fkey(full_name),
         target:employees!schedule_requests_target_employee_id_fkey(full_name),
         reviewer:employees!schedule_requests_reviewed_by_fkey(full_name),
         branch:branches(name),
         shift:shifts!schedule_requests_shift_id_fkey(${shiftCols}),
         target_shift:shifts!schedule_requests_target_shift_id_fkey(${shiftCols})`
      )
      .or(`status.in.(pending,awaiting_peer),created_at.gte.${since}`)
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) throw new Error("Không tải được đơn xin phép.");
    const shiftInfo = (s: { work_date: string; start_time: string; end_time: string } | null) =>
      s ? { work_date: s.work_date, start_time: hm(s.start_time), end_time: hm(s.end_time) } : null;
    const requests: ManageRequest[] = data
      .map((r) => ({
        id: r.id,
        kind: r.kind,
        status: r.status,
        employee_id: r.employee_id,
        employee_name: r.employee?.full_name ?? "—",
        target_employee_id: r.target_employee_id,
        target_name: r.target?.full_name ?? null,
        start_date: r.start_date,
        end_date: r.end_date,
        requested_time: r.requested_time,
        shift: shiftInfo(r.shift),
        target_shift: shiftInfo(r.target_shift),
        reason: r.reason,
        is_urgent: r.is_urgent,
        over_limit: r.over_limit,
        is_paid: r.is_paid,
        review_note: r.review_note,
        reviewer_name: r.reviewer?.full_name ?? null,
        reviewed_at: r.reviewed_at,
        created_at: r.created_at,
        branch_name: r.branch?.name ?? null,
      }))
      // Gấp lên trước trong nhóm chờ duyệt
      .sort((a, b) => Number(b.status === "pending" && b.is_urgent) - Number(a.status === "pending" && a.is_urgent));
    content = <RequestsManager requests={requests} myId={actor.id} isAdmin={isAdmin} />;
  } else if (tab === "templates") {
    const { data, error } = await supabase
      .from("shift_templates")
      .select("id, branch_id, name, start_time, end_time, is_active, sort_order, branch:branches(name)")
      .in("branch_id", branchIds)
      .order("is_active", { ascending: false })
      .order("sort_order")
      .order("start_time");
    if (error) throw new Error("Không tải được mẫu ca.");
    const templates: TemplateRow[] = data.map((t) => ({
      id: t.id,
      branchId: t.branch_id,
      branchName: t.branch?.name ?? "",
      name: t.name,
      startTime: hm(t.start_time),
      endTime: hm(t.end_time),
      isActive: t.is_active,
      sortOrder: t.sort_order,
    }));
    content = <TemplatesManager templates={templates} branches={branches} />;
  } else {
    const { data: settings, error } = await supabase.from("schedule_settings").select("*").single();
    if (error || !settings) throw new Error("Không tải được cài đặt.");
    content = <ScheduleSettingsForm settings={settings} />;
  }

  const tabHref = (key: string) => "?" + new URLSearchParams({ tab: key, ...(branchId && { branch: branchId }), ...(weekStart !== currentWeek && { week: weekStart }) }).toString();

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/schedule" className="text-sm text-neutral-500 hover:text-neutral-900">← Lịch làm việc</Link>
      <h1 className="mb-4 mt-2 text-2xl font-bold tracking-tight">Xếp lịch & duyệt đơn</h1>

      <nav className="mb-4 flex max-w-full overflow-x-auto rounded-lg border border-neutral-200 bg-white p-1 text-sm [scrollbar-width:none]" aria-label="Mục quản lý lịch">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={tabHref(t.key)}
            aria-current={tab === t.key ? "page" : undefined}
            className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 font-medium ${tab === t.key ? "bg-brand text-brand-fg" : "text-neutral-600"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {content}
    </div>
  );
}
