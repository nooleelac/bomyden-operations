import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/env";

let client: ReturnType<typeof createBrowserClient<Database>> | null = null;

/**
 * Client Supabase trên trình duyệt (phiên lấy từ cookie, mọi truy vấn qua RLS).
 * Hiện chỉ dùng cho Realtime; dùng chung 1 kết nối cho cả app.
 */
export function getBrowserClient() {
  client ??= createBrowserClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  return client;
}
