import { ImageResponse } from "next/og";

// Biểu tượng app (PNG) vẽ bằng code: /icons/192, /icons/512, /icons/maskable, /icons/badge
const VARIANTS = {
  "192": { size: 192, pad: 0 },
  "512": { size: 512, pad: 0 },
  maskable: { size: 512, pad: 0.12 },
  badge: { size: 96, pad: 0 },
} as const;

export function generateStaticParams() {
  return Object.keys(VARIANTS).map((size) => ({ size }));
}

export async function GET(_request: Request, { params }: RouteContext<"/icons/[size]">) {
  const { size: key } = await params;
  const variant = VARIANTS[key as keyof typeof VARIANTS];
  if (!variant) return new Response("Not found", { status: 404 });
  const { size, pad } = variant;
  const badge = key === "badge";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: badge ? "transparent" : "#171717",
          padding: size * pad,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            height: "100%",
            borderRadius: badge ? size / 2 : 0,
            background: badge ? "#ffffff" : "#171717",
            color: badge ? "#000000" : "#ffffff",
            fontSize: size * (pad ? 0.26 : 0.3),
            fontWeight: 900,
            letterSpacing: -size * 0.01,
          }}
        >
          BMĐ
        </div>
      </div>
    ),
    { width: size, height: size }
  );
}
