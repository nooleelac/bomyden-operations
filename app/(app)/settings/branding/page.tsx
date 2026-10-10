import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";
import { getBranding } from "@/lib/branding";
import BrandingForm from "./BrandingForm";

export const metadata: Metadata = { title: "Thương hiệu" };
export const instant = false;

export default async function BrandingPage() {
  await requireAdmin();
  const branding = await getBranding();

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">
        ← Trang chủ
      </Link>
      <div className="mb-6 mt-2">
        <h1 className="text-2xl font-bold tracking-tight">Thương hiệu</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Logo, tên và màu sắc hiển thị cho mọi người dùng: trang đăng nhập, thanh tiêu đề, nút bấm, biểu tượng app.
        </p>
      </div>
      <BrandingForm key={branding.version} branding={branding} />
    </div>
  );
}
