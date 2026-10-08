import type { MetadataRoute } from "next";

// Cho phép "Thêm vào màn hình chính" — bắt buộc trên iPhone để nhận thông báo đẩy.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Bò Mỹ Đen — Vận hành",
    short_name: "Bò Mỹ Đen",
    description: "Chấm công, checklist, lịch làm việc, bảng lương",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fafafa",
    theme_color: "#171717",
    lang: "vi",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png" },
      { src: "/icons/512", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
