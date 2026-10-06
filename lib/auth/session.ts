import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isManagerOrAdmin } from "@/lib/auth/roles";
import type { Employee } from "@/lib/database.types";

export type CurrentEmployee = Pick<
  Employee,
  "id" | "auth_user_id" | "full_name" | "email" | "phone" | "role" | "is_active"
>;

/**
 * Nhân viên đang đăng nhập (xác thực JWT phía server + đọc bảng employees qua RLS).
 * Trả về null nếu chưa đăng nhập, chưa liên kết nhân viên, hoặc đã bị khóa.
 * Được cache trong phạm vi 1 request.
 */
export const getCurrentEmployee = cache(async (): Promise<CurrentEmployee | null> => {
  const supabase = await createClient();

  const { data: claimsData } = await supabase.auth.getClaims();
  const authUserId = claimsData?.claims?.sub;
  if (!authUserId) return null;

  const { data: employee, error } = await supabase
    .from("employees")
    .select("id, auth_user_id, full_name, email, phone, role, is_active")
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

/** Bắt buộc là Quản trị viên hoặc Quản lý. */
export async function requireManager(): Promise<CurrentEmployee> {
  const employee = await requireEmployee();
  if (!isManagerOrAdmin(employee.role)) {
    redirect("/?error=forbidden");
  }
  return employee;
}
