// Zwischenspeicher, damit die App auch ohne Netz startet.
// Programmdateien: zuerst aus dem Netz (immer aktuell), bei fehlendem Netz aus dem Zwischenspeicher.
// „no-cache“: beim Netz immer nachfragen, ob es eine neue Fassung gibt (sonst nimmt das iPhone bis zu 10 Min. die alte).
// Anfragen an Google, OpenRouteService und OpenStreetMap werden NICHT zwischengespeichert.
// Die Schrift liegt im Programm (Ordner schrift/), es wird nichts von Google Fonts geladen (2026-11-11).
const CACHE = "tourenplaner-v37";
const DATEIEN = ["./", "index.html", "style.css", "manifest.webmanifest", "icon-180.png", "icon-192.png", "vendor/xlsx.full.min.js", "vendor/pdf-lib.min.js",
  "js/app.js", "js/planung.js", "js/grundlagen.js", "js/excel.js", "js/plz.js", "js/speicher.js", "js/fahrzeiten.js", "js/google.js", "js/konfig.js", "js/bestellung.js", "js/beanstandung.js", "js/auswertung.js", "js/naehe.js", "js/neukunden.js", "js/kalender.js",
  "schrift/schrift.css", "schrift/barlow-400-latin-ext.woff2", "schrift/barlow-400-latin.woff2", "schrift/barlow-500-latin-ext.woff2", "schrift/barlow-500-latin.woff2", "schrift/barlow-600-latin-ext.woff2", "schrift/barlow-600-latin.woff2", "schrift/barlow-semi-condensed-500-latin-ext.woff2", "schrift/barlow-semi-condensed-500-latin.woff2", "schrift/barlow-semi-condensed-600-latin-ext.woff2", "schrift/barlow-semi-condensed-600-latin.woff2", "schrift/barlow-semi-condensed-700-latin-ext.woff2", "schrift/barlow-semi-condensed-700-latin.woff2"];

self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(DATEIEN.map(d => new Request(d, { cache: "reload" })))).then(() => self.skipWaiting())); });
// Beim Aktualisieren nur eigene alte Zwischenspeicher löschen: unter derselben Adresse (github.io) liegen auch andere Apps (z. B. KISY).
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n => n.startsWith("tourenplaner-") && n !== CACHE).map(n => caches.delete(n)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  const eigene = url.origin === self.location.origin && !url.pathname.includes("/lokal/");
  if (!eigene) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    try {
      const r = await fetch(url.href, { cache: "no-cache" });
      if (r.ok) c.put(e.request, r.clone());
      return r;
    } catch (err) {
      const alt = await c.match(e.request, { ignoreSearch: true });
      if (alt) return alt;
      throw err;
    }
  })());
});
