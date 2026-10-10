"use client";

import { useEffect } from "react";
import { useOnline } from "@/components/useOnline";

export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const online = useOnline();

  // Lỗi do mất mạng → có mạng lại thì tự thử lại
  useEffect(() => {
    if (online) return;
    window.addEventListener("online", retry, { once: true });
    return () => window.removeEventListener("online", retry);
  }, [online, retry]);

  return (
    <div className="card mx-auto max-w-md p-6 text-center">
      <h2 className="text-lg font-bold">{online ? "Đã có lỗi xảy ra" : "Mất kết nối mạng"}</h2>
      <p className="mt-2 text-sm text-neutral-500">
        {online ? (
          <>
            Hệ thống không tải được dữ liệu. Vui lòng thử lại.
            {error.digest && <span className="mt-1 block text-xs">Mã lỗi: {error.digest}</span>}
          </>
        ) : (
          "Kiểm tra Wi-Fi hoặc 4G. Trang sẽ tự tải lại khi có mạng."
        )}
      </p>
      <button type="button" onClick={() => retry()} className="btn-primary mt-5">
        Thử lại
      </button>
    </div>
  );
}
