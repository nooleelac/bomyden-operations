import { requireManager } from "@/lib/auth/session";
import { getManageableBranches } from "@/lib/branches";
import { createClient } from "@/lib/supabase/server";
import { addSheet, createWorkbook, excelResponse } from "@/lib/excel";
import { paymentBadge } from "@/lib/inventory";
import { vnDateString } from "@/lib/time";

/** Xuất công nợ nhà cung cấp hiện tại: tổng theo NCC + từng phiếu còn nợ */
export async function GET() {
  const me = await requireManager();
  const branches = await getManageableBranches(me);
  const today = vnDateString();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stock_receipts")
    .select(
      "id, invoice_number, invoice_date, due_date, total_amount, paid_amount, debt_amount, status, branch:branches(name), supplier:suppliers(id, name, phone, payment_terms_days)"
    )
    .eq("status", "posted")
    .gt("debt_amount", 0)
    .in("branch_id", branches.map((b) => b.id))
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("invoice_date");
  if (error) return new Response("Không tải được công nợ.", { status: 500 });

  const receipts = (data ?? []).map((r) => {
    const badge = paymentBadge(r, today);
    const daysOverdue =
      badge.overdue && r.due_date ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${r.due_date}T00:00:00Z`)) / 86_400_000) : 0;
    return { ...r, badge, daysOverdue };
  });

  type Summary = { name: string; phone: string | null; terms: number | null; count: number; total: number; paid: number; debt: number; overdue: number; oldestDue: string | null };
  const bySupplier = new Map<string, Summary>();
  for (const r of receipts) {
    const key = r.supplier?.id ?? "none";
    const s = bySupplier.get(key) ?? {
      name: r.supplier?.name ?? "Không rõ nhà cung cấp",
      phone: r.supplier?.phone ?? null,
      terms: r.supplier?.payment_terms_days ?? null,
      count: 0, total: 0, paid: 0, debt: 0, overdue: 0, oldestDue: null,
    };
    s.count += 1;
    s.total += Number(r.total_amount);
    s.paid += Number(r.paid_amount);
    s.debt += Number(r.debt_amount ?? 0);
    if (r.badge.overdue) s.overdue += Number(r.debt_amount ?? 0);
    if (r.due_date && (!s.oldestDue || r.due_date < s.oldestDue)) s.oldestDue = r.due_date;
    bySupplier.set(key, s);
  }
  const summaries = [...bySupplier.values()].sort((a, b) => b.debt - a.debt);
  const stamp = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });

  const workbook = createWorkbook();
  addSheet(
    workbook,
    "Theo nhà cung cấp",
    [
      { header: "Nhà cung cấp", width: 30, value: (s) => s.name },
      { header: "SĐT", width: 14, value: (s) => s.phone },
      { header: "Số ngày được nợ", type: "int", width: 12, value: (s) => s.terms },
      { header: "Số phiếu còn nợ", type: "int", width: 12, total: true, value: (s) => s.count },
      { header: "Tổng tiền các phiếu", type: "money", width: 18, total: true, value: (s) => s.total },
      { header: "Đã trả", type: "money", width: 15, total: true, value: (s) => s.paid },
      { header: "Còn nợ", type: "money", width: 15, total: true, value: (s) => s.debt },
      { header: "Trong đó quá hạn", type: "money", width: 16, total: true, value: (s) => s.overdue },
      { header: "Hạn sớm nhất", type: "date", width: 13, value: (s) => s.oldestDue },
    ],
    summaries,
    { title: "CÔNG NỢ NHÀ CUNG CẤP", subtitle: `Tính đến ${stamp}` }
  );

  addSheet(
    workbook,
    "Phiếu còn nợ",
    [
      { header: "Nhà cung cấp", width: 28, value: (r) => r.supplier?.name ?? "Không rõ" },
      { header: "Chi nhánh", width: 18, value: (r) => r.branch?.name },
      { header: "Số HĐ", width: 16, value: (r) => r.invoice_number },
      { header: "Ngày HĐ", type: "date", width: 12, value: (r) => r.invoice_date },
      { header: "Hạn thanh toán", type: "date", width: 14, value: (r) => r.due_date },
      { header: "Tổng thanh toán", type: "money", width: 16, total: true, value: (r) => r.total_amount },
      { header: "Đã trả", type: "money", width: 15, total: true, value: (r) => r.paid_amount },
      { header: "Còn nợ", type: "money", width: 15, total: true, value: (r) => r.debt_amount },
      { header: "Tình trạng", width: 13, value: (r) => r.badge.label },
      { header: "Số ngày quá hạn", type: "int", width: 13, value: (r) => r.daysOverdue || null },
    ],
    receipts,
    { title: "CÁC PHIẾU NHẬP CÒN NỢ", subtitle: `Tính đến ${stamp}` }
  );

  return excelResponse(workbook, `Công nợ NCC ${today}.xlsx`);
}
