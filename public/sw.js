// Service worker:
//  - nhận thông báo đẩy (kể cả khi app đóng / màn hình tắt) và mở đúng trang khi bấm;
//  - mở trang khi mất mạng → trả trang "Mất kết nối" (public/offline.html) thay cho lỗi của trình duyệt.
// Chỉ lưu sẵn trang báo mất mạng + biểu tượng; dữ liệu app KHÔNG lưu trên máy (luôn lấy mới từ server).
const OFFLINE_CACHE = "offline-v1";
const OFFLINE_URL = "/offline.html";
const OFFLINE_ASSETS = [OFFLINE_URL, "/icons/192"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(OFFLINE_CACHE)
      // Từng file riêng: lỗi 1 file không làm hỏng việc cài service worker (thông báo đẩy vẫn chạy)
      .then((cache) => Promise.all(OFFLINE_ASSETS.map((url) => cache.add(url).catch(() => undefined))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== OFFLINE_CACHE).map((key) => caches.delete(key)));
      // Tải trang song song với lúc khởi động service worker → không làm chậm khi có mạng
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    (async () => {
      try {
        const preloaded = await event.preloadResponse;
        if (preloaded) return preloaded;
        return await fetch(event.request);
      } catch {
        const cached = await caches.match(OFFLINE_URL, { cacheName: OFFLINE_CACHE });
        return cached || Response.error();
      }
    })()
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Bò Mỹ Đen", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Bò Mỹ Đen";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icons/192",
      badge: "/icons/badge",
      tag: data.tag,
      renotify: Boolean(data.tag),
      requireInteraction: title.startsWith("🔴"),
      vibrate: [200, 100, 200],
      data: { url: data.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
