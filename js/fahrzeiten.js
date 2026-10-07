// Echte Fahrzeiten über OpenRouteService (kostenloser Tarif).
// - Es werden NUR Koordinaten gesendet (Mittelpunkt der PLZ bzw. Startadresse), keine Namen.
// - Die Entfernungen werden einmal als Tabelle berechnet und gespeichert; danach nur Neues nachrechnen.
// - Die App zählt ihre Anfragen und bleibt deutlich unter den Gratis-Grenzen. Ist die Grenze erreicht
//   oder der Dienst gestört, wird mit der Schätzung weitergerechnet – es entstehen nie Kosten.

const ORS_URL = "https://api.openrouteservice.org/v2/matrix/driving-car";
export const GRENZE_TAG = 400;      // OpenRouteService erlaubt im Gratis-Tarif 500 Matrix-Anfragen pro Tag
const GRENZE_MINUTE = 30;           // erlaubt sind 40 pro Minute
const MAX_ROUTEN = 3500;            // höchstens Start × Ziel je Anfrage
const ZAEHLER_KEY = "tourenplaner-ors-zaehler";

export const punktKey = p => p.lat.toFixed(4) + "," + p.lng.toFixed(4);

/* ---------- Tabelle ---------- */
// Tabelle: { punkte: ["lat,lng", ...], km: Uint16Array (km × 10), min: Uint16Array (Minuten), Wert 65535 = unbekannt }
const LEER = 65535;
export function neueTabelle() { return { punkte: [], km: new Uint16Array(0), min: new Uint16Array(0), index: new Map() }; }

function umbauen(t, punkte) {
  const n = punkte.length, km = new Uint16Array(n * n).fill(LEER), min = new Uint16Array(n * n).fill(LEER);
  const alt = t.punkte.length; const neuIdx = punkte.map(p => t.index.has(p) ? t.index.get(p) : -1);
  for (let i = 0; i < n; i++) {
    const ai = neuIdx[i]; if (ai < 0) continue;
    for (let j = 0; j < n; j++) { const aj = neuIdx[j]; if (aj < 0) continue; km[i * n + j] = t.km[ai * alt + aj]; min[i * n + j] = t.min[ai * alt + aj]; }
    km[i * n + i] = 0; min[i * n + i] = 0;
  }
  for (let i = 0; i < n; i++) { km[i * n + i] = 0; min[i * n + i] = 0; }
  return { punkte, km, min, index: new Map(punkte.map((p, i) => [p, i])) };
}
// Fehlende Punkte aufnehmen (vorhandene Werte bleiben erhalten).
export function punkteErgaenzen(t, punkte) {
  const neu = [...new Set(punkte)].filter(p => !t.index.has(p));
  if (!neu.length) return t;
  return umbauen(t, t.punkte.concat(neu));
}
export function wert(t, a, b) {
  const i = t.index.get(a), j = t.index.get(b); if (i == null || j == null) return null;
  const n = t.punkte.length, k = t.km[i * n + j], m = t.min[i * n + j];
  return k === LEER || m === LEER ? null : { km: k / 10, min: m };
}
export function fehlendePaare(t) {
  const n = t.punkte.length; let f = 0;
  for (let x = 0; x < n * n; x++) if (t.km[x] === LEER) f++;
  return f;
}

/* ---------- Speichern als Text (für Gerät und Google Drive) ---------- */
const b64 = u16 => { const b = new Uint8Array(u16.buffer, u16.byteOffset, u16.byteLength); let s = ""; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192)); return btoa(s); };
const unb64 = s => { const bin = atob(s); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return new Uint16Array(b.buffer); };
export function alsText(t) { return JSON.stringify({ v: 1, quelle: "OpenRouteService", punkte: t.punkte, km: b64(t.km), min: b64(t.min) }); }
export function ausText(s) {
  const o = JSON.parse(s); if (!o || o.v !== 1) return neueTabelle();
  return { punkte: o.punkte, km: unb64(o.km), min: unb64(o.min), index: new Map(o.punkte.map((p, i) => [p, i])) };
}

/* ---------- Anfragen zählen ---------- */
const heute = () => new Date().toISOString().slice(0, 10);
export function zaehlerLesen(store = globalThis.localStorage) {
  try { const z = JSON.parse(store.getItem(ZAEHLER_KEY) || "{}"); return z.tag === heute() ? z.anzahl : 0; } catch (e) { return 0; }
}
function zaehlen(store) { try { store.setItem(ZAEHLER_KEY, JSON.stringify({ tag: heute(), anzahl: zaehlerLesen(store) + 1 })); } catch (e) { /* egal */ } }

