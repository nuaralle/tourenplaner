// Genaue Lage der Kunden aus der Adresse (OpenRouteService, kostenloser Tarif; 2026-10-09).
// Gesendet werden NUR Straße, PLZ und Ort – kein Firmenname, keine anderen Kundendaten.
// Ergebnis steht beim Kunden in „geo“ (Excel-Spalte „Lage (Breite, Länge)“): "53.07581, 8.80723" oder "PLZ-Mitte",
// wenn die Adresse nicht sicher gefunden wurde. Leer = noch nicht bestimmt.
import { luftlinie } from "./grundlagen.js";

const GEO_URL = "https://api.openrouteservice.org/geocode/search/structured";
export const GRENZE_TAG = 900;      // Gratis-Tarif: 1000 Abfragen pro Tag
const PAUSE_MS = 1100;              // höchstens ~55 pro Minute (erlaubt: 100)
const ZAEHLER_KEY = "tourenplaner-ors-geo-zaehler";
export const PLZ_MITTE = "PLZ-Mitte";
const MAX_ABSTAND_KM = 25;          // weiter weg von der PLZ-Mitte = vermutlich falscher Treffer

export function geoPunkt(s) {
  const m = String(s || "").match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
  return m ? { lat: +m[1], lng: +m[2] } : null;
}
export const geoText = p => p.lat.toFixed(5) + ", " + p.lng.toFixed(5);
// Braucht dieser Kunde noch eine Lage? (aktiv, Adresse vorhanden, noch nicht bestimmt)
export const brauchtLage = k => !k.inactive && !k.geo && !!String(k.str || "").trim() && /^\d{5}$/.test(String(k.plz || ""));
// Adresse geändert -> Lage neu bestimmen
export const adresseGeaendert = (alt, neu) => ["str", "plz", "ort"].some(f => String(alt[f] || "").trim() !== String(neu[f] || "").trim());

const heute = () => new Date().toISOString().slice(0, 10);
export function zaehlerLesen(store = globalThis.localStorage) {
  try { const z = JSON.parse(store.getItem(ZAEHLER_KEY) || "{}"); return z.tag === heute() ? z.anzahl : 0; } catch (e) { return 0; }
}
function zaehlen(store) { try { store.setItem(ZAEHLER_KEY, JSON.stringify({ tag: heute(), anzahl: zaehlerLesen(store) + 1 })); } catch (e) { /* egal */ } }

// Antwort auswerten: nur Treffer auf Adress- oder Straßen-Ebene, nah genug an der PLZ-Mitte
export function auswerten(daten, plzMitte) {
  const f = (daten && daten.features || [])[0]; if (!f) return PLZ_MITTE;
  const p = f.properties || {}, [lng, lat] = f.geometry && f.geometry.coordinates || [];
  if (!["address", "street"].includes(p.layer) || lat == null || lng == null) return PLZ_MITTE;
  if (plzMitte && luftlinie({ lat, lng }, plzMitte) > MAX_ABSTAND_KM) return PLZ_MITTE;
  return geoText({ lat, lng });
}

// Lage für mehrere Kunden bestimmen. kunden: Rohdaten (werden direkt geändert: k.geo).
// plzMitte(plz) -> { lat, lng } | null. fortschritt(fertig, gesamt) nach jeder Abfrage; zwischendurch(n) alle 25 Kunden (zum Speichern).
// Rückgabe: { fertig, gesamt, abbruch }
export async function bestimmen(kunden, schluessel, { plzMitte = () => null, fortschritt = () => {}, zwischendurch = () => {}, fetchFn = globalThis.fetch, store = globalThis.localStorage, warten = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const L = kunden.filter(brauchtLage); let fertig = 0;
  for (const k of L) {
    if (zaehlerLesen(store) >= GRENZE_TAG) return { fertig, gesamt: L.length, abbruch: "Tagesgrenze erreicht – morgen geht es automatisch weiter" };
    const q = new URLSearchParams({ address: String(k.str).trim(), postalcode: String(k.plz), locality: String(k.ort || "").trim(), country: "DE", size: "1" });
    let r;
    try { zaehlen(store); r = await fetchFn(GEO_URL + "?" + q, { headers: { Authorization: schluessel } }); }
    catch (e) { return { fertig, gesamt: L.length, abbruch: "Keine Internetverbindung" }; }
    if (r.status === 401 || r.status === 403) return { fertig, gesamt: L.length, abbruch: "Schlüssel ungültig oder gesperrt" };
    if (r.status === 429) return { fertig, gesamt: L.length, abbruch: "Gratis-Grenze von OpenRouteService erreicht – später geht es weiter" };
    if (!r.ok) return { fertig, gesamt: L.length, abbruch: "OpenRouteService antwortet nicht (Fehler " + r.status + ")" };
    k.geo = auswerten(await r.json(), plzMitte(k.plz));
    fertig++; fortschritt(fertig, L.length);
    if (fertig % 25 === 0) zwischendurch(fertig);
    if (fertig < L.length) await warten(PAUSE_MS);
  }
  return { fertig, gesamt: L.length, abbruch: null };
}
