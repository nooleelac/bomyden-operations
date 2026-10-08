import { ImageResponse } from "next/og";

// Biểu tượng khi "Thêm vào màn hình chính" trên iPhone
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#171717",
          color: "#ffffff",
          fontSize: 54,
          fontWeight: 900,
        }}
      >
        BMĐ
      </div>
    ),
    size
  );
}
