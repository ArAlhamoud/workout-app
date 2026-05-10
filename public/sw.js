self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Rest complete!', {
      body: data.body ?? 'Time for your next set',
      icon: '/icon',
      badge: '/icon',
      tag: 'rest-timer',
      renotify: true,
      vibrate: [200, 100, 200],
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window' }).then((clients) => {
    const focused = clients.find((c) => c.focused);
    if (focused) return focused.focus();
    if (clients.length > 0) return clients[0].focus();
    return self.clients.openWindow('/');
  }));
});

// Handle timer messages from the page
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SCHEDULE_NOTIFICATION') {
    const { delayMs, title, body } = event.data;
    setTimeout(() => {
      self.registration.showNotification(title, {
        body,
        icon: '/icon',
        tag: 'rest-timer',
        renotify: true,
        vibrate: [200, 100, 200],
      });
    }, delayMs);
  }
  if (event.data?.type === 'CANCEL_NOTIFICATION') {
    self.registration.getNotifications({ tag: 'rest-timer' }).then((ns) =>
      ns.forEach((n) => n.close()),
    );
  }
});
