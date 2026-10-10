import type { Branding } from "@/lib/branding-shared";

/** Logo thương hiệu: ảnh logo nếu QTV đã tải lên, không thì ô chữ viết tắt theo màu chủ đạo. */
export default function BrandMark({
  branding,
  size = 36,
  className = "",
}: {
  branding: Pick<Branding, "logoUrl" | "shortName" | "brandName">;
  size?: number;
  className?: string;
}) {
  if (branding.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={branding.logoUrl}
        alt={branding.brandName}
        width={size}
        height={size}
        className={`shrink-0 rounded-xl bg-white object-contain ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-xl bg-brand font-black leading-none tracking-tight text-brand-fg ${className}`}
      style={{ width: size, height: size, fontSize: size * (branding.shortName.length > 3 ? 0.26 : 0.32) }}
    >
      {branding.shortName}
    </span>
  );
}
