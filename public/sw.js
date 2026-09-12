/* Only the empty app shell and static assets are cached. No API, photo uploads,
   journal entries, auth endpoints, or source links enter this cache. */
const CACHE = 'ember-shell-v1';
const SHELL_MARKER = 'name="application-name" content="Ember"';
const STATIC = ['/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/images/cigars.png', '/images/after-hours-poster.png'];

async function cacheShell(cache) {
  const response = await fetch('/', { credentials: 'same-origin', cache: 'reload' });
  if (response.ok && !response.redirected && response.headers.get('content-type')?.includes('text/html')) {
    const html = await response.clone().text();
    if (html.includes(SHELL_MARKER)) {
      await cache.put('/', response);
      const assets = Array.from(html.matchAll(/(?:src|href)="([^"#]+\.(?:js|css)(?:\?[^"#]*)?)"/g), match => match[1]);
      await Promise.allSettled(assets.filter(path => path.startsWith('/') && !path.startsWith('//')).map(path => cache.add(path)));
    }
  }
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(STATIC.map(path => cache.add(path)));
    await cacheShell(cache).catch(() => undefined);
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('ember-shell-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/__') || url.pathname.includes('auth')) return;
  if (request.mode === 'navigate' && url.pathname === '/') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok && !response.redirected && (await response.clone().text()).includes(SHELL_MARKER)) {
          const cache = await caches.open(CACHE);
          await cache.put('/', response.clone());
        }
        return response;
      } catch {
        return await caches.match('/') || new Response('Open Ember once while online to make the journal available here.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
    })());
  } else if (STATIC.includes(url.pathname) || /^\/(assets|_next\/static)\/.*\.(js|css|woff2)$/.test(url.pathname)) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && !response.redirected) { const cache = await caches.open(CACHE); await cache.put(request, response.clone()); }
      return response;
    })());
  }
});
