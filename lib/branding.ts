import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/env";
import { DEFAULT_BRANDING, readableOn, type Branding } from "@/lib/branding-shared";

export const BRANDING_TAG = "branding";
export const BRANDING_BUCKET = "branding";

/**
 * Thương hiệu (tên, logo, màu) — đọc công khai, cache đến khi QTV đổi (updateTag(BRANDING_TAG)).
 * Không dùng cookie → dùng được ở layout gốc, trang đăng nhập, biểu tượng app.
 */
export async function getBranding(): Promise<Branding> {
  "use cache";
  cacheTag(BRANDING_TAG);
  cacheLife("max");

  const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data } = await supabase
    .from("app_settings")
    .select("brand_name, short_name, tagline, primary_color, header_color, logo_path, updated_at")
    .maybeSingle();
  if (!data) return DEFAULT_BRANDING;

  const logoUrl = data.logo_path
    ? supabase.storage.from(BRANDING_BUCKET).getPublicUrl(data.logo_path).data.publicUrl
    : null;

  return {
    brandName: data.brand_name,
    shortName: data.short_name,
    tagline: data.tagline,
    primaryColor: data.primary_color,
    headerColor: data.header_color,
    logoUrl,
    version: String(new Date(data.updated_at).getTime()),
  };
}

/** Biến CSS gắn vào <html> để toàn app đổi màu theo thương hiệu. */
export function brandingStyle(b: Branding): React.CSSProperties {
  return {
    "--brand": b.primaryColor,
    "--brand-fg": readableOn(b.primaryColor),
    "--header": b.headerColor,
    "--header-fg": readableOn(b.headerColor),
  } as React.CSSProperties;
}
