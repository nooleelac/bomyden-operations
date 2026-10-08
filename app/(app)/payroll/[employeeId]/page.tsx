import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePayrollAccess } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getRequestTime } from "@/lib/request-time";
import { formatDateTime, vnDateString } from "@/lib/time";
import { friendlyDbError } from "@/lib/action-state";
import { isValidPeriodStart, periodLabel, periodStartOf, shiftPeriod, type PayslipData } from "@/lib/payroll";
import PayslipBody from "@/components/PayslipBody";
import { AddAdjustmentForm, DeleteAdjustmentButton, FinalizeButton } from "./PayslipActions";

export const metadata: Metadata = { title: "Phiếu lương" };
export const instant = false;

export default async function PayslipDetailPage({ params, searchParams }: PageProps<"/payroll/[employeeId]">) {
  await requirePayrollAccess();
  const { employeeId } = await params;
  const query = await searchParams;

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("payroll_profiles")
    .select("pay_period")
    .eq("employee_id", employeeId)
    .maybeSingle();
  if (!profile) notFound();

  const today = vnDateString(new Date(getRequestTime()));
  const current = periodStartOf(profile.pay_period, today);
  if (!isValidPeriodStart(profile.pay_period, query.start)) {
    redirect(`/payroll/${employeeId}?start=${current}`);
  }
  const start = query.start;

  const { data, error } = await supabase.rpc("payroll_preview", { p_employee_id: employeeId, p_period_start: start });
  if (error) throw new Error(friendlyDbError(error));
  const slip = data as unknown as PayslipData;

  const nav = (s: string) => `/payroll/${employeeId}?start=${s}`;

  return (
    <div className="mx-auto max-w-2xl">
      <Link href={`/payroll?period=${profile.pay_period}&start=${start}`} className="text-sm text-neutral-500 hover:text-neutral-900">
        ← Bảng lương
      </Link>
      <div className="mb-4 mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{slip.full_name}</h1>
          <p className="text-sm text-neutral-500">{periodLabel(profile.pay_period, start)}</p>
        </div>
        <div className="flex gap-2">
          <Link href={nav(shiftPeriod(profile.pay_period, start, -1))} className="btn-secondary px-3 py-1.5">← Kỳ trước</Link>
          {start < current && (
            <Link href={nav(shiftPeriod(profile.pay_period, start, 1))} className="btn-secondary px-3 py-1.5">Kỳ sau →</Link>
          )}
        </div>
      </div>

      {slip.finalized ? (
        <p className="alert-success mb-4">
          ✓ Đã chốt lúc {slip.finalized_at ? formatDateTime(slip.finalized_at) : ""}. Phiếu lương đã khóa.
        </p>
      ) : (
        slip.warnings.length > 0 && (
          <ul className="mb-4 space-y-2">
            {slip.warnings.map((w) => (
              <li key={w.message} className={w.blocking ? "alert-error" : "alert-info"}>
                {w.blocking ? "⛔ " : "ℹ️ "}
                {w.message}
              </li>
            ))}
          </ul>
        )
      )}

      <PayslipBody
        data={slip}
        lineAction={
          slip.finalized
            ? undefined
            : (line) =>
                line.adjustment_id ? (
                  <DeleteAdjustmentButton adjustmentId={line.adjustment_id} label={line.label} amount={line.amount} />
                ) : null
        }
      />

      {!slip.finalized && (
        <div className="mt-6 space-y-4">
          <AddAdjustmentForm employeeId={employeeId} periodStart={start} />
          {slip.can_finalize ? (
            <FinalizeButton employeeId={employeeId} periodStart={start} name={slip.full_name} net={slip.net_amount} />
          ) : (
            <p className="text-center text-xs text-neutral-500">Chỉ chốt được khi kỳ đã kết thúc và không còn mục cần xử lý.</p>
          )}
        </div>
      )}
    </div>
  );
}
