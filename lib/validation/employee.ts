import { z } from "zod";
import { ALL_ROLES } from "@/lib/auth/roles";
import { normalizePhone } from "@/lib/phone";
import { PASSWORD_MIN_LENGTH } from "@/lib/validation/constants";

export { PASSWORD_MIN_LENGTH };

const optionalText = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : value));

const emailField = optionalText.pipe(
  z
    .email({ message: "Email không hợp lệ." })
    .transform((value) => value.toLowerCase())
    .nullable()
);

const phoneField = optionalText.transform((value, ctx) => {
  if (value === null) return null;
  const phone = normalizePhone(value);
  if (!phone) {
    ctx.addIssue({ code: "custom", message: "Số điện thoại không hợp lệ (ví dụ: 0901234567)." });
    return z.NEVER;
  }
  return phone;
});

const timeField = optionalText.pipe(
  z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "Giờ không hợp lệ." })
    .nullable()
);

export const passwordField = z
  .string()
  .min(PASSWORD_MIN_LENGTH, { message: `Mật khẩu phải có ít nhất ${PASSWORD_MIN_LENGTH} ký tự.` })
  .max(72, { message: "Mật khẩu tối đa 72 ký tự." });

const baseEmployeeSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(1, { message: "Vui lòng nhập họ tên." })
    .max(120, { message: "Họ tên tối đa 120 ký tự." }),
  email: emailField,
  phone: phoneField,
  role: z.enum(ALL_ROLES as [string, ...string[]], { message: "Chức vụ không hợp lệ." }),
  default_start_time: timeField,
  sort_order: z.coerce
    .number({ message: "Thứ tự phải là số." })
    .int({ message: "Thứ tự phải là số nguyên." })
    .min(0)
    .max(9999)
    .default(0),
});

function requireContact<T extends { email: string | null; phone: string | null }>(
  value: T,
  ctx: z.RefinementCtx
) {
  if (!value.email && !value.phone) {
    ctx.addIssue({
      code: "custom",
      path: ["email"],
      message: "Cần nhập ít nhất email hoặc số điện thoại để đăng nhập.",
    });
  }
}

export const createEmployeeSchema = baseEmployeeSchema
  .extend({ password: passwordField })
  .superRefine(requireContact);

export const updateEmployeeSchema = baseEmployeeSchema.superRefine(requireContact);

export const resetPasswordSchema = z
  .object({
    password: passwordField,
    confirm_password: z.string(),
  })
  .refine((value) => value.password === value.confirm_password, {
    path: ["confirm_password"],
    message: "Mật khẩu nhập lại không khớp.",
  });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Danh sách chi nhánh được chọn (checkbox name="branch_ids"). */
export function readBranchIds(formData: FormData): string[] {
  return [
    ...new Set(
      formData
        .getAll("branch_ids")
        .filter((value): value is string => typeof value === "string" && UUID.test(value))
    ),
  ];
}

/** Lấy các trường text từ FormData (tránh lẫn trường $ACTION_ của Next.js). */
export function pickFormFields(formData: FormData, keys: readonly string[]) {
  const result: Record<string, string> = {};
  for (const key of keys) {
    const value = formData.get(key);
    result[key] = typeof value === "string" ? value : "";
  }
  return result;
}
