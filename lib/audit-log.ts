// Nhật ký thao tác: diễn giải dòng audit_logs thành câu tiếng Việt + so sánh trước/sau.

import { ROLE_LABELS } from "@/lib/auth/roles";
import { ADJUSTMENT_KINDS, PAY_PERIOD_LABELS, PAY_TYPE_LABELS } from "@/lib/payroll";
import { REQUEST_KIND_LABELS, REQUEST_STATUS, SHIFT_STATUS } from "@/lib/schedule";
import { ISSUE_KIND_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/inventory";
import { PRIORITY_LABELS, WEEKDAY_LABELS } from "@/lib/checklist";
import { formatDateTime } from "@/lib/time";

export type AuditGroup = { key: string; label: string; tables: string[] };

/** Nhóm chức năng để lọc */
export const AUDIT_GROUPS: AuditGroup[] = [
  { key: "staff", label: "Nhân viên & chi nhánh", tables: ["employees", "employee_branches", "branches"] },
  { key: "attendance", label: "Chấm công", tables: ["attendance_records", "attendance_corrections"] },
  { key: "checklist", label: "Checklist", tables: ["task_templates", "task_sets", "task_instances"] },
  {
    key: "schedule",
    label: "Lịch & đơn",
    tables: ["shifts", "shift_templates", "shift_registrations", "schedule_requests", "schedule_settings"],
  },
  {
    key: "payroll",
    label: "Lương",
    tables: ["payroll_profiles", "payroll_settings", "payroll_adjustments", "payslips", "salary_advances"],
  },
  {
    key: "inventory",
    label: "Kho",
    tables: ["inventory_items", "inventory_item_units", "stock_receipts", "stock_counts", "stock_issues", "suppliers", "supplier_payments"],
  },
  { key: "settings", label: "Thương hiệu", tables: ["app_settings"] },
];

const TABLE_LABELS: Record<string, string> = {
  employees: "Nhân viên",
  employee_branches: "Chi nhánh của nhân viên",
  branches: "Chi nhánh",
  attendance_records: "Chấm công",
  attendance_corrections: "Yêu cầu sửa chấm công",
  task_templates: "Mẫu checklist",
  task_sets: "Bộ việc",
  task_instances: "Việc checklist",
  shifts: "Ca làm",
  shift_templates: "Mẫu ca",
  shift_registrations: "Đăng ký ca",
  schedule_requests: "Đơn xin phép",
  schedule_settings: "Cài đặt lịch & đơn",
  payroll_profiles: "Hồ sơ lương",
  payroll_settings: "Cài đặt lương chung",
  payroll_adjustments: "Thưởng / trừ lương",
  payslips: "Phiếu lương",
  salary_advances: "Đơn ứng lương",
  inventory_items: "Nguyên liệu",
  inventory_item_units: "Đơn vị quy đổi",
  stock_receipts: "Phiếu nhập kho",
  stock_counts: "Phiếu kiểm kê",
  stock_issues: "Phiếu xuất kho",
  suppliers: "Nhà cung cấp",
  supplier_payments: "Thanh toán nhà cung cấp",
  app_settings: "Thương hiệu",
};

export function tableLabel(table: string): string {
  return TABLE_LABELS[table] ?? table;
}

/** Tên trường (dùng chung mọi bảng; trường trùng tên có nghĩa giống nhau) */
const FIELD_LABELS: Record<string, string> = {
  full_name: "Họ tên",
  name: "Tên",
  title: "Tên việc",
  email: "Email",
  phone: "Số điện thoại",
  role: "Chức vụ",
  is_active: "Đang hoạt động",
  default_start_time: "Giờ vào ca mặc định",
  requires_attendance: "Phải chấm công",
  can_manage_payroll: "Quyền bảng lương",
  can_receive_stock: "Quyền nhập kho",
  self_schedule: "Tự đăng ký ca",
  address: "Địa chỉ",
  latitude: "Vĩ độ",
  longitude: "Kinh độ",
  radius_m: "Bán kính (m)",
  wifi_ips: "IP Wi-Fi",
  employee_id: "Nhân viên",
  branch_id: "Chi nhánh",
  to_branch_id: "Chuyển tới chi nhánh",
  check_in_at: "Giờ vào",
  check_out_at: "Giờ ra",
  check_in_method: "Cách vào ca",
  check_out_method: "Cách ra ca",
  is_corrected: "Đã sửa",
  correction_note: "Ghi chú sửa",
  requested_check_in_at: "Giờ vào xin sửa",
  requested_check_out_at: "Giờ ra xin sửa",
  applied_check_in_at: "Giờ vào đã áp",
  applied_check_out_at: "Giờ ra đã áp",
  reason: "Lý do",
  status: "Trạng thái",
  review_note: "Ghi chú duyệt",
  reviewed_by: "Người duyệt",
  description: "Mô tả",
  category: "Nhóm",
  priority: "Mức độ",
  start_time: "Giờ bắt đầu",
  due_time: "Hạn chót",
  end_time: "Giờ kết thúc",
  frequency: "Lặp lại",
  weekdays: "Thứ trong tuần",
  month_days: "Ngày trong tháng",
  requires_photo: "Bắt buộc ảnh",
  requires_note: "Bắt buộc ghi chú",
  primary_employee_id: "Người làm chính",
  backup_employee_id: "Người thay thế",
  assign_by_shift: "Giao theo ca",
  set_id: "Bộ việc",
  deleted_at: "Đã xóa lúc",
  task_date: "Ngày",
  completed_by: "Người làm",
  completed_at: "Làm lúc",
  note: "Ghi chú",
  reopen_reason: "Lý do mở lại",
  is_urgent: "Cần gấp",
  work_date: "Ngày làm",
  cancel_reason: "Lý do hủy",
  kind: "Loại",
  start_date: "Từ ngày",
  end_date: "Đến ngày",
  requested_time: "Giờ xin",
  target_employee_id: "Người nhận ca",
  is_paid: "Có lương",
  over_limit: "Vượt giới hạn",
  leave_notice_hours: "Báo trước khi nghỉ (giờ)",
  late_notice_hours: "Báo trước khi trễ (giờ)",
  early_notice_hours: "Báo trước khi về sớm (giờ)",
  swap_notice_hours: "Báo trước khi đổi ca (giờ)",
  leave_days_per_month: "Ngày nghỉ tối đa/tháng",
  late_per_month: "Lần trễ tối đa/tháng",
  early_per_month: "Lần về sớm tối đa/tháng",
  swap_per_month: "Lần đổi ca tối đa/tháng",
  register_deadline_days: "Hạn đăng ký ca (ngày)",
  pay_type: "Kiểu lương",
  pay_period: "Kỳ lương",
  hourly_rate: "Lương theo giờ",
  shift_rate: "Lương theo ca",
  fixed_salary: "Lương cố định",
  standard_days: "Ngày công chuẩn",
  overtime_enabled: "Tính tăng ca",
  overtime_threshold_minutes: "Tăng ca sau (phút/ngày)",
  overtime_rate: "Lương tăng ca/giờ",
  allowance_per_period: "Phụ cấp/kỳ",
  allowance_per_workday: "Phụ cấp/ngày công",
  late_grace_minutes: "Ân hạn trễ (phút)",
  late_penalty: "Phạt trễ/lần",
  early_grace_minutes: "Ân hạn về sớm (phút)",
  early_leave_penalty: "Phạt về sớm/lần",
  absent_penalty: "Phạt nghỉ không phép",
  checklist_failed_penalty: "Phạt checklist Không đạt",
  checklist_missed_penalty: "Phạt checklist Không làm",
  checklist_late_penalty: "Phạt checklist Làm trễ",
  can_view_payslip: "Xem phiếu lương",
  advance_max_percent: "Ứng tối đa (% lương)",
  period_start: "Kỳ lương từ",
  period_end: "Kỳ lương đến",
  amount: "Số tiền",
  gross_amount: "Tổng thu nhập",
  deductions_amount: "Tổng khấu trừ",
  net_amount: "Thực lĩnh",
  base_unit: "Đơn vị gốc",
  unit_name: "Đơn vị",
  factor: "Hệ số quy đổi",
  item_id: "Nguyên liệu",
  supplier_id: "Nhà cung cấp",
  invoice_number: "Số hóa đơn",
  invoice_date: "Ngày hóa đơn",
  invoice_total: "Tổng trên hóa đơn",
  subtotal: "Tiền hàng",
  vat_amount: "Tiền VAT",
  total_amount: "Tổng tiền",
  paid_amount: "Đã trả",
  debt_amount: "Còn nợ",
  due_date: "Hạn thanh toán",
  counted_on: "Ngày kiểm kê",
  line_count: "Số dòng",
  used_value: "Giá trị đã dùng",
  surplus_value: "Giá trị dư",
  issued_on: "Ngày xuất",
  total_value: "Tổng giá trị",
  paid_on: "Ngày trả",
  method: "Hình thức",
  void_reason: "Lý do hủy",
  payment_terms_days: "Hạn nợ (ngày)",
  brand_name: "Tên app",
  short_name: "Tên ngắn",
  tagline: "Khẩu hiệu",
  primary_color: "Màu chính",
  header_color: "Màu thanh tiêu đề",
  logo_path: "Logo",
  published_at: "Công bố lúc",
  reopened_at: "Mở lại lúc",
  cancelled_at: "Hủy lúc",
  voided_at: "Hủy lúc",
  deactivated_at: "Khóa lúc",
  urgent_resolved_at: "Đã xử lý gấp lúc",
  finalized_at: "Chốt lúc",
};

const FIELD_ORDER = Object.keys(FIELD_LABELS);
const byFieldOrder = (a: AuditChange, b: AuditChange) =>
  (FIELD_ORDER.indexOf(a.field) + 1 || 999) - (FIELD_ORDER.indexOf(b.field) + 1 || 999);

/** Trường kỹ thuật / tự sinh: không hiện khi so sánh */
const HIDDEN_FIELDS = new Set([
  "id",
  "auth_user_id",
  "created_at",
  "created_by",
  "updated_at",
  "updated_by",
  "sort_order",
  "deactivated_by",
  "reviewed_at",
  "cancelled_by",
  "voided_by",
  "reopened_by",
  "urgent_resolved_by",
  "last_corrected_by",
  "last_corrected_at",
  "finalized_by",
  "photo_path",
  "photo_purged_at",
  "scan_id",
  "data",
  "template_id",
  "shift_id",
  "target_shift_id",
  "attendance_id",
  "receipt_id",
  "start_at",
  "end_at",
  "peer_responded_at",
  "check_in_lat",
  "check_in_lng",
  "check_in_accuracy_m",
  "check_in_distance_m",
  "check_in_ip",
  "check_out_lat",
  "check_out_lng",
  "check_out_accuracy_m",
  "check_out_distance_m",
  "check_out_ip",
]);

const MONEY_FIELDS = new Set([
  "hourly_rate", "shift_rate", "fixed_salary", "overtime_rate", "allowance_per_period", "allowance_per_workday",
  "late_penalty", "early_leave_penalty", "absent_penalty", "checklist_failed_penalty", "checklist_missed_penalty",
  "checklist_late_penalty", "amount", "gross_amount", "deductions_amount", "net_amount", "invoice_total", "subtotal",
  "vat_amount", "total_amount", "paid_amount", "debt_amount", "used_value", "surplus_value", "total_value",
]);

/** Tên tra cứu cho các trường là mã (uuid) */
export type AuditRefs = {
  employees: Map<string, string>;
  branches: Map<string, string>;
  suppliers: Map<string, string>;
  taskSets: Map<string, string>;
  items: Map<string, string>;
};

const REF_FIELDS: Record<string, keyof AuditRefs> = {
  employee_id: "employees",
  primary_employee_id: "employees",
  backup_employee_id: "employees",
  target_employee_id: "employees",
  completed_by: "employees",
  reviewed_by: "employees",
  branch_id: "branches",
  to_branch_id: "branches",
  supplier_id: "suppliers",
  set_id: "taskSets",
  item_id: "items",
};

/** Các mã cần tra tên trong một loạt dòng nhật ký */
export function collectRefIds(rows: { old_data: unknown; new_data: unknown }[]) {
  const ids: Record<keyof AuditRefs, Set<string>> = {
    employees: new Set(),
    branches: new Set(),
    suppliers: new Set(),
    taskSets: new Set(),
    items: new Set(),
  };
  for (const row of rows) {
    for (const data of [row.old_data, row.new_data]) {
      if (!isObject(data)) continue;
      for (const [field, kind] of Object.entries(REF_FIELDS)) {
        const v = data[field];
        if (typeof v === "string") ids[kind].add(v);
      }
    }
  }
  return ids;
}

type Data = Record<string, unknown>;

function isObject(v: unknown): v is Data {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Chờ duyệt",
  approved: "Đã duyệt",
  rejected: "Từ chối",
  cancelled: "Đã hủy",
  awaiting_peer: "Chờ người nhận",
  posted: "Đã ghi",
  draft: "Nháp",
  published: "Đã công bố",
  done: "Hoàn thành",
  failed: "Không đạt",
};

const ENUM_LABELS: Record<string, Record<string, string>> = {
  role: ROLE_LABELS,
  pay_type: PAY_TYPE_LABELS,
  pay_period: PAY_PERIOD_LABELS,
  method: PAYMENT_METHOD_LABELS,
  check_in_method: { gps: "GPS", wifi: "Wi-Fi", manual: "Thủ công" },
  check_out_method: { gps: "GPS", wifi: "Wi-Fi", manual: "Thủ công" },
  frequency: { daily: "Hằng ngày", weekly: "Theo thứ", monthly: "Theo ngày tháng" },
  priority: Object.fromEntries(Object.entries(PRIORITY_LABELS).map(([k, v]) => [k, v.label])),
};

function kindLabel(table: string, value: string): string {
  if (table === "schedule_requests") return REQUEST_KIND_LABELS[value as keyof typeof REQUEST_KIND_LABELS] ?? value;
  if (table === "stock_issues") return ISSUE_KIND_LABELS[value as keyof typeof ISSUE_KIND_LABELS] ?? value;
  if (table === "payroll_adjustments") return ADJUSTMENT_KINDS.find((k) => k.value === value)?.label ?? value;
  return value;
}

const money = new Intl.NumberFormat("vi-VN");
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Giá trị một trường, dạng dễ đọc */
export function formatValue(table: string, field: string, value: unknown, refs: AuditRefs): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Có" : "Không";
  const ref = REF_FIELDS[field];
  if (ref && typeof value === "string") return refs[ref].get(value) ?? "(đã xóa)";
  if (field === "status" && typeof value === "string") {
    if (table === "shifts") return SHIFT_STATUS[value as keyof typeof SHIFT_STATUS]?.label ?? value;
    if (table === "schedule_requests") return REQUEST_STATUS[value as keyof typeof REQUEST_STATUS]?.label ?? value;
    return STATUS_LABELS[value] ?? value;
  }
  if (field === "kind" && typeof value === "string") return kindLabel(table, value);
  if (ENUM_LABELS[field] && typeof value === "string") return ENUM_LABELS[field][value] ?? value;
  if (Array.isArray(value) && value.length === 0) return "—";
  if (field === "weekdays" && Array.isArray(value)) return value.map((d) => WEEKDAY_LABELS[Number(d)] ?? d).join(", ");
  if (field === "logo_path") return "Đã đổi ảnh";
  if (MONEY_FIELDS.has(field) && (typeof value === "number" || typeof value === "string")) {
    const n = Number(value);
    if (Number.isFinite(n)) return `${money.format(n)}đ`;
  }
  if (typeof value === "string") {
    if (ISO_DATETIME.test(value)) return formatDateTime(value);
    const d = ISO_DATE.exec(value);
    if (d) return `${d[3]}/${d[2]}/${d[1]}`;
    if (/^\d{2}:\d{2}:\d{2}$/.test(value)) return value.slice(0, 5);
    return value;
  }
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  if (typeof value === "number") return money.format(value);
  return JSON.stringify(value);
}

