import type { Metadata } from "next";
import LoginForm from "./LoginForm";

export const metadata: Metadata = {
  title: "Đăng nhập",
};

export const instant = false;

const REASON_MESSAGES: Record<string, string> = {
  signed_out: "Bạn đã đăng xuất.",
  no_access: "Tài khoản chưa được cấp quyền hoặc đã bị khóa. Vui lòng liên hệ quản lý.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/";
  const reason = typeof params.reason === "string" ? REASON_MESSAGES[params.reason] : undefined;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-100 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-neutral-900 text-2xl font-black text-white">
            BMĐ
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">BÒ MỸ ĐEN</h1>
          <p className="mt-1 text-sm text-neutral-500">Hệ thống vận hành quán</p>
        </div>

        <div className="card p-6 sm:p-8">
          {reason && <p className="alert-info mb-5">{reason}</p>}
          <LoginForm next={next} />
        </div>

        <p className="mt-6 text-center text-xs text-neutral-400">
          Quên mật khẩu? Liên hệ Quản lý để được đặt lại.
        </p>
      </div>
    </main>
  );
}
