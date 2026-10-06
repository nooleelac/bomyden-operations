// Đọc biến môi trường public. Báo lỗi rõ ràng nếu thiếu thay vì dùng dấu "!".

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Thiếu biến môi trường ${name}. Xem file .env.example.`);
  }
  return value;
}

export const SUPABASE_URL = required(
  "NEXT_PUBLIC_SUPABASE_URL",
  process.env.NEXT_PUBLIC_SUPABASE_URL
);

export const SUPABASE_PUBLISHABLE_KEY = required(
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);
