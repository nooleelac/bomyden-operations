import type { Metadata } from "next";
import Link from "next/link";
import { requireEmployee } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getRequestTime } from "@/lib/request-time";
import { vnDateString } from "@/lib/time";
import { addDays, hm, monthEndOf, resolvePeriod } from "@/lib/schedule";
import PeriodNav from "../PeriodNav";
import RegisterView, { type MyRegistration } from "./RegisterView";

export const metadata: Metadata = { title: "Đăng ký ca" };
export const instant = false;


export default async function RegisterPage({ searchParams }: PageProps<"/schedule/register">) {
  const me = await requireEmployee();
  const params = await searchParams;
  const today = vnDateString(new Date(getRequestTime()));

  const back = <Link href="/schedule" className="text-sm text-neutral-500 hover:text-neutral-900">← Lịch làm việc</Link>;
  if (!me.self_schedule) {
    return (
      <div className="mx-auto max-w-2xl">
        {back}
        <h1 className="mb-4 mt-2 text-2xl font-bold tracking-tight">Đăng ký ca</h1>
        <div className="card p-6 text-center text-sm text-neutral-500">
          Bạn chưa được bật quyền tự đăng ký ca. Hãy nhờ quản lý bật trong mục Xếp lịch → Đăng ký ca.
        </div>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: myBranches } = await supabase
    .from("employee_branches")
    .select("branches!inner(id, name, is_active)")
    .eq("employee_id", me.id)
    .eq("branches.is_active", true);
  const branches = (myBranches ?? [])
    .map((row) => ({ id: row.branches.id, name: row.branches.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "vi"));
  const branchId = typeof params.branch === "string" && branches.some((b) => b.id === params.branch) ? params.branch : (branches[0]?.id ?? "");

  // Mặc định: tuần sau / tháng sau
  const period = resolvePeriod(params.mode, params.start, params.mode === "month" ? addDays(monthEndOf(today), 1) : addDays(today, 7));
  const { from, to } = period;

  const [tplRes, regRes, shiftRes] = branchId
    ? await Promise.all([
        supabase.from("shift_templates").select("id, name, start_time, end_time").eq("branch_id", branchId).eq("is_active", true).order("sort_order").order("start_time"),
        supabase.rpc("my_shift_registrations", { p_branch_id: branchId, p_from: from, p_to: to }),
        supabase
          .from("shifts")
          .select("work_date, start_time, end_time")
          .eq("branch_id", branchId)
          .eq("employee_id", me.id)
          .eq("status", "published")
          .gte("work_date", from)
          .lte("work_date", to),
      ])
    : [null, null, null];
  if (tplRes?.error || regRes?.error || shiftRes?.error) throw new Error("Không tải được dữ liệu đăng ký ca.");
  const reg = (regRes?.data as { open_from: string; items: MyRegistration[] } | null) ?? { open_from: today, items: [] };

  return (
    <div className="mx-auto max-w-2xl">
      {back}
      <h1 className="mb-1 mt-2 text-2xl font-bold tracking-tight">Đăng ký ca</h1>
      <p className="mb-4 text-sm text-neutral-500">Chọn ca muốn làm (hoặc Nghỉ) cho từng ngày rồi bấm Gửi. Quản lý duyệt xong ca sẽ hiện trên lịch.</p>

      <PeriodNav period={period} branches={branches} branchId={branchId} />

      {!branchId ? (
        <div className="card p-6 text-center text-sm text-neutral-500">Bạn chưa thuộc chi nhánh nào.</div>
      ) : (tplRes?.data ?? []).length === 0 ? (
        <div className="card p-6 text-center text-sm text-neutral-500">Chi nhánh chưa có mẫu ca nào để đăng ký.</div>
      ) : (
        <RegisterView
          key={`${branchId}-${from}-${to}`}
          branchId={branchId}
          from={from}
          to={to}
          openFrom={reg.open_from}
          templates={tplRes!.data!.map((t) => ({ id: t.id, name: t.name, startTime: hm(t.start_time), endTime: hm(t.end_time) }))}
          registrations={reg.items}
          shifts={(shiftRes?.data ?? []).map((s) => ({ workDate: s.work_date, time: `${hm(s.start_time)}–${hm(s.end_time)}` }))}
        />
      )}
    </div>
  );
}
