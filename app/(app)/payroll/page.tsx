import type { Metadata } from "next";
import Link from "next/link";
import { requirePayrollAccess } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getRequestTime } from "@/lib/request-time";
import { vnDateString } from "@/lib/time";
import { friendlyDbError } from "@/lib/action-state";
import {
  PAY_TYPE_LABELS,
  formatDayMonth,
  formatHours,
  formatMoney,
  isValidPeriodStart,
  periodLabel,
  periodStartOf,
  shiftPeriod,
  type PayrollOverview,
} from "@/lib/payroll";
import type { PayPeriod } from "@/lib/database.types";
import PayrollNav from "./PayrollNav";

export const metadata: Metadata = { title: "Bảng lương" };
export const instant = false;

export default async function PayrollPage({ searchParams }: PageProps<"/payroll">) {
  const actor = await requirePayrollAccess();
  const params = await searchParams;
  const period: PayPeriod = params.period === "weekly" ? "weekly" : "monthly";
  const today = vnDateString(new Date(getRequestTime()));
  const current = periodStartOf(period, today);
  const start = isValidPeriodStart(period, params.start) ? params.start : current;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("payroll_overview", { p_period: period, p_period_start: start });
  if (error) throw new Error(friendlyDbError(error));
  const overview = data as unknown as PayrollOverview;

  const totalNet = overview.items.reduce((sum, i) => sum + i.net_amount, 0);
  const finalizedCount = overview.items.filter((i) => i.finalized).length;
  const href = (p: PayPeriod, s: string) => `/payroll?period=${p}&start=${s}`;

  return (
    <div>
      <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">← Trang chủ</Link>
      <div className="mb-4 mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Bảng lương</h1>
        <a href={`/payroll/export?period=${period}&start=${start}`} className="btn-secondary" download>
          ⬇ Xuất Excel kỳ này
        </a>
      </div>
      <PayrollNav active="overview" isAdmin={actor.role === "admin"} />

      <div className="card mb-5 flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="inline-flex rounded-lg border border-neutral-200 bg-white p-1 text-sm">
          {(["monthly", "weekly"] as const).map((p) => (
            <Link
              key={p}
              href={href(p, periodStartOf(p, today))}
              className={`rounded-md px-3 py-1.5 font-medium ${period === p ? "bg-neutral-900 text-white" : "text-neutral-600"}`}
            >
              {p === "monthly" ? "Kỳ tháng" : "Kỳ tuần"}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Link href={href(period, shiftPeriod(period, start, -1))} className="btn-secondary px-3 py-1.5" aria-label="Kỳ trước">←</Link>
          <span className="min-w-40 text-center text-sm font-semibold">{periodLabel(period, start)}</span>
          {start < current ? (
            <Link href={href(period, shiftPeriod(period, start, 1))} className="btn-secondary px-3 py-1.5" aria-label="Kỳ sau">→</Link>
          ) : (
            <span className="btn-secondary px-3 py-1.5 opacity-40" aria-hidden="true">→</span>
          )}
        </div>
      </div>

      {overview.missing_profiles.length > 0 && (
        <p className="alert-info mb-4">
          {overview.missing_profiles.length} nhân viên chưa có hồ sơ lương:{" "}
          {overview.missing_profiles.map((m) => m.full_name).join(", ")}.{" "}
          <Link href="/payroll/profiles" className="font-semibold underline">Cài hồ sơ lương</Link>
        </p>
      )}

      {overview.items.length === 0 ? (
        <div className="card px-6 py-10 text-center text-sm text-neutral-500">
          Không có nhân viên nào tính lương {period === "monthly" ? "theo tháng" : "theo tuần"}.
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap justify-between gap-2 text-sm text-neutral-600">
            <span>
              {overview.items.length} nhân viên · đã chốt {finalizedCount}/{overview.items.length}
            </span>
            <span>
              Tổng thực nhận: <strong className="text-neutral-900">{formatMoney(totalNet)}</strong>
            </span>
          </div>
          <ul className="space-y-2">
            {overview.items.map((item) => {
              const blocking = item.warnings.filter((w) => w.blocking && !w.message.includes("tạm tính"));
              return (
                <li key={item.employee_id}>
                  <Link
                    href={`/payroll/${item.employee_id}?start=${start}`}
                    className="card flex items-center justify-between gap-3 p-4 transition hover:border-neutral-400"
                  >
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-semibold">
                        {item.full_name}
                        {item.finalized ? (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                            {item.closed_early ? `Đã chốt sớm · đến ${formatDayMonth(item.period_end)}` : "Đã chốt"}
                          </span>
                        ) : (
                          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">Tạm tính</span>
                        )}
                        {blocking.length > 0 && !item.finalized && (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">⚠ Cần xử lý</span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-neutral-500">
                        {PAY_TYPE_LABELS[item.pay_type]} · {item.work_days} ngày · {formatHours(item.worked_minutes)}
                        {item.deductions_amount > 0 && <span className="text-red-700"> · trừ {formatMoney(item.deductions_amount)}</span>}
                      </p>
                    </div>
                    <span className="shrink-0 text-right font-bold tabular-nums">{formatMoney(item.net_amount)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
