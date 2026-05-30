/* Diamond Sealing — Service Worker for Web Push Notifications */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Diamond Sealing", body: event.data.text(), actionUrl: "/field" };
  }

  const title = payload.title || "Diamond Sealing";
  const options = {
    body: payload.body || "",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    tag: payload.tag || payload.type || "ds-notification",
    data: { actionUrl: payload.actionUrl || "/field" },
    requireInteraction: payload.priority === "urgent",
    actions: payload.actionLabel
      ? [{ action: "open", title: payload.actionLabel }]
      : [],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const actionUrl = event.notification.data?.actionUrl || "/field";
  const base = self.location.origin;
  const targetUrl = base + actionUrl;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(base) && "focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