/* ---------- Berechnen ---------- */
// Teilt die fehlenden Verbindungen in Anfragen auf (höchstens 3500 Verbindungen je Anfrage).
function bloecke(Q, Z) {
  if (!Q.length || !Z.length) return [];
  const qB = Math.max(1, Math.min(Q.length, Math.floor(MAX_ROUTEN / Math.min(Z.length, MAX_ROUTEN))));
  const zB = Math.min(Z.length, Math.floor(MAX_ROUTEN / qB));
  const out = [];
  for (let q = 0; q < Q.length; q += qB) for (let z = 0; z < Z.length; z += zB) out.push({ quellen: Q.slice(q, q + qB), ziele: Z.slice(z, z + zB) });
  return out;
}
export function anfragenPlanen(t) {
  const n = t.punkte.length; const neu = [], teilweise = [], fehlZiele = new Set();
  for (let i = 0; i < n; i++) {
    const z = []; for (let j = 0; j < n; j++) if (t.km[i * n + j] === LEER) z.push(j);
    if (!z.length) continue;
    if (z.length >= n - 1) neu.push(i); else { teilweise.push(i); z.forEach(j => fehlZiele.add(j)); }
  }
  const alle = [...Array(n).keys()];
  // neue Punkte: zu allen anderen; übrige Punkte: nur zu den noch fehlenden Zielen
  return bloecke(neu, alle).concat(bloecke(teilweise, [...fehlZiele].sort((a, b) => a - b)));
}

// Rechnet fehlende Verbindungen aus. fortschritt(fertig, gesamt) wird nach jeder Anfrage aufgerufen.
// Rückgabe: { tabelle, fertig, gesamt, abbruch } – abbruch enthält den Grund, falls vorzeitig beendet.
export async function berechnen(t, schluessel, { fortschritt = () => {}, fetchFn = globalThis.fetch, store = globalThis.localStorage, warten = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const anfragen = anfragenPlanen(t); const n = t.punkte.length;
  let fertig = 0; const imMinutenfenster = [];
  for (const a of anfragen) {
    if (zaehlerLesen(store) >= GRENZE_TAG) return { tabelle: t, fertig, gesamt: anfragen.length, abbruch: "Tagesgrenze erreicht – morgen geht es automatisch weiter" };
    // Tempo bremsen: höchstens GRENZE_MINUTE Anfragen pro Minute
    const jetzt = Date.now(); while (imMinutenfenster.length && jetzt - imMinutenfenster[0] > 60e3) imMinutenfenster.shift();
    if (imMinutenfenster.length >= GRENZE_MINUTE) await warten(60e3 - (jetzt - imMinutenfenster[0]) + 500);
    imMinutenfenster.push(Date.now());
    const pts = a.quellen.concat(a.ziele).map(i => t.punkte[i].split(",").map(Number));
    let r;
    try {
      zaehlen(store);
      r = await fetchFn(ORS_URL, {
        method: "POST", headers: { "Authorization": schluessel, "Content-Type": "application/json" },
        body: JSON.stringify({ locations: pts.map(([lat, lng]) => [lng, lat]), sources: a.quellen.map((_, k) => k), destinations: a.ziele.map((_, k) => a.quellen.length + k), metrics: ["distance", "duration"], units: "km" }),
      });
    } catch (e) { return { tabelle: t, fertig, gesamt: anfragen.length, abbruch: "Keine Internetverbindung" }; }
    if (r.status === 401 || r.status === 403) return { tabelle: t, fertig, gesamt: anfragen.length, abbruch: "Schlüssel ungültig oder gesperrt" };
    if (r.status === 429) return { tabelle: t, fertig, gesamt: anfragen.length, abbruch: "Gratis-Grenze von OpenRouteService erreicht – später geht es weiter" };
    if (!r.ok) return { tabelle: t, fertig, gesamt: anfragen.length, abbruch: "OpenRouteService antwortet nicht (Fehler " + r.status + ")" };
    const d = await r.json();
    a.quellen.forEach((qi, x) => a.ziele.forEach((zi, y) => {
      const k = d.distances?.[x]?.[y], m = d.durations?.[x]?.[y];
      // nicht erreichbar (z. B. Insel ohne Straße): als 0 xx speichern geht nicht -> unbekannt lassen, aber nicht erneut fragen
      t.km[qi * n + zi] = k == null ? LEER - 1 : Math.min(LEER - 2, Math.round(k * 10));
      t.min[qi * n + zi] = m == null ? LEER - 1 : Math.min(LEER - 2, Math.round(m / 60));
    }));
    fertig++; fortschritt(fertig, anfragen.length);
  }
  return { tabelle: t, fertig, gesamt: anfragen.length, abbruch: null };
}

/* ---------- Anschluss an die Planung ---------- */
// Liefert eine Funktion (a, b) -> { km, min } oder null (dann schätzt die Planung).
// zuschlag: Prozent auf die Fahrzeit (OpenRouteService rechnet ohne Verkehr).
export function fahrtQuelle(t, zuschlag = 0) {
  const f = 1 + (zuschlag || 0) / 100;
  return (a, b) => {
    if (a.lat == null || b.lat == null) return null;
    const ka = punktKey(a), kb = punktKey(b);
    if (ka === kb) return a.id && a.id === b.id ? { km: 0, min: 0 } : { km: 3, min: 6 }; // gleiche PLZ, anderer Kunde
    const w = wert(t, ka, kb);
    if (!w || w.km >= (LEER - 2) / 10) return null;
    return { km: w.km, min: w.min * f };
  };
}
