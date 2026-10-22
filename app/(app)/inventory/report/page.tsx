import type { Metadata } from "next";
import Link from "next/link";
import { requireManager } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/roles";
import { getManageableBranches } from "@/lib/branches";
import { createClient } from "@/lib/supabase/server";
import { loadLastPrices } from "@/lib/inventory-data";
import { formatMoney, formatMoneyCompact } from "@/lib/inventory";
import { formatDateTime, vnDateString, vnDayRange } from "@/lib/time";
import { getRequestTime } from "@/lib/request-time";
import { ActionList, SectionCard, StatTile, type ActionItem } from "../../_overview/ui";
import InventoryNav from "../InventoryNav";
import BranchChips from "../BranchChips";

export const metadata: Metadata = { title: "Báo cáo kho" };
export const instant = false;

/** Số ngày không kiểm kê thì nhắc */
const COUNT_STALE_DAYS = 7;

type Bar = { key: string; label: string; value: number; sub?: string };

/** Báo cáo tổng quan Kho theo tháng: giá trị tồn, nhập, dùng/hủy, công nợ, nhà cung cấp, cảnh báo. */
export default async function InventoryReportPage({ searchParams }: PageProps<"/inventory/report">) {
  const me = await requireManager();
  const params = await searchParams;
  const branches = await getManageableBranches(me);
  const branchId = typeof params.branch === "string" && branches.some((b) => b.id === params.branch) ? params.branch : "";
  const scope = branchId ? [branchId] : branches.map((b) => b.id);

  const today = vnDateString();
  const month = typeof params.month === "string" && /^\d{4}-\d{2}$/.test(params.month) ? params.month : today.slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const from = `${month}-01`;
  const to = vnDateString(new Date(Date.UTC(y, m, 1)));
  const prevFrom = vnDateString(new Date(Date.UTC(y, m - 2, 1)));
  const prevMonth = prevFrom.slice(0, 7);
  const nextMonth = to.slice(0, 7);
  const start = vnDayRange(from).start;
  const end = vnDayRange(to).start;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const isCurrentMonth = month === today.slice(0, 7);

  const supabase = await createClient();
  const [receiptsRes, prevReceiptsRes, issuesRes, countsRes, lastCountsRes, balancesRes, debtRes, lastPrices] = await Promise.all([
    supabase
      .from("stock_receipts")
      .select("invoice_date, total_amount, supplier:suppliers(id, name), stock_receipt_lines(amount, vat_amount, item:inventory_items(category))")
      .eq("status", "posted")
      .in("branch_id", scope)
      .gte("invoice_date", from)
      .lt("invoice_date", to),
    supabase
      .from("stock_receipts")
      .select("total_amount")
      .eq("status", "posted")
      .in("branch_id", scope)
      .gte("invoice_date", prevFrom)
      .lt("invoice_date", from),
    supabase
      .from("stock_issues")
      .select("kind, to_branch_id, total_value")
      .eq("status", "posted")
      .in("branch_id", scope)
      .gte("created_at", start)
      .lt("created_at", end),
    supabase.from("stock_counts").select("used_value, surplus_value").in("branch_id", scope).gte("created_at", start).lt("created_at", end),
    supabase.from("stock_counts").select("branch_id, created_at").in("branch_id", scope).order("created_at", { ascending: false }).limit(50),
    supabase
      .from("stock_balances")
      .select("item_id, quantity, min_quantity, item:inventory_items!inner(category, is_active)")
      .eq("item.is_active", true)
      .in("branch_id", scope),
    supabase.from("stock_receipts").select("debt_amount, due_date").eq("status", "posted").gt("debt_amount", 0).in("branch_id", scope),
    loadLastPrices(),
  ]);
  if (receiptsRes.error || issuesRes.error || countsRes.error || balancesRes.error || debtRes.error) {
    throw new Error("Không tải được báo cáo kho.");
  }

  // ---------- Nhập hàng ----------
  const byDay = new Array<number>(daysInMonth).fill(0);
  const byCategory = new Map<string, number>();
  const bySupplier = new Map<string, { name: string; value: number; count: number }>();
  let received = 0;
  for (const r of receiptsRes.data) {
    const total = Number(r.total_amount);
    received += total;
    byDay[Number(r.invoice_date.slice(8, 10)) - 1] += total;
    const key = r.supplier?.id ?? "none";
    const s = bySupplier.get(key) ?? { name: r.supplier?.name ?? "Không rõ nhà cung cấp", value: 0, count: 0 };
    s.value += total;
    s.count += 1;
    bySupplier.set(key, s);
    for (const l of r.stock_receipt_lines) {
      const cat = l.item?.category ?? "Khác";
      byCategory.set(cat, (byCategory.get(cat) ?? 0) + Number(l.amount) + Number(l.vat_amount));
    }
  }
  const prevReceived = (prevReceiptsRes.data ?? []).reduce((t, r) => t + Number(r.total_amount), 0);
  const receivedChange = prevReceived > 0 ? ((received - prevReceived) / prevReceived) * 100 : null;

  // ---------- Dùng / hủy / xuất ----------
  const used = countsRes.data.reduce((t, c) => t + Number(c.used_value), 0);
  const scopeSet = new Set(scope);
  let waste = 0;
  let other = 0;
  for (const i of issuesRes.data) {
    // Chuyển giữa 2 chi nhánh cùng trong phạm vi xem: không tính là xuất
    if (i.kind === "transfer" && i.to_branch_id && scopeSet.has(i.to_branch_id)) continue;
    if (i.kind === "waste") waste += Number(i.total_value);
    else other += Number(i.total_value);
  }
  const wastePct = used + waste > 0 ? (waste / (used + waste)) * 100 : 0;

  // ---------- Tồn kho hiện tại ----------
  const stockByCategory = new Map<string, number>();
  let stockValue = 0;
  let unpriced = 0;
  let lowCount = 0;
  let outCount = 0;
  for (const b of balancesRes.data) {
    const qty = Number(b.quantity);
    if (b.min_quantity != null) {
      if (qty <= 0) outCount++;
      else if (qty < Number(b.min_quantity)) lowCount++;
    }
    if (qty <= 0) continue;
    const price = lastPrices[b.item_id]?.price;
    if (price == null) {
      unpriced++;
      continue;
    }
    stockValue += qty * price;
    stockByCategory.set(b.item.category, (stockByCategory.get(b.item.category) ?? 0) + qty * price);
  }

  // ---------- Công nợ ----------
  let debt = 0;
  let overdue = 0;
  let overdueCount = 0;
  for (const r of debtRes.data) {
    const d = Number(r.debt_amount ?? 0);
    debt += d;
    if (r.due_date && r.due_date < today) {
      overdue += d;
      overdueCount++;
    }
  }

  // ---------- Kiểm kê ----------
  const lastCount = new Map<string, string>();
  for (const c of lastCountsRes.data ?? []) if (!lastCount.has(c.branch_id)) lastCount.set(c.branch_id, c.created_at);
  const staleBefore = getRequestTime() -COUNT_STALE_DAYS * 86_400_000;
  const staleBranches = scope.filter((id) => {
    const last = lastCount.get(id);
    return !last || Date.parse(last) < staleBefore;
  });

  const stockHref = scope.length === 1 ? `/inventory?branch=${scope[0]}` : "/inventory";
  const actions: ActionItem[] = [
    { key: "out", icon: "🚫", text: "Hết hàng (đã đặt mức tối thiểu)", href: `${stockHref}${stockHref.includes("?") ? "&" : "?"}low=1`, tone: "bad", count: outCount },
    { key: "low", icon: "📉", text: "Dưới mức tối thiểu", href: `${stockHref}${stockHref.includes("?") ? "&" : "?"}low=1`, tone: "warn", count: lowCount },
    {
      key: "overdue",
      icon: "⏰",
      text: "Phiếu nhập quá hạn thanh toán",
      detail: formatMoney(overdue),
      href: "/inventory/debts",
      tone: "bad",
      count: overdueCount,
    },
    {
      key: "count",
      icon: "🔢",
      text: `Chi nhánh chưa kiểm kê ${COUNT_STALE_DAYS} ngày qua`,
      detail: staleBranches.map((id) => branches.find((b) => b.id === id)?.name).join(", "),
      href: "/inventory/counts",
      tone: "warn",
      count: staleBranches.length,
    },
  ];

  const toBars = (map: Map<string, number>): Bar[] =>
    [...map.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ key: k, label: k, value: v }));
  const suppliers: Bar[] = [...bySupplier.entries()]
    .sort((a, b) => b[1].value - a[1].value)
    .slice(0, 6)
    .map(([k, s]) => ({ key: k, label: s.name, value: s.value, sub: `${s.count} phiếu` }));

  const qs = (patch: Record<string, string>) => "?" + new URLSearchParams({ ...(branchId ? { branch: branchId } : {}), month, ...patch }).toString();
  const monthQs = (b: string) => `?${new URLSearchParams({ ...(b ? { branch: b } : {}), month })}`;

  return (
    <div>
      <Link href="/inventory" className="text-sm text-neutral-500 hover:text-neutral-900">← Kho</Link>
      <h1 className="mb-4 mt-2 text-2xl font-bold tracking-tight">Báo cáo kho</h1>
      <InventoryNav active="report" isManager isAdmin={isAdmin(me.role)} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center rounded-lg border border-neutral-200 bg-white text-sm">
          <Link href={qs({ month: prevMonth })} className="px-3 py-2 hover:bg-neutral-50" aria-label="Tháng trước">‹</Link>
          <span className="px-2 font-semibold tabular-nums">Tháng {m}/{y}</span>
          <Link href={qs({ month: nextMonth })} className="px-3 py-2 hover:bg-neutral-50" aria-label="Tháng sau">›</Link>
        </div>
      </div>
      <BranchChips branches={branches} branchId={branchId} allowAll href={monthQs} />

      {branches.length === 0 ? (
        <p className="alert-info">Bạn chưa được gán chi nhánh nào.</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label="Giá trị tồn hiện tại"
              value={formatMoneyCompact(stockValue)}
              sub={unpriced > 0 ? `Theo giá nhập gần nhất · ${unpriced} mặt hàng chưa có giá` : "Theo giá nhập gần nhất"}
              href={stockHref}
            />
            <StatTile
              label="Nhập trong tháng"
              value={formatMoneyCompact(received)}
              sub={
                receivedChange == null
                  ? `${receiptsRes.data.length} phiếu`
                  : Math.abs(receivedChange) > 300
                    ? // Tháng trước quá ít (VD mới bắt đầu dùng app) → % vô nghĩa, ghi thẳng số tiền
                      `${receiptsRes.data.length} phiếu · tháng trước ${formatMoneyCompact(prevReceived)}`
                    : `${receiptsRes.data.length} phiếu · ${receivedChange >= 0 ? "▲" : "▼"} ${Math.abs(Math.round(receivedChange))}% so tháng trước`
              }
              href="/inventory/receipts"
            />
            <StatTile
              label="Đã dùng + hủy"
              value={formatMoneyCompact(used + waste)}
              sub={waste > 0 ? `Hủy ${formatMoneyCompact(waste)} (${Math.round(wastePct)}%)` : "Không có hàng hủy"}
              tone={wastePct >= 10 ? "warn" : "neutral"}
              href={`/inventory/usage${qs({})}`}
            />
            <StatTile
              label="Công nợ NCC"
              value={formatMoneyCompact(debt)}
              sub={overdue > 0 ? `Quá hạn ${formatMoneyCompact(overdue)}` : "Không có khoản quá hạn"}
              tone={overdue > 0 ? "bad" : "neutral"}
              href="/inventory/debts"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title="Cần chú ý">
              <ActionList items={actions} emptyText="Kho đang ổn, không có gì cần xử lý." />
            </SectionCard>
            <SectionCard title={`Dòng tiền kho tháng ${m}/${y}`}>
              <dl className="divide-y divide-neutral-100 text-sm">
                <Line label="Nhập hàng (sau VAT)" value={received} />
                <Line label="Đã dùng (theo kiểm kê)" value={used} />
                <Line label="Hủy hàng" value={waste} danger />
                <Line label="Xuất khác / chuyển đi" value={other} />
                <Line label="Dư khi kiểm kê" value={countsRes.data.reduce((t, c) => t + Number(c.surplus_value), 0)} />
              </dl>
            </SectionCard>
          </div>

          <SectionCard title="Nhập hàng theo ngày" action={{ href: "/inventory/receipts", label: "Phiếu nhập" }}>
            <DailyBars values={byDay} todayIndex={isCurrentMonth ? Number(today.slice(8, 10)) - 1 : -1} month={m} />
          </SectionCard>

          <div className="grid gap-4 lg:grid-cols-3">
            <SectionCard title="Nhập theo nhóm hàng">
              <HBars bars={toBars(byCategory)} empty="Tháng này chưa nhập hàng." />
            </SectionCard>
            <SectionCard title="Nhà cung cấp lớn nhất" action={{ href: "/inventory/suppliers", label: "Tất cả" }}>
              <HBars bars={suppliers} empty="Tháng này chưa nhập hàng." />
            </SectionCard>
            <SectionCard title="Giá trị tồn theo nhóm">
              <HBars bars={toBars(stockByCategory)} empty="Chưa có hàng tồn có giá." />
            </SectionCard>
          </div>

          <p className="text-xs text-neutral-500">
            &quot;Đã dùng&quot; chỉ có số khi kiểm kê (tồn trên sổ − tồn đếm được). Giá trị tồn tính theo giá nhập gần nhất sau VAT, là số ước tính.
            {scope.map((id) => {
              const last = lastCount.get(id);
              return (
                <span key={id} className="block">
                  {branches.find((b) => b.id === id)?.name}: {last ? `kiểm kê gần nhất ${formatDateTime(last)}` : "chưa kiểm kê lần nào"}
                </span>
              );
            })}
          </p>
        </div>
      )}
    </div>
  );
}

