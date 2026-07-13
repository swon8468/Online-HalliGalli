self.addEventListener('push', event => {
  const data = event.data?.json() ?? {}
  event.waitUntil(self.registration.showNotification(data.title ?? 'Halli Galli', {
    body: data.body ?? '새로운 알림이 도착했어요.',
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: data.tag ?? 'halli-galli-notification',
    data: { url: data.url ?? '/' },
  }))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const target = new URL(event.notification.data?.url ?? '/', self.location.origin).href
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
    const existing = windowClients.find(client => client.url === target)
    return existing ? existing.focus() : clients.openWindow(target)
  }))
})
