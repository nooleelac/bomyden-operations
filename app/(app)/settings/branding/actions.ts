"use server";

import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { BRANDING_BUCKET, BRANDING_TAG } from "@/lib/branding";
import { HEX_COLOR } from "@/lib/branding-shared";
import { pickFormFields } from "@/lib/validation/employee";
import { fail, friendlyDbError, success, zodFieldErrors, type ActionState } from "@/lib/action-state";

const LOGO_MAX_BYTES = 1024 * 1024;
const LOGO_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg" };

const color = (label: string) =>
  z
    .string()
    .trim()
    .toLowerCase()
    .regex(HEX_COLOR, { message: `${label} không hợp lệ (dạng #a1b2c3).` });

const brandingSchema = z.object({
  brand_name: z.string().trim().min(1, { message: "Vui lòng nhập tên thương hiệu." }).max(60, { message: "Tối đa 60 ký tự." }),
  short_name: z.string().trim().min(1, { message: "Vui lòng nhập chữ viết tắt." }).max(6, { message: "Tối đa 6 ký tự." }),
  tagline: z.string().trim().max(80, { message: "Tối đa 80 ký tự." }),
  primary_color: color("Màu chủ đạo"),
  header_color: color("Màu thanh tiêu đề"),
});

const FIELDS = ["brand_name", "short_name", "tagline", "primary_color", "header_color"] as const;

export async function updateBranding(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireAdmin();

  const parsed = brandingSchema.safeParse(pickFormFields(formData, FIELDS));
  if (!parsed.success) {
    return fail("Vui lòng kiểm tra lại thông tin.", zodFieldErrors(parsed.error.issues));
  }

  const supabase = await createClient();
  const { data: current, error: readError } = await supabase.from("app_settings").select("logo_path").maybeSingle();
  if (readError || !current) return fail("Không tải được cấu hình thương hiệu.");

  const logo = formData.get("logo");
  const removeLogo = formData.get("remove_logo") === "1";
  const admin = createAdminClient();
  let logoPath = removeLogo ? null : current.logo_path;

  // Kiểm tra quyền xong mới dùng khóa quản trị để tải logo lên kho công khai
  if (logo instanceof File && logo.size > 0) {
    const ext = LOGO_TYPES[logo.type];
    if (!ext) return fail("Logo phải là ảnh PNG hoặc JPG.", { logo: "Chọn ảnh PNG hoặc JPG." });
    if (logo.size > LOGO_MAX_BYTES) return fail("Logo tối đa 1 MB.", { logo: "Ảnh quá lớn (tối đa 1 MB)." });
    // Tên file mới mỗi lần → trình duyệt / điện thoại không giữ logo cũ trong bộ nhớ đệm
    logoPath = `logo-${Date.now()}.${ext}`;
    const { error: uploadError } = await admin.storage
      .from(BRANDING_BUCKET)
      .upload(logoPath, logo, { contentType: logo.type, cacheControl: "31536000", upsert: false });
    if (uploadError) return fail("Không tải được logo lên. Vui lòng thử lại.");
  }

  const { error } = await supabase
    .from("app_settings")
    .update({ ...parsed.data, logo_path: logoPath, updated_by: actor.id, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (error) {
    if (logoPath && logoPath !== current.logo_path) await admin.storage.from(BRANDING_BUCKET).remove([logoPath]);
    return fail(friendlyDbError(error));
  }

  // Dọn logo cũ không còn dùng
  if (current.logo_path && current.logo_path !== logoPath) {
    await admin.storage.from(BRANDING_BUCKET).remove([current.logo_path]);
  }

  updateTag(BRANDING_TAG);
  revalidatePath("/", "layout");
  return success("Đã lưu thương hiệu. Biểu tượng trên màn hình chính điện thoại có thể cần gỡ và thêm lại để đổi.");
}
