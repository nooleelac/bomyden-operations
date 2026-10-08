"use client";

import { useEffect, useState } from "react";
import { getCurrentSubscription, isIos, isPushSupported, isStandalone, subscribePush } from "@/components/push";
import { removePushSubscription, savePushSubscription } from "@/app/(app)/notifications/actions";

type Status = "loading" | "unsupported" | "ios-install" | "denied" | "off" | "on";

/**
 * Bật/tắt thông báo đẩy trên thiết bị đang dùng.
 * compact = lời mời ngắn ở trang chủ (ẩn khi đã bật hoặc không hỗ trợ).
 */
export default function PushToggle({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<Status>("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let next: Status;
      if (isIos() && !isStandalone()) next = "ios-install";
      else if (!isPushSupported()) next = "unsupported";
      else if (Notification.permission === "denied") next = "denied";
      else next = (await getCurrentSubscription()) && Notification.permission === "granted" ? "on" : "off";
      if (!cancelled) setStatus(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    setBusy(true);
    setMessage("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "off");
        return;
      }
      const subscription = await subscribePush();
      const result = await savePushSubscription(subscription.toJSON(), navigator.userAgent);
      setMessage(result.message);
      if (result.ok) setStatus("on");
    } catch {
      setMessage("Không bật được thông báo trên trình duyệt này.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMessage("");
    try {
      const subscription = await getCurrentSubscription();
      if (subscription) {
        await removePushSubscription(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setStatus("off");
      setMessage("Đã tắt thông báo trên thiết bị này.");
    } finally {
      setBusy(false);
    }
  }

  if (compact) {
    if (status !== "off" && status !== "ios-install") return null;
    return (
      <div className="card mb-6 flex flex-wrap items-center gap-3 border-amber-300 bg-amber-50 p-4 text-sm">
        <span className="text-2xl" aria-hidden="true">🔔</span>
        <p className="min-w-48 flex-1 text-amber-900">
          {status === "ios-install"
            ? "Để nhận nhắc việc trên iPhone: bấm nút Chia sẻ → “Thêm vào MH chính”, rồi mở app từ màn hình chính và bật thông báo."
            : "Bật thông báo để được nhắc việc sắp hết hạn và quá hạn, kể cả khi tắt màn hình."}
        </p>
        {status === "off" && (
          <button type="button" onClick={enable} disabled={busy} className="btn-primary">
            {busy ? "Đang bật..." : "Bật thông báo"}
          </button>
        )}
        {message && <p className="w-full text-xs text-red-700">{message}</p>}
      </div>
    );
  }

  return (
    <section className="card mt-6 p-5 sm:p-6">
      <h2 className="font-semibold">Thông báo trên thiết bị này</h2>
      <p className="mt-1 text-sm text-neutral-500">
        Nhắc việc checklist trước hạn chót 30 phút và khi quá hạn. Hiện lên cả khi app đóng hoặc màn hình tắt.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {status === "loading" && <span className="text-sm text-neutral-500">Đang kiểm tra...</span>}
        {status === "on" && (
          <>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700">● Đang bật</span>
            <button type="button" onClick={disable} disabled={busy} className="btn-secondary">
              {busy ? "Đang tắt..." : "Tắt thông báo"}
            </button>
          </>
        )}
        {status === "off" && (
          <button type="button" onClick={enable} disabled={busy} className="btn-primary">
            {busy ? "Đang bật..." : "Bật thông báo"}
          </button>
        )}
        {status === "denied" && (
          <p className="text-sm text-red-700">
            Bạn đã chặn thông báo cho trang này. Vào cài đặt trình duyệt / điện thoại → Thông báo → cho phép Bò Mỹ Đen, rồi tải lại trang.
          </p>
        )}
        {status === "ios-install" && (
          <p className="text-sm text-neutral-700">
            Trên iPhone (iOS 16.4 trở lên): mở trang này bằng Safari → bấm nút Chia sẻ → “Thêm vào MH chính”. Sau đó mở app từ
            màn hình chính và bấm “Bật thông báo”.
          </p>
        )}
        {status === "unsupported" && (
          <p className="text-sm text-neutral-500">Trình duyệt này không hỗ trợ thông báo đẩy. Hãy dùng Chrome (Android) hoặc Safari (iPhone).</p>
        )}
      </div>
      {message && <p className="mt-3 text-sm text-neutral-600">{message}</p>}
    </section>
  );
}
