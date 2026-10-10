import type { Metadata } from "next";
import LoginForm from "./LoginForm";
import { getBranding } from "@/lib/branding";
import BrandMark from "@/components/BrandMark";

export const metadata: Metadata = {
  title: "Đăng nhập",
};

export const instant = false;

const REASON_MESSAGES: Record<string, string> = {
  signed_out: "Bạn đã đăng xuất.",
  no_access: "Tài khoản chưa được cấp quyền hoặc đã bị khóa. Vui lòng liên hệ quản lý.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const [params, branding] = await Promise.all([searchParams, getBranding()]);
  const next = typeof params.next === "string" ? params.next : "/";
  const reason = typeof params.reason === "string" ? REASON_MESSAGES[params.reason] : undefined;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-100 px-4 py-10 pt-[max(2.5rem,env(safe-area-inset-top))]">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <BrandMark branding={branding} size={64} className="mx-auto mb-4 rounded-2xl shadow-sm" />
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">{branding.brandName}</h1>
          {branding.tagline && <p className="mt-1 text-sm text-neutral-500">{branding.tagline}</p>}
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
