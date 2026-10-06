import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro } from "next/font/google";
import "./globals.css";

const beVietnam = Be_Vietnam_Pro({
  variable: "--font-be-vietnam",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: {
    default: "Bò Mỹ Đen — Vận hành",
    template: "%s · Bò Mỹ Đen",
  },
  description: "Hệ thống quản lý vận hành quán Bò Mỹ Đen",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#171717",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" className={`${beVietnam.variable} h-full`}>
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
