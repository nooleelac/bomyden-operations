import "server-only";

import { cacheLife } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

export const HANDOVER_PHOTO_BUCKET = "handover-photos";

// Link ký sống 2 giờ; cache tối đa 1 giờ → link lấy từ cache luôn còn hạn ≥ 1 giờ (giống ảnh checklist).
const SIGNED_URL_SECONDS = 2 * 60 * 60;

/**
 * Link xem ảnh bàn giao tạm thời. Danh sách path phải lấy từ truy vấn có RLS của chính người dùng.
 */
export async function signHandoverPhotos(paths: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  const signed = await Promise.all(unique.map((path) => signHandoverPhoto(path).then((url) => [path, url] as const, () => null)));
  return new Map(signed.filter((entry) => entry !== null));
}

async function signHandoverPhoto(path: string): Promise<string> {
  "use cache";
  cacheLife({ stale: 300, revalidate: 1800, expire: 3600 });

  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(HANDOVER_PHOTO_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) throw new Error(`Không tạo được link ảnh: ${error?.message ?? path}`);
  return data.signedUrl;
}
