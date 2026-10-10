import "server-only";

import { cache } from "react";
import { canAccessInventory, canAccessPayroll, canManageAttendance, canManageEmployees, isAdmin, mustClockIn } from "@/lib/auth/roles";
import type { CurrentEmployee } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export type AppModule = {
  title: string;
  /** Tên ngắn trên thanh điều hướng dưới */
  short: string;
  description: string;
  href: string;
  icon: string;
};

/** Các chức năng người dùng được dùng (theo vai trò & quyền), đúng thứ tự hiển thị. Cache trong 1 request. */
export const getModules = cache(async (employee: CurrentEmployee): Promise<AppModule[]> => {
  // RLS: chỉ thấy hồ sơ lương của mình khi QTV đã cho phép xem phiếu lương
  const supabase = await createClient();
  const [{ data: ownProfile }, { data: hasPayrollProfile }] = await Promise.all([
    supabase.from("payroll_profiles").select("can_view_payslip").eq("employee_id", employee.id).maybeSingle(),
    supabase.rpc("has_payroll_profile"),
  ]);

  const manage = canManageAttendance(employee.role);
  const notAdmin = employee.role !== "admin";
  const list: (AppModule | false)[] = [
    notAdmin && { title: "Lịch làm việc", short: "Lịch", description: "Ca làm của chi nhánh, xin nghỉ / trễ / đổi ca", href: "/schedule", icon: "📅" },
    manage && { title: "Xếp lịch & duyệt đơn", short: "Xếp lịch", description: "Xếp ca, công bố lịch, duyệt đơn xin phép", href: "/schedule/manage", icon: "🗓️" },
    // QTV không được giao việc checklist → chỉ cần "Quản lý checklist"
    notAdmin && { title: "Checklist", short: "Checklist", description: "Công việc hôm nay của tôi", href: "/checklist", icon: "📋" },
    manage && { title: "Quản lý checklist", short: "Checklist", description: "Mẫu công việc, báo cáo hằng ngày", href: "/checklist/manage", icon: "✅" },
    mustClockIn(employee) && { title: "Chấm công", short: "Chấm công", description: "Vào ca / ra ca, lịch sử, yêu cầu sửa", href: "/attendance", icon: "🕐" },
    manage && { title: "Quản lý chấm công", short: "Chấm công", description: "Duyệt yêu cầu sửa, ai đang trong ca", href: "/attendance/manage", icon: "🗂️" },
    canManageEmployees(employee.role) && { title: "Nhân viên", short: "Nhân viên", description: "Tài khoản, chức vụ, chi nhánh", href: "/employees", icon: "👥" },
    isAdmin(employee.role) && { title: "Chi nhánh", short: "Chi nhánh", description: "Vị trí GPS, Wi-Fi chấm công", href: "/branches", icon: "🏠" },
    canAccessInventory(employee) && { title: "Kho", short: "Kho", description: "Chụp hóa đơn nhập kho, tồn kho, nhà cung cấp", href: "/inventory", icon: "📦" },
    canAccessPayroll(employee) && { title: "Bảng lương", short: "Lương", description: "Tính lương, KPI, thưởng/phạt, chốt kỳ", href: "/payroll", icon: "💰" },
    Boolean(hasPayrollProfile) && {
      title: "Phiếu lương của tôi",
      short: "Phiếu lương",
      description: ownProfile?.can_view_payslip ? "Các kỳ lương đã chốt, ứng lương" : "Gửi đơn ứng lương",
      href: "/payslips",
      icon: "🧾",
    },
    isAdmin(employee.role) && { title: "Thương hiệu", short: "Thương hiệu", description: "Logo, tên app, màu sắc", href: "/settings/branding", icon: "🎨" },
    isAdmin(employee.role) && { title: "Nhật ký thao tác", short: "Nhật ký", description: "Ai đã thêm, sửa, xóa, duyệt gì — lúc nào", href: "/audit-log", icon: "📜" },
  ];
  return list.filter((m): m is AppModule => Boolean(m));
});

/** Ưu tiên đặt lên thanh điều hướng dưới (tối đa 3 mục, cùng với Trang chủ + Menu). */
const NAV_PRIORITY = [
  "/attendance",
  "/checklist",
  "/schedule",
  "/checklist/manage",
  "/schedule/manage",
  "/attendance/manage",
  "/employees",
  "/inventory",
  "/payroll",
];

export function pickNavModules(modules: AppModule[]): AppModule[] {
  const picked: AppModule[] = [];
  for (const href of NAV_PRIORITY) {
    const m = modules.find((x) => x.href === href);
    // Không đặt 2 mục cùng tên ngắn (VD "Checklist" của NV và của QL)
    if (m && !picked.some((p) => p.short === m.short)) picked.push(m);
    if (picked.length === 3) break;
  }
  return picked;
}
