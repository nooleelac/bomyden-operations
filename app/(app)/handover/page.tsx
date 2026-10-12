import type { Metadata } from "next";
import Link from "next/link";
import { requireEmployee } from "@/lib/auth/session";
import { isManagerOrAdmin } from "@/lib/auth/roles";
import { getMyBranches } from "@/lib/branches";
import { createClient } from "@/lib/supabase/server";
import { HANDOVER_STATUS } from "@/lib/handover";
import { formatDateTime } from "@/lib/time";
import BranchChips from "../inventory/BranchChips";

export const metadata: Metadata = { title: "Bàn giao ca" };
export const instant = false;

export default async function HandoverPage({ searchParams }: PageProps<"/handover">) {
  const me = await requireEmployee();
  const params = await searchParams;
  const branches = await getMyBranches(me);
  const branchId = typeof params.branch === "string" && branches.some((b) => b.id === params.branch) ? params.branch : "";
  const manager = isManagerOrAdmin(me.role);

  if (branches.length === 0) {
    return <p className="alert-info">Bạn chưa được gán chi nhánh nào.</p>;
  }

  const supabase = await createClient();
  const { data: handovers, error } = await supabase
    .from("shift_handovers")
    .select("id, created_at, status, line_count, note, handed_by, handed_by_name, received_by_name, received_at, branch:branches(name)")
    .in("branch_id", branchId ? [branchId] : branches.map((b) => b.id))
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error("Không tải được phiếu bàn giao.");

  const list = handovers ?? [];
  const waiting = list.filter((h) => h.status === "pending" && h.handed_by !== me.id);
  const newHref = `/handover/new${branchId ? `?branch=${branchId}` : ""}`;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Bàn giao ca</h1>
        <div className="flex gap-2">
          {manager && (
            <Link href={`/handover/settings${branchId ? `?branch=${branchId}` : ""}`} className="btn-secondary">⚙️ Danh sách món</Link>
          )}
          <Link href={newHref} className="btn-primary">📸 Bàn giao ca</Link>
        </div>
      </div>

      <p className="alert-info mb-4">
        Cuối ca: cân / đếm thịt bò và nguyên liệu, nhập số lượng và chụp ảnh từng món. Người nhận ca kiểm tra lại rồi bấm{" "}
        <strong>Đã nhận</strong> hoặc <strong>Báo sai lệch</strong>.
      </p>

      <BranchChips branches={branches} branchId={branchId} allowAll href={(id) => (id ? `?branch=${id}` : "?")} />

      {waiting.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-2 text-sm font-semibold text-amber-800">Chờ nhận ca ({waiting.length})</h2>
          <ul className="space-y-2">
            {waiting.map((h) => (
              <li key={h.id}>
                <Link href={`/handover/${h.id}`} className="card flex items-center justify-between gap-3 border-amber-200 bg-amber-50/50 px-4 py-3 hover:bg-amber-50">
                  <div className="min-w-0">
                    <p className="font-medium">{h.handed_by_name} đã bàn giao {h.line_count} món</p>
                    <p className="truncate text-xs text-neutral-500">
                      {formatDateTime(h.created_at)}
                      {branches.length > 1 && ` · ${h.branch?.name}`}
                    </p>
                  </div>
                  <span className="btn-primary shrink-0 px-3 py-1.5 text-sm">Kiểm tra →</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {list.length === 0 ? (
        <p className="card p-8 text-center text-neutral-500">Chưa có phiếu bàn giao nào.</p>
      ) : (
        <ul className="card divide-y divide-neutral-100">
          {list.map((h) => {
            const status = HANDOVER_STATUS[h.status];
            return (
              <li key={h.id}>
                <Link href={`/handover/${h.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-neutral-50">
                  <div className="min-w-0">
                    <p className="font-medium">{formatDateTime(h.created_at)}</p>
                    <p className="truncate text-xs text-neutral-500">
                      {h.handed_by_name} → {h.received_by_name ?? "…"} · {h.line_count} món
                      {branches.length > 1 && ` · ${h.branch?.name}`}
                      {h.note && ` · ${h.note}`}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}>{status.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
