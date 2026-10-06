"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireEmployee } from "@/lib/auth/session";
import { passwordField } from "@/lib/validation/employee";
import { fail, success, zodFieldErrors, type ActionState } from "@/lib/action-state";

const changePasswordSchema = z
  .object({
    current_password: z.string().min(1, { message: "Vui lòng nhập mật khẩu hiện tại." }),
    password: passwordField,
    confirm_password: z.string(),
  })
  .refine((value) => value.password === value.confirm_password, {
    path: ["confirm_password"],
    message: "Mật khẩu nhập lại không khớp.",
  })
  .refine((value) => value.password !== value.current_password, {
    path: ["password"],
    message: "Mật khẩu mới phải khác mật khẩu hiện tại.",
  });

export async function changeOwnPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireEmployee();

  const parsed = changePasswordSchema.safeParse({
    current_password: formData.get("current_password") ?? "",
    password: formData.get("password") ?? "",
    confirm_password: formData.get("confirm_password") ?? "",
  });
  if (!parsed.success) {
    return fail("Vui lòng kiểm tra lại thông tin.", zodFieldErrors(parsed.error.issues));
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const email = userData.user?.email;
  if (!email) return fail("Không xác định được tài khoản. Vui lòng đăng nhập lại.");

  // Xác minh mật khẩu hiện tại
  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email,
    password: parsed.data.current_password,
  });
  if (verifyError) {
    return fail("Mật khẩu hiện tại không đúng.", { current_password: "Mật khẩu hiện tại không đúng." });
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "weak_password") return fail("Mật khẩu quá yếu, vui lòng chọn mật khẩu khác.");
    return fail("Không thể đổi mật khẩu. Vui lòng thử lại.");
  }

  return success("Đã đổi mật khẩu thành công.");
}
