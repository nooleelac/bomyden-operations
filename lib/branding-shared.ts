// Dùng được cả server lẫn client (trang chỉnh thương hiệu xem trước màu trực tiếp).

export type Branding = {
  brandName: string;
  shortName: string;
  tagline: string;
  primaryColor: string;
  headerColor: string;
  logoUrl: string | null;
  /** Đổi mỗi lần QTV lưu → gắn vào link biểu tượng để điện thoại tải lại. */
  version: string;
};

export const DEFAULT_BRANDING: Branding = {
  brandName: "Bò Mỹ Đen",
  shortName: "BMĐ",
  tagline: "Hệ thống vận hành quán",
  primaryColor: "#171717",
  headerColor: "#171717",
  logoUrl: null,
  version: "0",
};

/** Bảng màu gợi ý (đều đủ tương phản với chữ trắng). */
export const COLOR_PRESETS = [
  { name: "Đen", value: "#171717" },
  { name: "Đỏ bò", value: "#b91c1c" },
  { name: "Đỏ đô", value: "#7f1d1d" },
  { name: "Cam", value: "#c2410c" },
  { name: "Nâu", value: "#78350f" },
  { name: "Xanh lá", value: "#15803d" },
  { name: "Xanh rêu", value: "#3f6212" },
  { name: "Xanh ngọc", value: "#0f766e" },
  { name: "Xanh dương", value: "#1d4ed8" },
  { name: "Xanh đậm", value: "#1e3a8a" },
  { name: "Tím", value: "#6d28d9" },
  { name: "Hồng", value: "#be185d" },
] as const;

export const HEX_COLOR = /^#[0-9a-f]{6}$/;

function luminance(hex: string) {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** Màu chữ dễ đọc trên nền `hex` (trắng hoặc gần đen, theo độ tương phản WCAG). */
export function readableOn(hex: string): string {
  if (!HEX_COLOR.test(hex)) return "#ffffff";
  const l = luminance(hex);
  // #171717 có độ sáng ≈ 0,008
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.058 ? "#ffffff" : "#171717";
}
