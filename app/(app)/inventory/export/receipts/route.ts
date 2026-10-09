import type { NextRequest } from "next/server";
import { requireInventoryAccess } from "@/lib/auth/session";
import { getInventoryBranches } from "@/lib/branches";
import { createClient } from "@/lib/supabase/server";
import { addSheet, createWorkbook, excelResponse, monthRange } from "@/lib/excel";
import { PAYMENT_METHOD_LABELS, paymentBadge } from "@/lib/inventory";
import { vnDateString } from "@/lib/time";

/** Xuất phiếu nhập kho trong 1 tháng: sheet theo phiếu + sheet chi tiết từng dòng hàng + sheet thanh toán */
export async function GET(request: NextRequest) {
  const me = await requireInventoryAccess();
  const params = request.nextUrl.searchParams;
  const today = vnDateString();
  const { month, from, to } = monthRange(params.get("month"), today);
  const branches = await getInventoryBranches(me);
  const branchParam = params.get("branch");
  const branchIds = branchParam && branches.some((b) => b.id === branchParam) ? [branchParam] : branches.map((b) => b.id);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stock_receipts")
    .select(
      "id, invoice_number, invoice_date, subtotal, vat_amount, total_amount, invoice_total, paid_amount, debt_amount, due_date, status, note, created_at, cancel_reason, branch:branches(name), supplier:suppliers(name), creator:employees!stock_receipts_created_by_fkey(full_name), stock_receipt_lines(line_no, raw_name, quantity, unit_name, factor, base_quantity, unit_price, amount, vat_rate, vat_amount, item:inventory_items(name, category, base_unit)), supplier_payments(amount, paid_on, method, note, voided_at, creator:employees!supplier_payments_created_by_fkey(full_name))"
    )
    .gte("invoice_date", from)
    .lt("invoice_date", to)
    .in("branch_id", branchIds)
    .order("invoice_date")
    .order("created_at");
  if (error) return new Response("Không tải được dữ liệu phiếu nhập.", { status: 500 });

  const receipts = (data ?? []).map((r) => ({ ...r, badge: paymentBadge(r, today) }));
  const posted = receipts.filter((r) => r.status === "posted");
  const branchName = branchIds.length === 1 ? branches.find((b) => b.id === branchIds[0])?.name : "Tất cả chi nhánh";
  const [y, m] = month.split("-");
  const workbook = createWorkbook();

  addSheet(
    workbook,
    "Phiếu nhập",
    [
      { header: "Ngày HĐ", type: "date", width: 12, value: (r) => r.invoice_date },
      { header: "Chi nhánh", width: 18, value: (r) => r.branch?.name },
      { header: "Nhà cung cấp", width: 28, value: (r) => r.supplier?.name ?? "Không rõ" },
      { header: "Số HĐ", width: 16, value: (r) => r.invoice_number },
      { header: "Số mặt hàng", type: "int", width: 11, value: (r) => r.stock_receipt_lines.length },
      { header: "Tiền hàng (chưa VAT)", type: "money", width: 18, total: true, value: (r) => (r.status === "posted" ? r.subtotal : 0) },
      { header: "Tiền thuế VAT", type: "money", width: 15, total: true, value: (r) => (r.status === "posted" ? r.vat_amount : 0) },
      { header: "Tổng thanh toán", type: "money", width: 17, total: true, value: (r) => (r.status === "posted" ? r.total_amount : 0) },
      { header: "Tổng in trên HĐ", type: "money", width: 16, value: (r) => r.invoice_total },
      { header: "Đã trả", type: "money", width: 15, total: true, value: (r) => (r.status === "posted" ? r.paid_amount : 0) },
      { header: "Còn nợ", type: "money", width: 15, total: true, value: (r) => r.debt_amount },
      { header: "Hạn thanh toán", type: "date", width: 14, value: (r) => r.due_date },
      { header: "Tình trạng", width: 14, value: (r) => r.badge.label },
      { header: "Người nhập", width: 18, value: (r) => r.creator?.full_name },
      { header: "Ghi chú", width: 30, value: (r) => [r.note, r.cancel_reason ? `Lý do hủy: ${r.cancel_reason}` : null].filter(Boolean).join(" · ") },
    ],
    receipts,
    {
      title: `PHIẾU NHẬP KHO THÁNG ${m}/${y}`,
      subtitle: `${branchName} · ${posted.length} phiếu (không tính phiếu đã hủy vào tổng) · xuất lúc ${new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}`,
    }
  );

  const lines = posted.flatMap((r) =>
    [...r.stock_receipt_lines].sort((a, b) => a.line_no - b.line_no).map((l) => ({ receipt: r, line: l }))
  );
  addSheet(
    workbook,
    "Chi tiết hàng",
    [
      { header: "Ngày HĐ", type: "date", width: 12, value: ({ receipt }) => receipt.invoice_date },
      { header: "Chi nhánh", width: 18, value: ({ receipt }) => receipt.branch?.name },
      { header: "Nhà cung cấp", width: 26, value: ({ receipt }) => receipt.supplier?.name ?? "Không rõ" },
      { header: "Số HĐ", width: 14, value: ({ receipt }) => receipt.invoice_number },
      { header: "Nguyên liệu", width: 28, value: ({ line }) => line.item?.name },
      { header: "Nhóm", width: 12, value: ({ line }) => line.item?.category },
      { header: "Tên trên hóa đơn", width: 30, value: ({ line }) => line.raw_name },
      { header: "Số lượng", type: "qty", width: 10, value: ({ line }) => line.quantity },
      { header: "Đơn vị", width: 9, value: ({ line }) => line.unit_name },
      { header: "Đơn giá", type: "money", width: 13, value: ({ line }) => line.unit_price },
      { header: "Thành tiền (chưa VAT)", type: "money", width: 17, total: true, value: ({ line }) => line.amount },
      { header: "VAT %", type: "percent", width: 8, value: ({ line }) => line.vat_rate },
      { header: "Tiền VAT", type: "money", width: 13, total: true, value: ({ line }) => line.vat_amount },
      { header: "Thành tiền sau VAT", type: "money", width: 17, total: true, value: ({ line }) => Number(line.amount) + Number(line.vat_amount) },
      { header: "SL quy đổi kho", type: "qty", width: 13, value: ({ line }) => line.base_quantity },
      { header: "Đơn vị kho", width: 10, value: ({ line }) => line.item?.base_unit },
      {
        header: "Giá vốn / đv kho (sau VAT)",
        type: "money",
        width: 18,
        value: ({ line }) => (Number(line.base_quantity) > 0 ? (Number(line.amount) + Number(line.vat_amount)) / Number(line.base_quantity) : null),
      },
    ],
    lines,
    { title: `CHI TIẾT HÀNG NHẬP THÁNG ${m}/${y}`, subtitle: branchName }
  );

  const payments = receipts.flatMap((r) => r.supplier_payments.map((p) => ({ receipt: r, payment: p })));
  addSheet(
    workbook,
    "Thanh toán",
    [
      { header: "Ngày trả", type: "date", width: 12, value: ({ payment }) => payment.paid_on },
      { header: "Nhà cung cấp", width: 26, value: ({ receipt }) => receipt.supplier?.name ?? "Không rõ" },
      { header: "Số HĐ", width: 14, value: ({ receipt }) => receipt.invoice_number },
      { header: "Ngày HĐ", type: "date", width: 12, value: ({ receipt }) => receipt.invoice_date },
      { header: "Số tiền", type: "money", width: 15, total: true, value: ({ payment }) => (payment.voided_at ? 0 : payment.amount) },
      { header: "Hình thức", width: 13, value: ({ payment }) => PAYMENT_METHOD_LABELS[payment.method] },
      { header: "Người ghi", width: 18, value: ({ payment }) => payment.creator?.full_name },
      { header: "Ghi chú", width: 30, value: ({ payment }) => (payment.voided_at ? `ĐÃ HỦY. ${payment.note ?? ""}` : payment.note) },
    ],
    payments,
    { title: `THANH TOÁN CHO CÁC PHIẾU NHẬP THÁNG ${m}/${y}`, subtitle: branchName }
  );

  return excelResponse(workbook, `Phiếu nhập kho ${month}.xlsx`);
}
