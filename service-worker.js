/* service-worker.js */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(clients.claim()));
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    // If DevTools sends plain text
    data = { title: "Family Values Group", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Family Values Group";
  const options = {
    body: data.body || "You have a new notification.",
    icon: data.icon || "/Pics/img17.png",      // update if needed
    badge: data.badge || "/Pics/img17.png",    // update if needed
    data: {
      url: data.url || "/scheduling.html", // update path if needed
      ...data.data,
    },
    tag: data.tag || "fvg-push",
    renotify: !!data.renotify,
    requireInteraction: !!data.requireInteraction,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = (event.notification?.data && event.notification.data.url) || "/";

  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: "window", includeUncontrolled: true });

    // 1) Prefer a tab already on the target URL
    for (const client of allClients) {
      if (client.url === new URL(url, self.location.origin).href) {
        await client.focus();
        return;
      }
    }

    // 2) Otherwise prefer any tab on our origin
    for (const client of allClients) {
      const sameOrigin = client.url.startsWith(self.location.origin);
      if (sameOrigin) {
        await client.focus();
        try { await client.navigate(url); } catch (_) {}
        return;
      }
    }

    // 3) Otherwise open a new tab
    await clients.openWindow(url);
  })());
});
