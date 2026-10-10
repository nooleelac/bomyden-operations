"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useOnline } from "@/components/useOnline";

/**
 * Thanh báo trạng thái mạng (đặt 1 lần ở layout):
 *  - Mất mạng → báo ngay, dữ liệu trên màn hình có thể chưa mới.
 *  - Có mạng lại → báo "Đã kết nối lại" vài giây + tải lại dữ liệu trang.
 */
export default function NetworkStatus() {
  const online = useOnline();
  const router = useRouter();
  const wasOffline = useRef(false);
  const [reconnected, setReconnected] = useState(false);

  useEffect(() => {
    if (!online) {
      wasOffline.current = true;
      return;
    }
    if (!wasOffline.current) return;
    wasOffline.current = false;
    router.refresh();
    setReconnected(true);
    const timer = setTimeout(() => setReconnected(false), 3000);
    return () => clearTimeout(timer);
  }, [online, router]);

  if (online && !reconnected) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--nav-h)+0.75rem)] z-40 flex justify-center px-4"
    >
      <p
        className={`flex max-w-md items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-white shadow-lg ${
          online ? "bg-emerald-600" : "bg-neutral-900"
        }`}
      >
        <span aria-hidden="true">{online ? "✓" : "⚠"}</span>
        {online ? "Đã kết nối lại — đang cập nhật dữ liệu" : "Mất kết nối mạng — dữ liệu có thể chưa mới, chưa gửi được thao tác"}
      </p>
    </div>
  );
}
