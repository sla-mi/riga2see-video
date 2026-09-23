// Офлайн-кеш тренажёра. Страница — всегда из сети, если сеть есть (иначе правки не доезжают);
// иконки и манифест — из кеша. Дрон синтезируется в браузере, звуковые файлы не нужны.
const V = 'pitch-v3';
const CORE = ['./', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-180.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(CORE)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== location.origin) return;              // R2, сторонние адреса — мимо кеша
  if (u.pathname.startsWith('/vocal-api/')) return;      // данные всегда с сервера
  const isPage = r.mode === 'navigate' || u.pathname.endsWith('/') || u.pathname.endsWith('index.html');
  if (isPage) {                                          // страница: сеть, кеш только как запасной вариант
    e.respondWith(fetch(r).then(res => {
      const copy = res.clone(); caches.open(V).then(c => c.put(r, copy)); return res;
    }).catch(() => caches.match(r).then(hit => hit || caches.match('./'))));
    return;
  }
  e.respondWith(caches.match(r).then(hit => hit || fetch(r).then(res => {
    if (res && res.ok) { const copy = res.clone(); caches.open(V).then(c => c.put(r, copy)); }
    return res;
  })));
});
