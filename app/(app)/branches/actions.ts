"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import { normalizeIp } from "@/lib/request-ip";
import { pickFormFields } from "@/lib/validation/employee";
import {
  fail,
  friendlyDbError,
  success,
  zodFieldErrors,
  type ActionState,
} from "@/lib/action-state";

const optionalNumber = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .transform((value, ctx) => {
      if (value === "") return null;
      const number = Number(value.replace(",", "."));
      if (!Number.isFinite(number) || number < min || number > max) {
        ctx.addIssue({ code: "custom", message: `${label} không hợp lệ.` });
        return z.NEVER;
      }
      return number;
    });

const branchSchema = z
  .object({
    name: z.string().trim().min(1, { message: "Vui lòng nhập tên chi nhánh." }).max(100),
    address: z
      .string()
      .trim()
      .max(255, { message: "Địa chỉ tối đa 255 ký tự." })
      .transform((value) => value || null),
    latitude: optionalNumber(-90, 90, "Vĩ độ"),
    longitude: optionalNumber(-180, 180, "Kinh độ"),
    radius_m: z.coerce
      .number({ message: "Bán kính phải là số." })
      .int({ message: "Bán kính phải là số nguyên." })
      .min(20, { message: "Bán kính tối thiểu 20 m." })
      .max(2000, { message: "Bán kính tối đa 2000 m." }),
    wifi_ips: z.string().transform((value, ctx) => {
      const items = value
        .split(/[\s,;]+/)
        .map((item) => item.trim())
        .filter(Boolean);
      const ips: string[] = [];
      for (const item of items) {
        const ip = normalizeIp(item);
        if (!ip) {
          ctx.addIssue({ code: "custom", message: `IP không hợp lệ: ${item}` });
          return z.NEVER;
        }
        if (!ips.includes(ip)) ips.push(ip);
      }
      return ips;
    }),
  })
  .refine((value) => (value.latitude === null) === (value.longitude === null), {
    path: ["latitude"],
    message: "Cần nhập đủ cả vĩ độ và kinh độ (hoặc bỏ trống cả hai).",
  });

const FIELDS = ["name", "address", "latitude", "longitude", "radius_m", "wifi_ips"] as const;

export async function createBranch(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();

  const parsed = branchSchema.safeParse(pickFormFields(formData, FIELDS));
  if (!parsed.success) {
    return fail("Vui lòng kiểm tra lại thông tin.", zodFieldErrors(parsed.error.issues));
  }

  const supabase = await createClient();
  const { error } = await supabase.from("branches").insert(parsed.data).select("id").single();
  if (error) {
    if (error.code === "23505") return fail("Tên chi nhánh đã tồn tại.", { name: "Tên đã tồn tại." });
    return fail(friendlyDbError(error));
  }

  revalidatePath("/branches");
  return success(`Đã tạo chi nhánh "${parsed.data.name}".`);
}

export async function updateBranch(
  branchId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireAdmin();

  const parsed = branchSchema.safeParse(pickFormFields(formData, FIELDS));
  if (!parsed.success) {
    return fail("Vui lòng kiểm tra lại thông tin.", zodFieldErrors(parsed.error.issues));
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("branches")
    .update({ ...parsed.data, is_active: formData.get("is_active") === "on" })
    .eq("id", branchId)
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") return fail("Tên chi nhánh đã tồn tại.", { name: "Tên đã tồn tại." });
    return fail(friendlyDbError(error));
  }
  if (!data) return fail("Bạn không có quyền thực hiện thao tác này.");

  revalidatePath("/branches");
  return success(`Đã cập nhật chi nhánh "${parsed.data.name}".`);
}

/** Xóa chi nhánh — chỉ khi chưa phát sinh dữ liệu (CSDL kiểm tra và báo lý do nếu không xóa được). */
export async function deleteBranch(branchId: string, name: string): Promise<ActionState> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_branch", { p_branch_id: branchId });
  if (error) return fail(friendlyDbError(error));

  revalidatePath("/branches");
  revalidatePath("/", "layout");
  return success(`Đã xóa chi nhánh "${name}".`);
}