export type AuditChange = { field: string; label: string; before: string; after: string };

/** Các trường đã đổi (sửa) hoặc nội dung chính (thêm / xóa) */
export function auditChanges(
  table: string,
  action: string,
  oldData: unknown,
  newData: unknown,
  refs: AuditRefs
): { mode: "diff" | "snapshot"; changes: AuditChange[] } {
  const before = isObject(oldData) ? oldData : null;
  const after = isObject(newData) ? newData : null;
  const visible = (field: string) => !HIDDEN_FIELDS.has(field) && !(table === "app_settings" && field === "id");

  if (before && after) {
    const changes: AuditChange[] = [];
    for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (!visible(field)) continue;
      if (JSON.stringify(before[field] ?? null) === JSON.stringify(after[field] ?? null)) continue;
      const was = formatValue(table, field, before[field], refs);
      const now = formatValue(table, field, after[field], refs);
      if (was === now) continue; // VD cùng giờ phút, khác giây
      changes.push({ field, label: FIELD_LABELS[field] ?? field, before: was, after: now });
    }
    return { mode: "diff", changes: changes.sort(byFieldOrder) };
  }

  const data = after ?? before ?? {};
  const changes: AuditChange[] = [];
  for (const [field, value] of Object.entries(data)) {
    if (!visible(field) || value === null || value === "" || value === false) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (MONEY_FIELDS.has(field) && Number(value) === 0) continue;
    if (action === "FINALIZE" && !["period_start", "period_end", "gross_amount", "deductions_amount", "net_amount"].includes(field)) continue;
    const text = formatValue(table, field, value, refs);
    changes.push({ field, label: FIELD_LABELS[field] ?? field, before: "", after: text });
  }
  return { mode: "snapshot", changes: changes.sort(byFieldOrder) };
}

