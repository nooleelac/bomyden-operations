import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { brandingStyle, getBranding } from "@/lib/branding";
import "./globals.css";

const beVietnam = Be_Vietnam_Pro({
  variable: "--font-be-vietnam",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700", "800"],
});

export async function generateMetadata(): Promise<Metadata> {
  const b = await getBranding();
  const v = `?v=${b.version}`;
  return {
    title: { default: `${b.brandName} — Vận hành`, template: `%s · ${b.brandName}` },
    description: `Hệ thống quản lý vận hành ${b.brandName}`,
    robots: { index: false, follow: false },
    appleWebApp: { capable: true, title: b.brandName, statusBarStyle: "black" },
    icons: {
      icon: [{ url: `/icons/192${v}`, type: "image/png", sizes: "192x192" }],
      apple: [{ url: `/icons/apple${v}`, sizes: "180x180" }],
    },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const b = await getBranding();
  return {
    themeColor: b.headerColor,
    width: "device-width",
    initialScale: 1,
    // Cho phép dùng vùng tai thỏ / thanh home (đã chừa khoảng an toàn bằng env(safe-area-inset-*))
    viewportFit: "cover",
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const branding = await getBranding();
  return (
    <html lang="vi" className={`${beVietnam.variable} h-full`} style={brandingStyle(branding)}>
      <body className="min-h-full font-sans">
        {children}
        {/* Thống kê lượt xem + tốc độ thật trên điện thoại nhân viên (xem ở Vercel → Analytics / Speed Insights) */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
