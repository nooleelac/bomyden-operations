import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInventoryAccess } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, formatQty } from "@/lib/inventory";
import { formatDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Phiếu kiểm kê" };
export const instant = false;

export default async function CountDetailPage({ params }: PageProps<"/inventory/counts/[id]">) {
  await requireInventoryAccess();
  const { id } = await params;
  const supabase = await createClient();
  const { data: count } = await supabase
    .from("stock_counts")
    .select(
      "id, created_at, note, line_count, used_value, surplus_value, branch:branches(name), creator:employees!stock_counts_created_by_fkey(full_name), stock_count_lines(id, system_qty, counted_qty, used_qty, unit_cost, item:inventory_items(name, category, base_unit))"
    )
    .eq("id", id)
    .maybeSingle();
  if (!count) notFound();

  // Chênh lệch lớn (theo giá trị) lên trước
  const lines = [...count.stock_count_lines].sort(
    (a, b) => Math.abs(Number(b.used_qty) * Number(b.unit_cost ?? 0)) - Math.abs(Number(a.used_qty) * Number(a.unit_cost ?? 0)) || (a.item?.name ?? "").localeCompare(b.item?.name ?? "", "vi")
  );

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/inventory/counts" className="text-sm text-neutral-500 hover:text-neutral-900">← Kiểm kê</Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">Phiếu kiểm kê</h1>
      <p className="mb-4 text-sm text-neutral-500">
        {formatDateTime(count.created_at)} · {count.branch?.name} · {count.creator?.full_name ?? "—"}
        {count.note && ` · ${count.note}`}
      </p>

      <div className="mb-4 grid grid-cols-3 gap-3">
        <div className="card p-4">
          <p className="text-xs text-neutral-500">Nguyên liệu đã đếm</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{count.line_count}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-neutral-500">Đã dùng / hao hụt</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{formatMoney(count.used_value)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-neutral-500">Dư so với sổ</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{formatMoney(count.surplus_value)}</p>
        </div>
      </div>

      <p className="mb-3 text-xs text-neutral-500">
        Sổ = tồn trước khi đếm (lần đếm trước + nhập − xuất). Dư thường do quên nhập phiếu nhập kho hoặc đếm lần trước bị thiếu.
      </p>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
            <tr>
              <th className="px-4 py-2 font-medium">Nguyên liệu</th>
              <th className="px-3 py-2 text-right font-medium">Sổ</th>
              <th className="px-3 py-2 text-right font-medium">Đếm được</th>
              <th className="px-3 py-2 text-right font-medium">Đã dùng</th>
              <th className="px-4 py-2 text-right font-medium">Giá trị</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {lines.map((l) => {
              const used = Number(l.used_qty);
              const value = used * Number(l.unit_cost ?? 0);
              return (
                <tr key={l.id}>
                  <td className="px-4 py-2.5 font-medium">{l.item?.name}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-neutral-500">{formatQty(l.system_qty)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatQty(l.counted_qty)} <span className="text-neutral-400">{l.item?.base_unit}</span></td>
                  <td className={`px-3 py-2.5 text-right tabular-nums ${used < 0 ? "text-sky-700" : ""}`}>
                    {used < 0 ? `Dư ${formatQty(-used)}` : formatQty(used)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{l.unit_cost === null ? "—" : formatMoney(Math.abs(value))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
