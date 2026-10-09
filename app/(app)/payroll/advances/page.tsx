import type { Metadata } from "next";
import Link from "next/link";
import { requirePayrollAccess } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { friendlyDbError } from "@/lib/action-state";
import type { SalaryAdvanceQueueItem } from "@/lib/payroll";
import PayrollNav from "../PayrollNav";
import AdvanceReviewCard from "./AdvanceReviewCard";

export const metadata: Metadata = { title: "Ứng lương" };
export const instant = false;

export default async function PayrollAdvancesPage() {
  const actor = await requirePayrollAccess();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("salary_advance_queue");
  if (error) throw new Error(friendlyDbError(error));
  const items = data as unknown as SalaryAdvanceQueueItem[];
  const pending = items.filter((i) => i.status === "pending");
  const history = items.filter((i) => i.status !== "pending");

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">← Trang chủ</Link>
      <h1 className="mb-4 mt-2 text-2xl font-bold tracking-tight">Ứng lương</h1>
      <PayrollNav active="advances" isAdmin={actor.role === "admin"} />

      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Chờ duyệt ({pending.length})</h2>
      {pending.length === 0 ? (
        <div className="card mb-6 px-6 py-8 text-center text-sm text-neutral-500">Không có đơn ứng lương nào đang chờ.</div>
      ) : (
        <ul className="mb-6 space-y-3">
          {pending.map((item) => (
            <li key={item.id}>
              <AdvanceReviewCard item={item} />
            </li>
          ))}
        </ul>
      )}

      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Đã xử lý (60 ngày gần đây)</h2>
      {history.length === 0 ? (
        <div className="card px-6 py-8 text-center text-sm text-neutral-500">Chưa có đơn nào.</div>
      ) : (
        <ul className="space-y-2">
          {history.map((item) => (
            <li key={item.id}>
              <AdvanceReviewCard item={item} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
