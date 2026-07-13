self.addEventListener('push', event => {
  let data = {}
  if (event.data) {
    try { data = event.data.json() }
    catch { data = { body: event.data.text() } }
  }
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
  let target = self.location.origin
  try {
    const requested = new URL(event.notification.data?.url ?? '/', self.location.origin)
    if (requested.origin === self.location.origin) target = requested.href
  } catch { /* Invalid notification links always fall back to the app root. */ }
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
    const exact = windowClients.find(client => client.url === target)
    if (exact) return exact.focus()
    const existing = windowClients.find(client => new URL(client.url).origin === self.location.origin)
    return existing ? existing.navigate(target).then(client => client?.focus()) : clients.openWindow(target)
  }))
})