export type AuditTone = "add" | "edit" | "remove" | "approve" | "reject";

/** Động từ mô tả thao tác (VD "Duyệt", "Khóa", "Công bố") */
export function auditVerb(table: string, action: string, oldData: unknown, newData: unknown): { verb: string; tone: AuditTone } {
  const before = isObject(oldData) ? oldData : {};
  const after = isObject(newData) ? newData : {};

  if (action === "FINALIZE") return { verb: "Chốt", tone: "approve" };
  if (action === "MANUAL_INSERT") return { verb: "Thêm thủ công", tone: "add" };
  if (action === "DELETE") {
    if (table === "employee_branches") return { verb: "Bỏ gán", tone: "remove" };
    return { verb: "Xóa", tone: "remove" };
  }
  if (action === "INSERT") {
    if (table === "employee_branches") return { verb: "Gán", tone: "add" };
    if (table === "stock_receipts") return { verb: "Nhập kho", tone: "add" };
    if (table === "stock_counts") return { verb: "Kiểm kê", tone: "add" };
    if (table === "stock_issues") return { verb: "Xuất kho", tone: "add" };
    if (table === "supplier_payments") return { verb: "Ghi", tone: "add" };
    if (table === "shift_registrations" || table === "schedule_requests" || table === "salary_advances") return { verb: "Tạo", tone: "add" };
    return { verb: "Thêm", tone: "add" };
  }

  // UPDATE
  if (!before.deleted_at && after.deleted_at) return { verb: "Xóa", tone: "remove" };
  if (!before.voided_at && after.voided_at) return { verb: "Hủy", tone: "remove" };
  if (before.is_active === true && after.is_active === false) return { verb: table === "employees" ? "Khóa" : "Ngừng", tone: "remove" };
  if (before.is_active === false && after.is_active === true) return { verb: "Mở lại", tone: "approve" };
  if (before.status !== after.status && typeof after.status === "string") {
    switch (after.status) {
      case "approved":
        return { verb: "Duyệt", tone: "approve" };
      case "rejected":
        return { verb: "Từ chối", tone: "reject" };
      case "cancelled":
        return { verb: "Hủy", tone: "remove" };
      case "published":
        return { verb: "Công bố", tone: "approve" };
      case "done":
        return { verb: "Đánh dấu Hoàn thành", tone: "approve" };
      case "failed":
        return { verb: "Đánh dấu Không đạt", tone: "reject" };
      case "pending":
        if (before.status === "done" || before.status === "failed") return { verb: "Mở lại", tone: "edit" };
    }
  }
  return { verb: "Sửa", tone: "edit" };
}

