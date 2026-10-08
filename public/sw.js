// Service worker: nhận thông báo đẩy (kể cả khi app đóng / màn hình tắt) và mở đúng trang khi bấm.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

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
