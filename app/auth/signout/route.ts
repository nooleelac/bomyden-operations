import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Đăng xuất phía server: xóa phiên Supabase (cookie) rồi về trang đăng nhập.
// GET dùng khi hệ thống tự đăng xuất (tài khoản bị khóa / chưa liên kết nhân viên).
// POST dùng cho nút "Đăng xuất".

const ALLOWED_REASONS = new Set(["no_access", "signed_out"]);

async function signOutAndRedirect(request: NextRequest, reason: string) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const url = new URL("/login", request.url);
  if (ALLOWED_REASONS.has(reason)) {
    url.searchParams.set("reason", reason);
  }
  return NextResponse.redirect(url, { status: 303 });
}

export async function GET(request: NextRequest) {
  const reason = request.nextUrl.searchParams.get("reason") ?? "no_access";
  return signOutAndRedirect(request, reason);
}

export async function POST(request: NextRequest) {
  return signOutAndRedirect(request, "signed_out");
}
