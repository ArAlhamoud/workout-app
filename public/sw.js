self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Keep a reference so we can cancel the timer
let pendingTimer = null;

self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Rest complete!', {
      body: data.body ?? 'Time for your next set',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'rest-timer',
      renotify: true,
      vibrate: [200, 100, 200],
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      const focused = clients.find((c) => c.focused);
      if (focused) return focused.focus();
      if (clients.length > 0) return clients[0].focus();
      return self.clients.openWindow('/');
    }),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SCHEDULE_NOTIFICATION') {
    const { delayMs, title, body } = event.data;

    // Clear any existing pending timer
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }

    // event.waitUntil keeps the service worker alive until the promise resolves
    event.waitUntil(
      new Promise((resolve) => {
        pendingTimer = setTimeout(() => {
          pendingTimer = null;
          self.registration
            .showNotification(title, {
              body,
              icon: '/icon-192.png',
              badge: '/icon-192.png',
              tag: 'rest-timer',
              renotify: true,
              vibrate: [200, 100, 200],
              requireInteraction: false,
            })
            .then(resolve)
            .catch(resolve);
        }, delayMs);
      }),
    );
  }

  if (event.data?.type === 'CANCEL_NOTIFICATION') {
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    self.registration
      .getNotifications({ tag: 'rest-timer' })
      .then((ns) => ns.forEach((n) => n.close()));
  }
});
