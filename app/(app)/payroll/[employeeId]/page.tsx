import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePayrollAccess } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getRequestTime } from "@/lib/request-time";
import { formatDateTime, vnDateString } from "@/lib/time";
import { friendlyDbError } from "@/lib/action-state";
import {
  formatDayMonth,
  isValidEarlyEnd,
  isValidPeriodStart,
  periodEnd,
  periodLabel,
  periodStartOf,
  shiftPeriod,
  type PayslipData,
} from "@/lib/payroll";
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
  const fullEnd = periodEnd(profile.pay_period, start);
  // Chốt sớm (NV nghỉ giữa kỳ): ?end=YYYY-MM-DD, chỉ khi kỳ chưa kết thúc
  if (query.end !== undefined && !isValidEarlyEnd(profile.pay_period, start, query.end, today)) {
    redirect(`/payroll/${employeeId}?start=${start}`);
  }
  const earlyEnd = typeof query.end === "string" ? query.end : null;

  const { data, error } = await supabase.rpc("payroll_preview", {
    p_employee_id: employeeId,
    p_period_start: start,
    ...(earlyEnd ? { p_end_date: earlyEnd } : {}),
  });
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
          <p className="text-sm text-neutral-500">{periodLabel(profile.pay_period, start, slip.period_end)}</p>
        </div>
        <div className="flex gap-2">
          <Link href={nav(shiftPeriod(profile.pay_period, start, -1))} className="btn-secondary px-3 py-1.5">← Kỳ trước</Link>
          {start < current && (
            <Link href={nav(shiftPeriod(profile.pay_period, start, 1))} className="btn-secondary px-3 py-1.5">Kỳ sau →</Link>
          )}
        </div>
      </div>

      {earlyEnd && !slip.finalized && (
        <p className="alert-info mb-4">
          Đang xem phiếu <strong>chốt sớm</strong>: tính công từ {formatDayMonth(start)} đến hết ngày {formatDayMonth(earlyEnd)}
          {" "}(kỳ gốc đến {formatDayMonth(fullEnd)}).
        </p>
      )}
      {slip.finalized ? (
        <p className="alert-success mb-4">
          ✓ {slip.closed_early ? `Đã chốt sớm (tính công đến hết ngày ${formatDayMonth(slip.period_end)})` : "Đã chốt"} lúc{" "}
          {slip.finalized_at ? formatDateTime(slip.finalized_at) : ""}. Phiếu lương đã khóa.
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
            <FinalizeButton
              employeeId={employeeId}
              periodStart={start}
              endDate={earlyEnd}
              name={slip.full_name}
              net={slip.net_amount}
            />
          ) : (
            <p className="text-center text-xs text-neutral-500">Chỉ chốt được khi kỳ đã kết thúc và không còn mục cần xử lý.</p>
          )}
          {earlyEnd ? (
            <p className="text-center text-sm">
              <Link href={nav(start)} className="font-medium text-neutral-600 underline hover:text-neutral-900">
                Bỏ chốt sớm, xem lại số tạm tính cả kỳ
              </Link>
            </p>
          ) : (
            fullEnd >= today && (
              <form action={`/payroll/${employeeId}`} className="card space-y-3 p-4">
                <div>
                  <h3 className="font-semibold">Chốt lương sớm</h3>
                  <p className="mt-1 text-xs text-neutral-500">
                    Dùng khi nhân viên nghỉ việc giữa kỳ: chỉ tính công từ {formatDayMonth(start)} đến ngày bạn chọn, xem lại rồi chốt.
                  </p>
                </div>
                <input type="hidden" name="start" value={start} />
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-40 flex-1">
                    <label htmlFor="early-end" className="mb-1 block text-xs font-medium text-neutral-600">
                      Tính công đến hết ngày
                    </label>
                    <input id="early-end" type="date" name="end" required min={start} max={today} defaultValue={today} className="input" />
                  </div>
                  <button type="submit" className="btn-secondary">Xem phiếu chốt sớm</button>
                </div>
              </form>
            )
          )}
        </div>
      )}
    </div>
  );
}
