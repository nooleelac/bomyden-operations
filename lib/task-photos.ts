import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export const TASK_PHOTO_BUCKET = "task-photos";
// Dưới giới hạn body 4,5 MB của Vercel (ảnh đã được thu nhỏ trên điện thoại trước khi gửi)
export const TASK_PHOTO_MAX_BYTES = 3.5 * 1024 * 1024;
export const TASK_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * Tạo link xem ảnh tạm thời (1 giờ) cho các ảnh mà người dùng ĐÃ được phép xem
 * (danh sách path phải lấy từ truy vấn có RLS của chính người dùng).
 */
export async function signTaskPhotos(paths: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  const result = new Map<string, string>();
  if (unique.length === 0) return result;

  const admin = createAdminClient();
  const { data } = await admin.storage.from(TASK_PHOTO_BUCKET).createSignedUrls(unique, 60 * 60);
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) result.set(item.path, item.signedUrl);
  }
  return result;
}
