// Realtime: trang nào cần tải lại khi bảng nào thay đổi.
// Nguyên tắc: liệt kê MỌI bảng mà trang (và các phép tính của nó, VD bảng lương) đọc tới.
// Thêm trang / bảng mới → cập nhật ở đây (và thêm bảng vào publication supabase_realtime).

export type LiveTable =
  | "app_settings"
  | "attendance_corrections"
  | "attendance_records"
  | "branches"
  | "employee_branches"
  | "employees"
  | "inventory_aliases"
  | "inventory_item_units"
  | "inventory_items"
  | "invoice_scans"
  | "notifications"
  | "payroll_adjustments"
  | "payroll_profiles"
  | "payroll_settings"
  | "payslips"
  | "salary_advances"
  | "schedule_requests"
  | "schedule_settings"
  | "shift_registrations"
  | "shift_templates"
  | "shifts"
  | "stock_balances"
  | "stock_count_lines"
  | "stock_counts"
  | "stock_issue_lines"
  | "stock_issues"
  | "stock_movements"
  | "stock_receipt_lines"
  | "stock_receipts"
  | "supplier_payments"
  | "suppliers"
  | "task_instances"
  | "task_sets"
  | "task_templates";

const STAFF: LiveTable[] = ["employees", "employee_branches", "branches"];
const SCHEDULE: LiveTable[] = ["shifts", "shift_templates", "schedule_requests", "schedule_settings", "shift_registrations"];
const INVENTORY: LiveTable[] = [
  "inventory_items",
  "inventory_item_units",
  "inventory_aliases",
  "stock_balances",
  "stock_movements",
  "stock_receipts",
  "stock_receipt_lines",
  "stock_counts",
  "stock_count_lines",
  "stock_issues",
  "stock_issue_lines",
  "suppliers",
  "supplier_payments",
  "invoice_scans",
];
const PAYROLL: LiveTable[] = [
  "payroll_profiles",
  "payroll_settings",
  "payroll_adjustments",
  "payslips",
  "salary_advances",
  // Bảng lương tính từ chấm công, checklist, lịch & đơn xin phép
  "attendance_records",
  "attendance_corrections",
  "task_instances",
  "shifts",
  "schedule_requests",
];

/** Tiền tố đường dẫn → bảng cần theo dõi (khớp tiền tố dài nhất) */
const ROUTES: [prefix: string, tables: LiveTable[]][] = [
  ["/checklist", ["task_instances", "task_templates", "task_sets", "shifts", "attendance_records", ...STAFF]],
  ["/attendance", ["attendance_records", "attendance_corrections", "shifts", ...STAFF]],
  ["/schedule", [...SCHEDULE, "attendance_records", ...STAFF]],
  ["/employees", [...STAFF, "payroll_profiles"]],
  ["/branches", STAFF],
  ["/inventory", [...INVENTORY, ...STAFF]],
  ["/payroll", [...PAYROLL, ...STAFF]],
  ["/payslips", ["payslips", "salary_advances", "payroll_adjustments", "payroll_profiles"]],
  ["/notifications", ["notifications"]],
  ["/account", ["employees", "employee_branches"]],
];

/** Trang chủ (Tổng quan) */
const HOME: LiveTable[] = [
  "task_instances",
  "attendance_records",
  "attendance_corrections",
  "salary_advances",
  "stock_balances",
  "stock_receipts",
  "supplier_payments",
  "inventory_items",
  ...SCHEDULE,
  ...STAFF,
];

/** Thương hiệu (logo, màu) hiển thị ở mọi trang */
const EVERYWHERE: LiveTable[] = ["app_settings"];

export function liveTablesFor(pathname: string): LiveTable[] {
  if (pathname === "/") return [...new Set([...HOME, ...EVERYWHERE])].sort();
  const match = ROUTES.filter(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`)).sort(
    (a, b) => b[0].length - a[0].length
  )[0];
  return [...new Set([...(match?.[1] ?? []), ...EVERYWHERE])].sort();
}
