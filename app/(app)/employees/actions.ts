"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireManager } from "@/lib/auth/session";
import { assignableRoles, canManageTarget, ROLE_LABELS } from "@/lib/auth/roles";
import { phoneLoginEmail } from "@/lib/phone";
import {
  createEmployeeSchema,
  pickFormFields,
  resetPasswordSchema,
  updateEmployeeSchema,
} from "@/lib/validation/employee";
import {
  fail,
  friendlyDbError,
  success,
  zodFieldErrors,
  type ActionState,
} from "@/lib/action-state";
import type { EmployeeRole } from "@/lib/database.types";

const EMPLOYEE_FIELDS = [
  "full_name",
  "email",
  "phone",
  "role",
  "default_start_time",
  "sort_order",
] as const;

// Khóa vĩnh viễn trong Supabase Auth (~100 năm)
const BAN_FOREVER = "876000h";

/** Email dùng để đăng nhập Supabase Auth: email thật, hoặc email nội bộ suy ra từ SĐT. */
function authEmailFor(email: string | null, phone: string | null): string {
  if (email) return email;
  if (phone) return phoneLoginEmail(phone);
  throw new Error("Thiếu email và số điện thoại.");
}

function friendlyAuthError(error: { code?: string; message?: string }): string {
  if (error.code === "email_exists" || error.message?.includes("already been registered")) {
    return "Email hoặc số điện thoại này đã có tài khoản đăng nhập.";
  }
  if (error.code === "weak_password") return "Mật khẩu quá yếu, vui lòng chọn mật khẩu khác.";
  if (error.code === "email_address_invalid") return "Email không hợp lệ.";
  return "Không thể cập nhật tài khoản đăng nhập. Vui lòng thử lại.";
}

/** Đọc nhân viên đích qua RLS (đảm bảo người thao tác thật sự có quyền xem). */
async function loadTarget(employeeId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("employees")
    .select("id, auth_user_id, full_name, email, phone, role, is_active, default_start_time, sort_order")
    .eq("id", employeeId)
    .maybeSingle();
  return { supabase, target: data };
}

// =====================================================================
// TẠO NHÂN VIÊN + TÀI KHOẢN ĐĂNG NHẬP
// =====================================================================
export async function createEmployee(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireManager();

  const parsed = createEmployeeSchema.safeParse(
    pickFormFields(formData, [...EMPLOYEE_FIELDS, "password"])
  );
  if (!parsed.success) {
    return fail("Vui lòng kiểm tra lại thông tin.", zodFieldErrors(parsed.error.issues));
  }
  const input = parsed.data;
  const role = input.role as EmployeeRole;

  if (!assignableRoles(actor.role).includes(role)) {
    return fail(`Bạn không có quyền tạo tài khoản ${ROLE_LABELS[role]}.`, {
      role: "Chức vụ không được phép.",
    });
  }

  // 1. Tạo tài khoản Supabase Auth (cần quyền admin)
  const admin = createAdminClient();
  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email: authEmailFor(input.email, input.phone),
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: input.full_name },
  });
  if (authError || !created.user) {
    return fail(friendlyAuthError(authError ?? {}));
  }

  // 2. Tạo bản ghi nhân viên bằng phiên của người thao tác → RLS + trigger kiểm tra quyền
  const supabase = await createClient();
  const { error: insertError } = await supabase
    .from("employees")
    .insert({
      auth_user_id: created.user.id,
      full_name: input.full_name,
      email: input.email,
      phone: input.phone,
      role,
      default_start_time: input.default_start_time,
      sort_order: input.sort_order,
    })
    .select("id")
    .single();

  if (insertError) {
    // Hoàn tác: xóa tài khoản Auth vừa tạo để không để lại tài khoản mồ côi
    await admin.auth.admin.deleteUser(created.user.id);
    return fail(friendlyDbError(insertError));
  }

  revalidatePath("/employees");
  return success(`Đã tạo nhân viên "${input.full_name}".`);
}

