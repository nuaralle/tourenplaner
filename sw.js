// Zwischenspeicher, damit die App auch ohne Netz startet.
// Programmdateien: zuerst aus dem Netz (immer aktuell), bei fehlendem Netz aus dem Zwischenspeicher.
// Anfragen an Google und OpenRouteService werden NICHT zwischengespeichert.
const CACHE = "tourenplaner-v7";
const DATEIEN = ["./", "index.html", "style.css", "manifest.webmanifest", "icon-180.png", "icon-192.png", "vendor/xlsx.full.min.js", "vendor/pdf-lib.min.js",
  "js/app.js", "js/planung.js", "js/grundlagen.js", "js/excel.js", "js/plz.js", "js/speicher.js", "js/fahrzeiten.js", "js/google.js", "js/konfig.js", "js/bestellung.js", "js/beanstandung.js", "js/auswertung.js"];

self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(DATEIEN)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n => n !== CACHE).map(n => caches.delete(n)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  const eigene = url.origin === self.location.origin && !url.pathname.includes("/lokal/");
  const schrift = url.host === "fonts.googleapis.com" || url.host === "fonts.gstatic.com";
  if (!eigene && !schrift) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    try {
      const r = await fetch(e.request);
      if (r.ok) c.put(e.request, r.clone());
      return r;
    } catch (err) {
      const alt = await c.match(e.request, { ignoreSearch: true });
      if (alt) return alt;
      throw err;
    }
  })());
});
