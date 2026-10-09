import type { Metadata } from "next";
import Link from "next/link";
import { requireEmployee } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { friendlyDbError } from "@/lib/action-state";
import { formatMoney, periodLabel, type MySalaryAdvances } from "@/lib/payroll";
import AdvanceSection from "./AdvanceSection";

export const metadata: Metadata = { title: "Phiếu lương của tôi" };
export const instant = false;

export default async function MyPayslipsPage() {
  const me = await requireEmployee();
  const supabase = await createClient();

  // RLS: chỉ thấy phiếu của chính mình, và chỉ khi QTV cho phép xem
  const [{ data: profile }, { data: slips }, { data: advData, error: advError }] = await Promise.all([
    supabase.from("payroll_profiles").select("can_view_payslip").eq("employee_id", me.id).maybeSingle(),
    supabase
      .from("payslips")
      .select("id, pay_period, period_start, period_end, net_amount, finalized_at")
      .eq("employee_id", me.id)
      .order("period_start", { ascending: false })
      .limit(24),
    supabase.rpc("my_salary_advances"),
  ]);
  if (advError) throw new Error(friendlyDbError(advError));
  const advances = advData as unknown as MySalaryAdvances;

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">← Trang chủ</Link>
      <h1 className="mb-5 mt-2 text-2xl font-bold tracking-tight">Phiếu lương của tôi</h1>

      {advances.has_profile && (
        <div className="mb-6">
          <AdvanceSection quota={advances.quota} items={advances.items} />
        </div>
      )}

      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Các kỳ lương đã chốt</h2>
      {!profile?.can_view_payslip ? (
        <div className="card px-6 py-10 text-center text-sm text-neutral-500">
          Bạn chưa được cấp quyền xem phiếu lương. Liên hệ Quản trị viên nếu cần.
        </div>
      ) : (slips ?? []).length === 0 ? (
        <div className="card px-6 py-10 text-center text-sm text-neutral-500">Chưa có kỳ lương nào được chốt.</div>
      ) : (
        <ul className="space-y-2">
          {slips!.map((s) => (
            <li key={s.id}>
              <Link href={`/payslips/${s.id}`} className="card flex items-center justify-between p-4 transition hover:border-neutral-400">
                <span className="font-semibold">{periodLabel(s.pay_period, s.period_start, s.period_end)}</span>
                <span className="font-bold tabular-nums">{formatMoney(s.net_amount)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
