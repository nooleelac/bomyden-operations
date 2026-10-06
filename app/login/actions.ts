"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhone } from "@/lib/phone";
import { fail, type ActionState } from "@/lib/action-state";

const INVALID_LOGIN = "Thông tin đăng nhập không đúng.";

/** Chỉ cho phép chuyển hướng nội bộ (chống open redirect). */
function safeNextPath(value: FormDataEntryValue | null): string {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  return value;
}

/** Tìm email đăng nhập (trong Supabase Auth) của nhân viên theo số điện thoại. */
async function findLoginEmailByPhone(phone: string): Promise<string | null> {
  const admin = createAdminClient();

  const { data: employee } = await admin
    .from("employees")
    .select("auth_user_id")
    .eq("phone", phone)
    .eq("is_active", true)
    .maybeSingle();

  if (!employee) return null;

  const { data, error } = await admin.auth.admin.getUserById(employee.auth_user_id);
  if (error || !data.user?.email) return null;
  return data.user.email;
}

export async function signIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const identifier = String(formData.get("identifier") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!identifier || !password) {
    return fail("Vui lòng nhập email/số điện thoại và mật khẩu.");
  }

  // 1. Xác định email đăng nhập
  let email: string | null;
  if (identifier.includes("@")) {
    email = identifier.toLowerCase();
  } else {
    const phone = normalizePhone(identifier);
    if (!phone) return fail("Số điện thoại không hợp lệ.");
    email = await findLoginEmailByPhone(phone);
  }

  // Không tiết lộ tài khoản có tồn tại hay không
  if (!email) return fail(INVALID_LOGIN);

  // 2. Đăng nhập Supabase Auth (ghi cookie phiên)
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    if (error?.code === "user_banned") {
      return fail("Tài khoản đã bị khóa. Vui lòng liên hệ quản lý.");
    }
    if (error?.status === 429) {
      return fail("Bạn thử đăng nhập quá nhiều lần. Vui lòng đợi vài phút.");
    }
    return fail(INVALID_LOGIN);
  }

  // 3. Phải là nhân viên đang hoạt động
  const { data: employee } = await supabase
    .from("employees")
    .select("id, is_active")
    .eq("auth_user_id", data.user.id)
    .maybeSingle();

  if (!employee || !employee.is_active) {
    await supabase.auth.signOut();
    return fail("Tài khoản chưa được cấp quyền hoặc đã bị khóa. Vui lòng liên hệ quản lý.");
  }

  redirect(safeNextPath(formData.get("next")));
}
