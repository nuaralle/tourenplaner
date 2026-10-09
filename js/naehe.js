// „Kunden in der Nähe“: die nächsten Kunden zum aktuellen Standort, nur nach Entfernung sortiert (ohne Umsatz).
// Der Standort bleibt auf dem Gerät. Lage der Kunden: aus der Adresse, sonst Mitte des PLZ-Gebiets (wie in der Planung).
import { luftlinie, hhmm } from "./grundlagen.js";

// kunden: Liste mit lat/lng (z. B. P.CUST); pos: { lat, lng }. Ergebnis: [{ c, km }] – die n nächsten, nächste zuerst
export function naechste(kunden, pos, n = 20) {
  return kunden.filter(c => c.lat != null && c.lng != null)
    .map(c => ({ c, km: luftlinie(pos, c) }))
    .sort((a, b) => a.km - b.km || String(a.c.n1).localeCompare(String(b.c.n1)))
    .slice(0, n);
}
// Ist der Kunde jetzt geöffnet? Nur wenn die Öffnungszeiten lesbar sind, sonst null.
// Ergebnis: { offen: true, bis: "18:00" } | { offen: false, ab: "14:30" | "" } | { termin: true } | null
export function jetztOffen(c, jetzt = new Date()) {
  const oh = c.ohp; if (!oh || !oh.known) return null;
  const tag = (jetzt.getDay() + 6) % 7, min = jetzt.getHours() * 60 + jetzt.getMinutes(), v = oh.days[tag];
  if (v === "appt") return { termin: true };
  if (!Array.isArray(v)) return v === "closed" ? { offen: false, ab: "" } : null;
  const jetztIv = v.find(([a, b]) => min >= a && min < b);
  if (jetztIv) return { offen: true, bis: hhmm(jetztIv[1]) };
  const spaeter = v.find(([a]) => a > min);
  return { offen: false, ab: spaeter ? hhmm(spaeter[0]) : "" };
}
// Entfernung lesbar: unter 10 km mit einer Nachkommastelle
export const kmText = km => (km < 10 ? km.toFixed(1).replace(".", ",") : String(Math.round(km))) + " km";
