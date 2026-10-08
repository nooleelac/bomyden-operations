// Nguồn sự thật DUY NHẤT về chức vụ & quyền phía ứng dụng.
// Quy tắc tương ứng phía DB nằm trong migration (private.employees_guard + RLS).

import type { EmployeeRole } from "@/lib/database.types";

export const ROLE_LABELS: Record<EmployeeRole, string> = {
  admin: "Quản trị viên",
  manager: "Quản lý",
  head_chef: "Bếp chính",
  staff: "Nhân viên",
  server: "Phục vụ",
  cashier: "Thu ngân",
};

export const ALL_ROLES: EmployeeRole[] = [
  "admin",
  "manager",
  "head_chef",
  "staff",
  "server",
  "cashier",
];

export function isManagerOrAdmin(role: EmployeeRole): boolean {
  return role === "admin" || role === "manager";
}

/** Quản trị viên & Quản lý được vào màn hình quản lý nhân viên. */
export function canManageEmployees(role: EmployeeRole): boolean {
  return isManagerOrAdmin(role);
}

/** Chỉ Quản trị viên tạo/sửa chi nhánh và bật/tắt "phải chấm công". */
export function isAdmin(role: EmployeeRole): boolean {
  return role === "admin";
}

/** Quản trị viên & Quản lý xem/duyệt/sửa chấm công (Quản lý: trong chi nhánh mình). */
export function canManageAttendance(role: EmployeeRole): boolean {
  return isManagerOrAdmin(role);
}

/** Được vào Bảng lương: QTV, hoặc Quản lý được QTV cấp quyền (khớp private.has_payroll_access ở DB). */
export function canAccessPayroll(employee: { role: EmployeeRole; can_manage_payroll: boolean }): boolean {
  return employee.role === "admin" || (employee.role === "manager" && employee.can_manage_payroll);
}

/** Người này có phải tự chấm công không. */
export function mustClockIn(employee: { role: EmployeeRole; requires_attendance: boolean }): boolean {
  return employee.role !== "admin" && employee.requires_attendance;
}

/** Các chức vụ mà người thao tác được phép gán. Chỉ Quản trị viên mới gán được "admin". */
export function assignableRoles(actorRole: EmployeeRole): EmployeeRole[] {
  if (actorRole === "admin") return ALL_ROLES;
  if (actorRole === "manager") return ALL_ROLES.filter((role) => role !== "admin");
  return [];
}

/** Người thao tác có được sửa/khóa/đặt lại mật khẩu cho nhân viên có chức vụ targetRole không. */
export function canManageTarget(actorRole: EmployeeRole, targetRole: EmployeeRole): boolean {
  if (actorRole === "admin") return true;
  if (actorRole === "manager") return targetRole !== "admin";
  return false;
}
