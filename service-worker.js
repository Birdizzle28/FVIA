self.addEventListener("push", function (event) {
  const data = event.data ? event.data.json() : {};

  const title = data.title || "New Notification";
  const options = {
    body: data.body || "You have an update.",
    icon: "/Pics/img17.png",
    badge: "/Pics/img17.png"
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});
