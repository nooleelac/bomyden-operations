import { ImageResponse } from "next/og";
import { connection } from "next/server";
import { getBranding } from "@/lib/branding";
import { readableOn } from "@/lib/branding-shared";

// Biểu tượng app (PNG) theo thương hiệu: /icons/192, /icons/512, /icons/maskable, /icons/apple, /icons/badge
// Có logo → logo trên nền trắng; chưa có → chữ viết tắt trên nền màu chủ đạo.
const VARIANTS = {
  "192": { size: 192, pad: 0.08 },
  "512": { size: 512, pad: 0.08 },
  maskable: { size: 512, pad: 0.2 },
  apple: { size: 180, pad: 0.1 },
  badge: { size: 96, pad: 0 },
} as const;

export async function GET(request: Request, { params }: RouteContext<"/icons/[size]">) {
  // Không build sẵn thành ảnh tĩnh: logo đổi thì biểu tượng phải đổi theo
  await connection();
  const { size: key } = await params;
  const variant = VARIANTS[key as keyof typeof VARIANTS];
  if (!variant) return new Response("Not found", { status: 404 });
  const { size, pad } = variant;
  const b = await getBranding();
  // Link có ?v=<phiên bản> (đổi mỗi lần QTV lưu) → cache lâu; link trần (thông báo đẩy) → cache ngắn
  const versioned = new URL(request.url).searchParams.has("v");
  const headers = {
    "Cache-Control": versioned ? "public, max-age=31536000, immutable" : "public, max-age=300, stale-while-revalidate=3600",
  };

  // Huy hiệu thông báo Android: hình đơn sắc, chỉ lấy độ trong suốt
  if (key === "badge") {
    return new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: size / 2, background: "#ffffff", color: "#000000", fontSize: size * 0.3, fontWeight: 900 }}>
          {b.shortName}
        </div>
      ),
      { width: size, height: size, headers }
    );
  }

  const fg = b.primaryColor;
  const logo = b.logoUrl ? await loadLogo(b.logoUrl) : null;
  return new ImageResponse(
    logo ? (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#ffffff", padding: size * pad }}>
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
        <img src={logo} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
      </div>
    ) : (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: fg, color: readableOn(fg), fontSize: size * (pad > 0.15 ? 0.22 : 0.28) * (b.shortName.length > 3 ? 0.8 : 1), fontWeight: 900, letterSpacing: -size * 0.01 }}>
        {b.shortName}
      </div>
    ),
    { width: size, height: size, headers }
  );
}

/** Tải logo về và nhúng thẳng vào ảnh (lỗi mạng → dùng biểu tượng chữ thay vì hỏng cả biểu tượng). */
async function loadLogo(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !/^image\/(png|jpeg)/.test(type)) return null;
    const data = Buffer.from(await res.arrayBuffer()).toString("base64");
    return `data:${type};base64,${data}`;
  } catch {
    return null;
  }
}