function Line({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <dt className="text-neutral-600">{label}</dt>
      <dd className={`font-semibold tabular-nums ${danger && value > 0 ? "text-red-700" : ""}`}>{formatMoney(value)}</dd>
    </div>
  );
}

/** Cột giá trị nhập từng ngày trong tháng (rê chuột / chạm để xem số). */
function DailyBars({ values, todayIndex, month }: { values: number[]; todayIndex: number; month: number }) {
  const max = Math.max(...values);
  if (max <= 0) return <p className="px-4 py-6 text-center text-sm text-neutral-500">Tháng này chưa nhập hàng.</p>;
  return (
    <div className="px-4 pb-3 pt-4">
      <p className="mb-2 text-xs text-neutral-500">Cao nhất {formatMoney(max)}/ngày</p>
      <div className="flex h-36 items-end gap-0.5 border-b border-neutral-200 sm:gap-1">
        {values.map((v, i) => (
          <div
            key={i}
            className="group relative flex h-full flex-1 items-end"
            title={`${i + 1}/${month}: ${formatMoney(v)}`}
            aria-label={`Ngày ${i + 1}/${month}: ${formatMoney(v)}`}
            role="img"
          >
            <div
              className={`w-full rounded-t-[4px] transition group-hover:brightness-125 ${i === todayIndex ? "bg-brand" : "bg-brand/60"}`}
              style={{ height: v > 0 ? `max(2px, ${(v / max) * 100}%)` : 0 }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-neutral-400">
        <span>1</span>
        <span>{Math.ceil(values.length / 2)}</span>
        <span>{values.length}</span>
      </div>
    </div>
  );
}

/** Thanh ngang theo tỉ lệ so với mục lớn nhất. */
function HBars({ bars, empty }: { bars: Bar[]; empty: string }) {
  if (bars.length === 0) return <p className="px-4 py-6 text-center text-sm text-neutral-500">{empty}</p>;
  const max = bars[0].value;
  const total = bars.reduce((t, b) => t + b.value, 0);
  return (
    <ul className="space-y-3 px-4 py-4">
      {bars.map((b) => (
        <li key={b.key} title={`${b.label}: ${formatMoney(b.value)}`}>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="min-w-0 truncate font-medium">{b.label}</span>
            <span className="shrink-0 tabular-nums">{formatMoneyCompact(b.value)}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-100" aria-hidden="true">
            <div className="h-full rounded-full bg-brand" style={{ width: `${(b.value / max) * 100}%` }} />
          </div>
          <p className="mt-0.5 text-xs text-neutral-500">
            {b.value / total < 0.01 ? "<1" : Math.round((b.value / total) * 100)}%{b.sub ? ` · ${b.sub}` : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}
