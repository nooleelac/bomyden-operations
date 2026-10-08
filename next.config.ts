import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  experimental: {
    // App nội bộ: mọi trang đều cần đăng nhập (render theo request).
    // Chỉ kiểm tra "instant navigation" ở những segment khai báo `instant` rõ ràng.
    instantInsights: {
      validationLevel: "manual-warning",
    },
    // Ảnh checklist (đã được thu nhỏ trên điện thoại trước khi gửi, thường ~350 KB).
    // Vercel giới hạn body request 4,5 MB → giữ dưới mức đó.
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
