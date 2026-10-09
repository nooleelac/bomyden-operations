import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canAccessInventory, canAccessPayroll, isManagerOrAdmin } from "@/lib/auth/roles";
import type { Employee } from "@/lib/database.types";

export type CurrentEmployee = Pick<
  Employee,
  "id" | "auth_user_id" | "full_name" | "email" | "phone" | "role" | "is_active" | "requires_attendance" | "can_manage_payroll" | "can_receive_stock"
>;

/**
 * Nhân viên đang đăng nhập (xác thực JWT phía server + đọc bảng employees qua RLS).
 * Trả về null nếu chưa đăng nhập, chưa liên kết nhân viên, hoặc đã bị khóa.
 * Được cache trong phạm vi 1 request.
 */
export const getCurrentEmployee = cache(async (): Promise<CurrentEmployee | null> => {
  // Phiên đăng nhập luôn đọc theo từng request (không prerender), trước khi Supabase kiểm tra hạn token.
  await connection();
  const supabase = await createClient();

  const { data: claimsData } = await supabase.auth.getClaims();
  const authUserId = claimsData?.claims?.sub;
  if (!authUserId) return null;

  const { data: employee, error } = await supabase
    .from("employees")
    .select("id, auth_user_id, full_name, email, phone, role, is_active, requires_attendance, can_manage_payroll, can_receive_stock")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (error || !employee || !employee.is_active) return null;
  return employee;
});

/** Bắt buộc đăng nhập + là nhân viên đang hoạt động. Nếu không: đăng xuất & về trang đăng nhập. */
export async function requireEmployee(): Promise<CurrentEmployee> {
  const employee = await getCurrentEmployee();
  if (!employee) {
    redirect("/auth/signout?reason=no_access");
  }
  return employee;
}

/** Bắt buộc có quyền Bảng lương (QTV, hoặc Quản lý được cấp quyền). */
export async function requirePayrollAccess(): Promise<CurrentEmployee> {
  const employee = await requireEmployee();
  if (!canAccessPayroll(employee)) {
    redirect("/?error=forbidden");
  }
  return employee;
}

/** Bắt buộc có quyền Kho (QTV, Quản lý, hoặc nhân viên được bật "nhập kho"). */
export async function requireInventoryAccess(): Promise<CurrentEmployee> {
  const employee = await requireEmployee();
  if (!canAccessInventory(employee)) {
    redirect("/?error=forbidden");
  }
  return employee;
}

/** Bắt buộc là Quản trị viên. */
export async function requireAdmin(): Promise<CurrentEmployee> {
  const employee = await requireEmployee();
  if (employee.role !== "admin") {
    redirect("/?error=forbidden");
  }
  return employee;
}

/** Bắt buộc là Quản trị viên hoặc Quản lý. */
export async function requireManager(): Promise<CurrentEmployee> {
  const employee = await requireEmployee();
  if (!isManagerOrAdmin(employee.role)) {
    redirect("/?error=forbidden");
  }
  return employee;
}
