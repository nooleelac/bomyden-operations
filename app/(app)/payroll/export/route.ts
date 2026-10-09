import type { NextRequest } from "next/server";
import { requirePayrollAccess } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { addSheet, createWorkbook, excelResponse } from "@/lib/excel";
import { PAY_TYPE_LABELS, isValidPeriodStart, periodLabel, periodStartOf, type PayrollOverview } from "@/lib/payroll";
import { vnDateString } from "@/lib/time";
import type { EmployeeRole, PayPeriod } from "@/lib/database.types";

/** Xuất bảng lương 1 kỳ (cùng dữ liệu với trang Bảng lương): sheet tổng + sheet các khoản chi tiết */
export async function GET(request: NextRequest) {
  await requirePayrollAccess();
  const params = request.nextUrl.searchParams;
  const period: PayPeriod = params.get("period") === "weekly" ? "weekly" : "monthly";
  const startParam = params.get("start");
  const start = isValidPeriodStart(period, startParam) ? startParam : periodStartOf(period, vnDateString());

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("payroll_overview", { p_period: period, p_period_start: start });
  if (error) return new Response("Không tải được bảng lương.", { status: 500 });
  const overview = data as unknown as PayrollOverview;
  const label = periodLabel(period, start);
  const workbook = createWorkbook();

  addSheet(
    workbook,
    "Bảng lương",
    [
      { header: "Nhân viên", width: 24, value: (i) => i.full_name },
      { header: "Chức vụ", width: 13, value: (i) => ROLE_LABELS[i.role as EmployeeRole] ?? i.role },
      { header: "Kiểu lương", width: 13, value: (i) => PAY_TYPE_LABELS[i.pay_type] },
      { header: "Ngày công", type: "int", width: 10, total: true, value: (i) => i.work_days },
      { header: "Số ca", type: "int", width: 8, total: true, value: (i) => i.shifts },
      { header: "Giờ công", type: "hours", width: 10, total: true, value: (i) => i.worked_minutes / 60 },
      { header: "Giờ tăng ca", type: "hours", width: 10, total: true, value: (i) => i.overtime_minutes / 60 },
      { header: "Đi trễ (lần)", type: "int", width: 10, value: (i) => i.late_count },
      { header: "Về sớm (lần)", type: "int", width: 11, value: (i) => i.early_count ?? null },
      { header: "Nghỉ không phép", type: "int", width: 12, value: (i) => i.absent_count ?? null },
      { header: "Nghỉ có lương (ngày)", type: "qty", width: 13, value: (i) => i.paid_leave_days ?? null },
      { header: "Tổng thu nhập", type: "money", width: 16, total: true, value: (i) => i.gross_amount },
      { header: "Khấu trừ", type: "money", width: 14, total: true, value: (i) => i.deductions_amount },
      { header: "Thực nhận", type: "money", width: 16, total: true, value: (i) => i.net_amount },
      { header: "Trạng thái", width: 11, value: (i) => (i.finalized ? "Đã chốt" : "Tạm tính") },
      { header: "Cảnh báo", width: 40, value: (i) => i.warnings.map((w) => w.message).join(" · ") },
    ],
    overview.items,
    {
      title: `BẢNG LƯƠNG ${label.toUpperCase()}`,
      subtitle: `${overview.items.filter((i) => i.finalized).length}/${overview.items.length} nhân viên đã chốt. Số "Tạm tính" có thể còn thay đổi.`,
    }
  );

  const lines = overview.items.flatMap((i) => i.lines.map((line) => ({ employee: i.full_name, line })));
  addSheet(
    workbook,
    "Chi tiết các khoản",
    [
      { header: "Nhân viên", width: 24, value: (r) => r.employee },
      { header: "Khoản", width: 30, value: (r) => r.line.label },
      { header: "Số lượng", type: "qty", width: 10, value: (r) => r.line.quantity },
      { header: "Đơn giá", type: "money", width: 13, value: (r) => r.line.unit_amount },
      { header: "Thành tiền", type: "money", width: 15, value: (r) => r.line.amount },
      { header: "Ghi chú", width: 40, value: (r) => r.line.detail },
    ],
    lines,
    { title: `CHI TIẾT LƯƠNG ${label.toUpperCase()}`, subtitle: "Khoản trừ mang số âm." }
  );

  return excelResponse(workbook, `Bảng lương ${start}.xlsx`);
}
