// Service Worker for MG iSMART India EV Companion PWA
// Handles Background Web Push Notifications (Critical 12V warning, Trip Start/End, Charging Start/End)

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch (e) {
      payload = { title: 'MG Windsor EV', body: event.data.text() };
    }
  }

  const title = payload.title || '⚡ MG Windsor EV';
  const options = {
    body: payload.body || 'Vehicle status update',
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: payload.tag || 'windsor-alert',
    renotify: true,
    data: payload.data || {},
    silent: false,
    vibrate: [200, 100, 200],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});
