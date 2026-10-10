"use client";

import { useEffect } from "react";
import { getCurrentSubscription, getRegistration, isPushSupported } from "@/components/push";
import { savePushSubscription } from "@/app/(app)/notifications/actions";

/**
 * Đăng ký service worker (mọi thiết bị: thông báo đẩy + trang "Mất kết nối");
 * nếu thiết bị đã bật thông báo thì gắn lại thiết bị cho người đang đăng nhập
 * (máy dùng chung, hoặc trình duyệt đổi endpoint).
 */
export default function PushSync({ employeeId }: { employeeId: string }) {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let cancelled = false;
    (async () => {
      try {
        await getRegistration();
        if (!isPushSupported() || Notification.permission !== "granted") return;
        const subscription = await getCurrentSubscription();
        if (!subscription || cancelled) return;
        const key = `push-synced:${employeeId}:${subscription.endpoint}`;
        try {
          if (sessionStorage.getItem(key)) return;
        } catch {}
        const result = await savePushSubscription(subscription.toJSON(), navigator.userAgent);
        if (result.ok) {
          try {
            sessionStorage.setItem(key, "1");
          } catch {}
        }
      } catch {
        // Không chặn app nếu trình duyệt không cho đăng ký
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  return null;
}
