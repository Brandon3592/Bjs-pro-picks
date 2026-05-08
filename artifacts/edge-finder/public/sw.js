self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "BJ's Pro Picks Alert", body: event.data.text() };
  }

  const title = payload.title ?? "BJ's Pro Picks Alert";
  const options = {
    body: payload.body ?? "",
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    tag: payload.tag ?? "bjspropicks",
    data: payload.data ?? {},
    requireInteraction: false,
    vibrate: [200, 100, 200],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Focus an existing tab if open
        for (const client of clientList) {
          if ("focus" in client) return client.focus();
        }
        // Otherwise open a new window
        if (clients.openWindow) return clients.openWindow("/");
      }),
  );
});
