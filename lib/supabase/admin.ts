import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { SUPABASE_URL } from "@/lib/env";

/**
 * Client quyền quản trị (secret key) — BỎ QUA RLS.
 * Chỉ dùng cho thao tác Supabase Auth Admin (tạo user, đặt mật khẩu, khóa)
 * và tra cứu đăng nhập bằng số điện thoại. Mọi nơi gọi hàm này phải tự kiểm tra quyền trước.
 */
export function createAdminClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("Thiếu biến môi trường SUPABASE_SECRET_KEY. Xem file .env.example.");
  }

  return createClient<Database>(SUPABASE_URL, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
