/* service-worker.js */

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
      url: data.url || "/agent/scheduling.html", // update path if needed
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

  event.waitUntil(
    (async () => {
      const allClients = await clients.matchAll({ type: "window", includeUncontrolled: true });

      // If a tab is already open, focus it
      for (const client of allClients) {
        if (client.url.includes(self.location.origin)) {
          await client.focus();
          // Optionally navigate that tab
          try { await client.navigate(url); } catch (_) {}
          return;
        }
      }

      // Otherwise open a new tab
      await clients.openWindow(url);
    })()
  );
});
