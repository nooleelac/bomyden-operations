import type { Metadata } from "next";
import Link from "next/link";
import { requireManager } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/roles";
import { getManageableBranches } from "@/lib/branches";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, formatQty } from "@/lib/inventory";
import { formatDateTime, vnDateString, vnDayRange } from "@/lib/time";
import InventoryNav from "../InventoryNav";
import BranchChips from "../BranchChips";

export const metadata: Metadata = { title: "Tiêu hao nguyên liệu" };
export const instant = false;

type Row = {
  id: string;
  name: string;
  category: string;
  unit: string;
  receivedQty: number;
  receivedValue: number;
  usedQty: number;
  usedValue: number;
  surplusQty: number;
  wasteQty: number;
  wasteValue: number;
  otherQty: number;
  otherValue: number;
};

/** Báo cáo tiêu hao theo tháng: nhập, đã dùng (suy ra từ kiểm kê), hủy hàng, xuất khác. */
export default async function UsagePage({ searchParams }: PageProps<"/inventory/usage">) {
  const me = await requireManager();
  const params = await searchParams;
  const branches = await getManageableBranches(me);
  const branchId = typeof params.branch === "string" && branches.some((b) => b.id === params.branch) ? params.branch : "";
  const scope = branchId ? [branchId] : branches.map((b) => b.id);

  const month = typeof params.month === "string" && /^\d{4}-\d{2}$/.test(params.month) ? params.month : vnDateString().slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const from = `${month}-01`;
  const to = vnDateString(new Date(Date.UTC(y, m, 1)));
  const prevMonth = vnDateString(new Date(Date.UTC(y, m - 2, 1))).slice(0, 7);
  const nextMonth = to.slice(0, 7);
  const start = vnDayRange(from).start;
  const end = vnDayRange(to).start;

  const supabase = await createClient();
  const [countsRes, issuesRes, receiptsRes, lastCountsRes] = await Promise.all([
    supabase
      .from("stock_counts")
      .select("id, stock_count_lines(item_id, used_qty, unit_cost, item:inventory_items(name, category, base_unit))")
      .in("branch_id", scope)
      .gte("created_at", start)
      .lt("created_at", end),
    supabase
      .from("stock_issues")
      .select("kind, branch_id, to_branch_id, stock_issue_lines(item_id, base_quantity, amount, item:inventory_items(name, category, base_unit))")
      .eq("status", "posted")
      .in("branch_id", scope)
      .gte("created_at", start)
      .lt("created_at", end),
    supabase
      .from("stock_receipts")
      .select("stock_receipt_lines(item_id, base_quantity, amount, vat_amount, item:inventory_items(name, category, base_unit))")
      .eq("status", "posted")
      .in("branch_id", scope)
      .gte("invoice_date", from)
      .lt("invoice_date", to),
    supabase.from("stock_counts").select("branch_id, created_at").in("branch_id", scope).order("created_at", { ascending: false }).limit(50),
  ]);
  if (countsRes.error || issuesRes.error || receiptsRes.error) throw new Error("Không tải được báo cáo tiêu hao.");

  const rows = new Map<string, Row>();
  const row = (itemId: string, item: { name: string; category: string; base_unit: string } | null): Row => {
    let r = rows.get(itemId);
    if (!r) {
      r = {
        id: itemId,
        name: item?.name ?? "—",
        category: item?.category ?? "Khác",
        unit: item?.base_unit ?? "",
        receivedQty: 0,
        receivedValue: 0,
        usedQty: 0,
        usedValue: 0,
        surplusQty: 0,
        wasteQty: 0,
        wasteValue: 0,
        otherQty: 0,
        otherValue: 0,
      };
      rows.set(itemId, r);
    }
    return r;
  };

  for (const c of countsRes.data) {
    for (const l of c.stock_count_lines) {
      const r = row(l.item_id, l.item);
      const used = Number(l.used_qty);
      if (used >= 0) {
        r.usedQty += used;
        r.usedValue += used * Number(l.unit_cost ?? 0);
      } else {
        r.surplusQty += -used;
      }
    }
  }
  const scopeSet = new Set(scope);
  for (const i of issuesRes.data) {
    // Chuyển giữa 2 chi nhánh cùng trong phạm vi xem: không tính là hao
    if (i.kind === "transfer" && i.to_branch_id && scopeSet.has(i.to_branch_id)) continue;
    for (const l of i.stock_issue_lines) {
      const r = row(l.item_id, l.item);
      if (i.kind === "waste") {
        r.wasteQty += Number(l.base_quantity);
        r.wasteValue += Number(l.amount);
      } else {
        r.otherQty += Number(l.base_quantity);
        r.otherValue += Number(l.amount);
      }
    }
  }
  for (const rc of receiptsRes.data) {
    for (const l of rc.stock_receipt_lines) {
      const r = row(l.item_id, l.item);
      r.receivedQty += Number(l.base_quantity);
      r.receivedValue += Number(l.amount) + Number(l.vat_amount);
    }
  }

  const list = [...rows.values()].sort(
    (a, b) => b.usedValue + b.wasteValue - (a.usedValue + a.wasteValue) || b.receivedValue - a.receivedValue || a.name.localeCompare(b.name, "vi")
  );
  const total = list.reduce(
    (t, r) => ({ received: t.received + r.receivedValue, used: t.used + r.usedValue, waste: t.waste + r.wasteValue, other: t.other + r.otherValue }),
    { received: 0, used: 0, waste: 0, other: 0 }
  );
  const lastCount = new Map<string, string>();
  for (const c of lastCountsRes.data ?? []) if (!lastCount.has(c.branch_id)) lastCount.set(c.branch_id, c.created_at);

  const qs = (patch: Record<string, string>) => "?" + new URLSearchParams({ ...(branchId ? { branch: branchId } : {}), month, ...patch }).toString();

  return (
    <div>
      <Link href="/inventory" className="text-sm text-neutral-500 hover:text-neutral-900">← Kho</Link>
      <h1 className="mb-4 mt-2 text-2xl font-bold tracking-tight">Tiêu hao nguyên liệu</h1>
      <InventoryNav active="usage" isManager isAdmin={isAdmin(me.role)} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center rounded-lg border border-neutral-200 bg-white text-sm">
          <Link href={qs({ month: prevMonth })} className="px-3 py-2 hover:bg-neutral-50" aria-label="Tháng trước">‹</Link>
          <span className="px-2 font-semibold tabular-nums">Tháng {m}/{y}</span>
          <Link href={qs({ month: nextMonth })} className="px-3 py-2 hover:bg-neutral-50" aria-label="Tháng sau">›</Link>
        </div>
      </div>
      <BranchChips branches={branches} branchId={branchId} allowAll href={(id) => `?${new URLSearchParams({ ...(id ? { branch: id } : {}), month })}`} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card p-4">
          <p className="text-xs text-neutral-500">Nhập trong tháng</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{formatMoney(total.received)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-neutral-500">Đã dùng (theo kiểm kê)</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{formatMoney(total.used)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-neutral-500">Hủy hàng</p>
          <p className={`mt-1 text-xl font-bold tabular-nums ${total.waste > 0 ? "text-red-700" : ""}`}>{formatMoney(total.waste)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-neutral-500">Xuất khác / chuyển đi</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{formatMoney(total.other)}</p>
        </div>
      </div>

      <p className="mb-4 text-xs text-neutral-500">
        &quot;Đã dùng&quot; chỉ có số khi kiểm kê: = tồn trên sổ − tồn đếm được, ghi vào tháng của lần đếm. Kiểm kê càng đều thì số càng sát.
        {scope.map((id) => {
          const name = branches.find((b) => b.id === id)?.name;
          const last = lastCount.get(id);
          return (
            <span key={id} className="block">
              {name}: {last ? `kiểm kê gần nhất ${formatDateTime(last)}` : "chưa kiểm kê lần nào"}
            </span>
          );
        })}
      </p>

      {list.length === 0 ? (
        <p className="card p-8 text-center text-neutral-500">Tháng này chưa có nhập, kiểm kê hay xuất kho nào.</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
              <tr>
                <th className="px-4 py-2 font-medium">Nguyên liệu</th>
                <th className="px-3 py-2 text-right font-medium">Nhập</th>
                <th className="px-3 py-2 text-right font-medium">Đã dùng</th>
                <th className="px-3 py-2 text-right font-medium">Hủy hàng</th>
                <th className="px-3 py-2 text-right font-medium">Xuất khác</th>
                <th className="px-4 py-2 text-right font-medium">Giá trị dùng + hủy</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {list.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2.5">
                    <span className="font-medium">{r.name}</span>
                    <span className="block text-xs text-neutral-500">{r.category}</span>
                  </td>
                  <Cell qty={r.receivedQty} unit={r.unit} />
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {r.usedQty ? `${formatQty(r.usedQty)} ${r.unit}` : "—"}
                    {r.surplusQty > 0 && <span className="block text-xs text-sky-700">dư {formatQty(r.surplusQty)}</span>}
                  </td>
                  <Cell qty={r.wasteQty} unit={r.unit} danger />
                  <Cell qty={r.otherQty} unit={r.unit} />
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{formatMoney(r.usedValue + r.wasteValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Cell({ qty, unit, danger = false }: { qty: number; unit: string; danger?: boolean }) {
  return (
    <td className={`px-3 py-2.5 text-right tabular-nums ${danger && qty > 0 ? "text-red-700" : ""}`}>
      {qty ? `${formatQty(qty)} ${unit}` : "—"}
    </td>
  );
}
