// My JFP service worker (Lee, 17 Oct 2026). Scope /jfp-account/.
// The page shell and its built files open from the phone with no signal;
// account data is never cached here (the page keeps its own last copy, and
// clears it on sign out). Push notifications are shown from here too.
const VERSION = 'jfp-acct-v1'
const SHELL = '/jfp-account/'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.add(SHELL)).catch(() => {}).then(() => self.skipWaiting()))
})
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('jfp-acct-') && k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return
  // The page: the network first (always the newest), the saved copy with no signal.
  if (req.mode === 'navigate' && url.pathname.startsWith('/jfp-account')) {
    event.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(SHELL, copy)) }
      return res
    }).catch(() => caches.match(SHELL).then((r) => r || Response.error())))
    return
  }
  // Built files have a hash in their name, so a saved one is always right.
  if (url.pathname.startsWith('/_astro/') || /\.(?:woff2?|webp|png|jpg|svg)$/.test(url.pathname)) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && (url.pathname.startsWith('/_astro/') || res.headers.get('content-length') < 600000)) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)) }
      return res
    })))
  }
})

// Push (feature 2): { title, body, url, tag }.
self.addEventListener('push', (event) => {
  let d = {}
  try { d = event.data ? event.data.json() : {} } catch { d = { title: 'Joner Football', body: event.data?.text() || '' } }
  event.waitUntil(self.registration.showNotification(d.title || 'Joner Football', {
    body: d.body || '', tag: d.tag || undefined, data: { url: d.url || SHELL },
    icon: '/android-chrome-192x192.png', badge: '/android-chrome-192x192.png',
  }))
})
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || SHELL, location.origin).href
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => c.url.startsWith(`${location.origin}/jfp-account`))
    if (open) { open.navigate(target).catch(() => {}); return open.focus() }
    return self.clients.openWindow(target)
  }))
})
