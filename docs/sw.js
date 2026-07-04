'use strict';
const CACHE = 'ki-tutor-v263';
const STATIC = ['./', './index.html', './app.js?v=263', './style.css?v=263', './icon.svg', './manifest.json'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks =>
    Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Never cache API calls or CDN resources
  const url = e.request.url;
  if (url.includes('/api/') || url.includes('cdn.') || url.includes('cdnjs.') || url.includes('anthropic.com')) return;

  // Network-first for app files: always try fresh, fall back to cache
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone()));
      return r;
    }).catch(() => caches.match(e.request))
  );
});