// =====================================================================
// SỬA THÔNG TIN NHÂN VIÊN
// =====================================================================
export async function updateEmployee(
  employeeId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await requireManager();

  const parsed = updateEmployeeSchema.safeParse(pickFormFields(formData, EMPLOYEE_FIELDS));
  if (!parsed.success) {
    return fail("Vui lòng kiểm tra lại thông tin.", zodFieldErrors(parsed.error.issues));
  }
  const input = parsed.data;
  const role = input.role as EmployeeRole;

  const { supabase, target } = await loadTarget(employeeId);
  if (!target) return fail("Không tìm thấy nhân viên.");

  if (!canManageTarget(actor.role, target.role)) {
    return fail("Bạn không có quyền sửa tài khoản này.");
  }
  if (role !== target.role && !assignableRoles(actor.role).includes(role)) {
    return fail(`Bạn không có quyền gán chức vụ ${ROLE_LABELS[role]}.`, {
      role: "Chức vụ không được phép.",
    });
  }
  if (target.id === actor.id && role !== target.role) {
    return fail("Bạn không thể tự thay đổi chức vụ của mình.", { role: "Không thể tự đổi chức vụ." });
  }

  // 1. Cập nhật DB (trigger là chốt chặn cuối cùng về quyền)
  const { data: updated, error: updateError } = await supabase
    .from("employees")
    .update({
      full_name: input.full_name,
      email: input.email,
      phone: input.phone,
      role,
      default_start_time: input.default_start_time,
      sort_order: input.sort_order,
    })
    .eq("id", target.id)
    .select("id")
    .maybeSingle();

  if (updateError) return fail(friendlyDbError(updateError));
  if (!updated) return fail("Bạn không có quyền thực hiện thao tác này.");

  // 2. Đồng bộ email đăng nhập nếu email/SĐT thay đổi
  const oldAuthEmail = authEmailFor(target.email, target.phone);
  const newAuthEmail = authEmailFor(input.email, input.phone);

  if (oldAuthEmail !== newAuthEmail) {
    const admin = createAdminClient();
    const { error: authError } = await admin.auth.admin.updateUserById(target.auth_user_id, {
      email: newAuthEmail,
      email_confirm: true,
    });

    if (authError) {
      // Hoàn tác DB để email/SĐT trong bảng luôn khớp với tài khoản đăng nhập
      await supabase
        .from("employees")
        .update({ email: target.email, phone: target.phone })
        .eq("id", target.id);
      return fail(friendlyAuthError(authError));
    }
  }

  revalidatePath("/employees");
  return success(`Đã cập nhật nhân viên "${input.full_name}".`);
}

// =====================================================================
// KHÓA / MỞ KHÓA
// =====================================================================
export async function setEmployeeActive(employeeId: string, active: boolean): Promise<ActionState> {
  const actor = await requireManager();

  const { supabase, target } = await loadTarget(employeeId);
  if (!target) return fail("Không tìm thấy nhân viên.");
  if (!canManageTarget(actor.role, target.role)) {
    return fail("Bạn không có quyền thay đổi tài khoản này.");
  }
  if (target.id === actor.id && !active) {
    return fail("Bạn không thể tự khóa tài khoản của mình.");
  }
  if (target.is_active === active) {
    return success(active ? "Tài khoản đang hoạt động." : "Tài khoản đã bị khóa trước đó.");
  }

  // 1. DB (trigger kiểm tra quyền + luôn còn ít nhất 1 Quản trị viên)
  const { data: updated, error } = await supabase
    .from("employees")
    .update({ is_active: active })
    .eq("id", target.id)
    .select("id")
    .maybeSingle();

  if (error) return fail(friendlyDbError(error));
  if (!updated) return fail("Bạn không có quyền thực hiện thao tác này.");

  // 2. Supabase Auth: chặn/cho phép đăng nhập
  const admin = createAdminClient();
  const { error: banError } = await admin.auth.admin.updateUserById(target.auth_user_id, {
    ban_duration: active ? "none" : BAN_FOREVER,
  });

  if (banError) {
    await supabase.from("employees").update({ is_active: target.is_active }).eq("id", target.id);
    return fail("Không thể cập nhật trạng thái đăng nhập. Vui lòng thử lại.");
  }

  revalidatePath("/employees");
  return success(
    active ? `Đã mở khóa "${target.full_name}".` : `Đã khóa "${target.full_name}". Nhân viên này không thể đăng nhập nữa.`
  );
}

// =====================================================================
// ĐẶT LẠI MẬT KHẨU
// =====================================================================
export async function resetEmployeePassword(
  employeeId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const actor = await requireManager();

  const parsed = resetPasswordSchema.safeParse(
    pickFormFields(formData, ["password", "confirm_password"])
  );
  if (!parsed.success) {
    return fail("Vui lòng kiểm tra lại thông tin.", zodFieldErrors(parsed.error.issues));
  }

  const { target } = await loadTarget(employeeId);
  if (!target) return fail("Không tìm thấy nhân viên.");
  if (!canManageTarget(actor.role, target.role)) {
    return fail("Bạn không có quyền đặt lại mật khẩu cho tài khoản này.");
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(target.auth_user_id, {
    password: parsed.data.password,
  });
  if (error) return fail(friendlyAuthError(error));

  // Ghi vết (bảng audit_logs không cho người dùng ghi trực tiếp)
  await admin.from("audit_logs").insert({
    table_name: "employees",
    record_id: target.id,
    action: "PASSWORD_RESET",
    actor_auth_uid: actor.auth_user_id,
    actor_employee_id: actor.id,
    note: `Đặt lại mật khẩu cho ${target.full_name}`,
  });

  return success(`Đã đặt lại mật khẩu cho "${target.full_name}".`);
}
