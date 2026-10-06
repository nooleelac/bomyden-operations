import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  experimental: {
    // App nội bộ: mọi trang đều cần đăng nhập (render theo request).
    // Chỉ kiểm tra "instant navigation" ở những segment khai báo `instant` rõ ràng.
    instantInsights: {
      validationLevel: "manual-warning",
    },
    // Ảnh checklist (đã được thu nhỏ trên điện thoại trước khi gửi; kho ảnh giới hạn 5 MB/ảnh)
    serverActions: {
      bodySizeLimit: "6mb",
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
