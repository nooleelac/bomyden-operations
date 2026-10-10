import "server-only";

import { cacheLife } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

export const TASK_PHOTO_BUCKET = "task-photos";
// Dưới giới hạn body 4,5 MB của Vercel (ảnh đã được thu nhỏ trên điện thoại trước khi gửi)
export const TASK_PHOTO_MAX_BYTES = 3.5 * 1024 * 1024;
export const TASK_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

// Link ký sống 2 giờ; cache tối đa 1 giờ → link lấy từ cache luôn còn hạn ≥ 1 giờ.
const SIGNED_URL_SECONDS = 2 * 60 * 60;

/**
 * Tạo link xem ảnh tạm thời cho các ảnh mà người dùng ĐÃ được phép xem
 * (danh sách path phải lấy từ truy vấn có RLS của chính người dùng).
 * Link được cache theo từng ảnh → trang tự cập nhật (realtime) không đổi link, trình duyệt không tải lại ảnh.
 */
export async function signTaskPhotos(paths: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  const signed = await Promise.all(unique.map((path) => signTaskPhoto(path).then((url) => [path, url] as const, () => null)));
  return new Map(signed.filter((entry) => entry !== null));
}

/** Lỗi thì ném ra (không được cache) → lần sau ký lại. */
async function signTaskPhoto(path: string): Promise<string> {
  "use cache";
  cacheLife({ stale: 300, revalidate: 1800, expire: 3600 });

  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(TASK_PHOTO_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) throw new Error(`Không tạo được link ảnh: ${error?.message ?? path}`);
  return data.signedUrl;
}
