// Сервис-воркер для установки на главный экран. Сначала сеть (чтобы обновления приходили сразу),
// кэш — только запасной вариант без интернета. Рейтинг (Supabase) не кэшируется.
const CACHE = 'fieldx-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.url.includes('supabase.co')) return;
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok && (res.type === 'basic' || res.type === 'cors')) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req)),
  );
});