const DATE_FIELDS = ["work_date", "task_date", "start_date", "period_start", "counted_on", "issued_on", "paid_on", "invoice_date"];

/** Tên đối tượng bị tác động (VD tên nhân viên, tên mẫu ca, ngày ca) */
export function auditSubject(table: string, oldData: unknown, newData: unknown, refs: AuditRefs): string {
  const data = { ...(isObject(oldData) ? oldData : {}), ...(isObject(newData) ? newData : {}) };
  const parts: string[] = [];
  const own = data.full_name ?? data.name ?? data.title ?? data.brand_name ?? data.unit_name;
  if (typeof own === "string") parts.push(own);
  if (table === "stock_receipts" && typeof data.invoice_number === "string" && data.invoice_number) parts.push(`HĐ ${data.invoice_number}`);
  if (table !== "employees") {
    const emp = data.employee_id ?? data.primary_employee_id;
    if (typeof emp === "string") parts.push(refs.employees.get(emp) ?? "(nhân viên đã xóa)");
  }
  if (table === "employee_branches" && typeof data.branch_id === "string") parts.push(refs.branches.get(data.branch_id) ?? "");
  if (table === "inventory_item_units" && typeof data.item_id === "string") parts.push(refs.items.get(data.item_id) ?? "");
  if ((table === "suppliers" || table.startsWith("stock_") || table === "supplier_payments") && typeof data.supplier_id === "string") {
    const s = refs.suppliers.get(data.supplier_id);
    if (s && !parts.includes(s)) parts.push(s);
  }
  if (table === "schedule_requests" && typeof data.kind === "string") parts.push(kindLabel(table, data.kind));
  if (table === "payroll_adjustments" && typeof data.kind === "string") parts.push(kindLabel(table, data.kind));
  if (table === "stock_issues" && typeof data.kind === "string") parts.push(kindLabel(table, data.kind));
  for (const field of DATE_FIELDS) {
    const v = data[field];
    if (typeof v === "string") {
      parts.push(formatValue(table, field, v, refs));
      break;
    }
  }
  if (table === "shifts" && typeof data.start_time === "string" && typeof data.end_time === "string") {
    parts.push(`${data.start_time.slice(0, 5)}–${data.end_time.slice(0, 5)}`);
  }
  if (table === "attendance_records" && typeof data.check_in_at === "string") parts.push(formatValue(table, "check_in_at", data.check_in_at, refs));
  return parts.filter(Boolean).join(" · ");
}
