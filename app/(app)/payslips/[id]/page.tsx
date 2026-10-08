import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireEmployee } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/time";
import { periodLabel, type PayslipData } from "@/lib/payroll";
import PayslipBody from "@/components/PayslipBody";

export const metadata: Metadata = { title: "Phiếu lương" };
export const instant = false;

export default async function MyPayslipPage({ params }: PageProps<"/payslips/[id]">) {
  const me = await requireEmployee();
  const { id } = await params;
  const supabase = await createClient();

  // RLS chặn xem phiếu của người khác / khi chưa được phép
  const { data: slip } = await supabase
    .from("payslips")
    .select("id, pay_period, period_start, data, finalized_at")
    .eq("id", id)
    .eq("employee_id", me.id)
    .maybeSingle();
  if (!slip) notFound();

  const data = slip.data as unknown as PayslipData;

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/payslips" className="text-sm text-neutral-500 hover:text-neutral-900">← Phiếu lương của tôi</Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">{periodLabel(slip.pay_period, slip.period_start)}</h1>
      <p className="mb-5 text-sm text-neutral-500">Đã chốt lúc {formatDateTime(slip.finalized_at)}</p>
      <PayslipBody data={data} />
      <p className="mt-4 text-center text-xs text-neutral-400">Có thắc mắc về phiếu lương? Liên hệ Quản lý.</p>
    </div>
  );
}
