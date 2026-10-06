"use client";

export type GeoResult =
  | { ok: true; lat: number; lng: number; accuracy: number }
  | { ok: false; message: string };

/** Lấy vị trí GPS hiện tại của trình duyệt (yêu cầu HTTPS hoặc localhost). */
export function getCurrentPosition(timeoutMs = 12000): Promise<GeoResult> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ ok: false, message: "Thiết bị không hỗ trợ định vị." });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          ok: true,
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        }),
      (error) => {
        const message =
          error.code === error.PERMISSION_DENIED
            ? "Bạn chưa cho phép truy cập vị trí. Hãy bật quyền vị trí cho trang này trong cài đặt trình duyệt."
            : error.code === error.TIMEOUT
              ? "Lấy vị trí quá lâu. Hãy thử lại ở chỗ thoáng."
              : "Không lấy được vị trí.";
        resolve({ ok: false, message });
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }
    );
  });
}
