import type { MetadataRoute } from "next";
import { getBranding } from "@/lib/branding";

// Cho phép "Thêm vào màn hình chính" — bắt buộc trên iPhone để nhận thông báo đẩy.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const b = await getBranding();
  const v = `?v=${b.version}`;
  return {
    name: `${b.brandName} — Vận hành`,
    short_name: b.brandName.length > 12 ? b.shortName : b.brandName,
    description: "Chấm công, checklist, lịch làm việc, bảng lương",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f5f5f5",
    theme_color: b.headerColor,
    lang: "vi",
    icons: [
      { src: `/icons/192${v}`, sizes: "192x192", type: "image/png" },
      { src: `/icons/512${v}`, sizes: "512x512", type: "image/png" },
      { src: `/icons/maskable${v}`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
