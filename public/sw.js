/// <reference lib="webworker" />

// Activate immediately on install — don't wait for old SW to die
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});

self.addEventListener('push', (event) => {
    let data = {};
    if (event.data) {
        try {
            data = event.data.json();
        } catch {
            // If not valid JSON, use the text as the body
            data = { title: 'Sala 404', body: event.data.text() };
        }
    }

    const options = {
        body: data.body || 'Nueva actualización en Sala 404',
        icon: '/web-app-manifest-192x192.png',
        badge: '/favicon-96x96.png',
        data: {
            url: data.url || '/',
        },
        vibrate: [200, 100, 200],
        tag: data.tag || 'sala404',
        renotify: true,
    };

    event.waitUntil(
        self.registration.showNotification(data.title || 'Sala 404', options)
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const url = event.notification.data?.url || '/';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            // Focus existing window if found
            for (const client of windowClients) {
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    client.navigate(url);
                    return client.focus();
                }
            }
            // Open new window
            return clients.openWindow(url);
        })
    );
});
