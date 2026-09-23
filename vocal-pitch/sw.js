// Офлайн-кеш страницы тренажёра. Дрон синтезируется в браузере, поэтому офлайн работает без звуковых файлов.
const V = 'pitch-v1';
const CORE = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-180.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(CORE)).then(() => self.skipWaiting()).catch(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;                       // дубли и статистика уходят на сервер напрямую
  const u = new URL(r.url);
  if (u.pathname.startsWith('/vocal-api/')) return;     // данные всегда с сервера
  e.respondWith(
    caches.match(r).then(hit => {
      const net = fetch(r).then(res => {
        if (res && res.ok && u.origin === location.origin) {
          const copy = res.clone(); caches.open(V).then(c => c.put(r, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || net;                                 // из кеша сразу, обновление в фоне
    })
  );
});
