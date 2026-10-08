// Grunddaten, Standard-Einstellungen und kleine Hilfsfunktionen (ohne Oberfläche, auch in Tests nutzbar).
import { PLZ } from "./plz.js";

// Startpunkt (zu Hause): kommt aus den Einstellungen (Excel), steht bewusst nicht im öffentlichen Programm.
export const HOME = { lat: null, lng: null, name: "Zuhause" };
export const WD = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
export const WDS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

export const DEFAULTS = {
  overnightKm: 130, hotelMax: 115, maxVisits: 8, visitMin: 30,
  depart: "07:30", latest: "17:00", latestOv: "18:00", lastVisitDay1: "18:00", hotelStart: "08:00",
  grundlage: "umsatz", umsatzJahr: 2025, umsatzStand: "", trendBevorzugen: false, abstandWochen: 10, lvNutzen: true, ersterMaxKm: 0, calSync: true,
  roadFactor: 1.25, speed: 70, parking: true, zuschlag: 10, orsKey: "", start: "", startKoord: "",
};

// Bezeichnungen der Einstellungen (für das Excel-Blatt "Einstellungen")
export const EINST_NAMEN = {
  overnightKm: "Übernachtung ab Fahrstrecke (km)", hotelMax: "Hotelbudget inkl. Frühstück (€)",
  maxVisits: "Höchstens Besuche pro Tag", visitMin: "Standard-Besuchsdauer (Min.)", depart: "Abfahrt",
  latest: "Späteste Rückkehr Tagestour", latestOv: "Späteste Rückkehr Übernachtungstour (Tag 2)",
  lastVisitDay1: "Letzter Besuchsbeginn vor Hotelnacht", hotelStart: "Abfahrt vom Hotel",
  grundlage: "Planungsgrundlage (umsatz/laengst)", umsatzJahr: "Umsatz-Jahr für die Planung",
  umsatzStand: "Umsätze des neuesten Jahres gelten bis (Stand der Liste)", trendBevorzugen: "Kunden mit rückläufigem Umsatz bevorzugt einplanen",
  abstandWochen: "Mindestabstand zwischen zwei Besuchen (Wochen)", lvNutzen: "Letzten Besuch bei der Planung berücksichtigen", ersterMaxKm: "Erster Besuch höchstens km von zu Hause (0 = aus)", calSync: "Fixtermine in Google Kalender",
  roadFactor: "Umwegfaktor", speed: "Durchschnittstempo (km/h)", parking: "Hotel mit Parkplatz",
  zuschlag: "Zuschlag auf echte Fahrzeiten (%)", orsKey: "OpenRouteService-Schlüssel",
  start: "Startadresse (zu Hause)", startKoord: "Startpunkt (Breite,Länge)",
};

export const tmin = s => { const [h, m] = String(s).split(":"); return (+h) * 60 + (+m || 0); };
export const hhmm = m => { m = Math.round(m); return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); };
export const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
export const parseISO = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const fmtD = s => { if (!s) return "–"; const d = parseISO(s); return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }); };
export const eur = v => Math.round(v || 0).toLocaleString("de-DE") + " €";
export const today = () => iso(new Date());
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Luftlinie in km (ohne Umwegfaktor)
export function luftlinie(a, b) {
  const R = 6371, r = Math.PI / 180, dl = (b.lat - a.lat) * r, dn = (b.lng - a.lng) * r;
  const h = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dn / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* ---------- Hotel ---------- */
// Auf Inseln wird nicht übernachtet (Autozug/Fähre): Hotel im Festlandort, von dem aus man auf die Insel kommt.
const INSEL_FESTLAND = [
  [/^259(80|92|96|97|99)$/, "Niebüll", "25899"],        // Sylt
  [/^259(38|46)$/, "Dagebüll", "25899"],                // Föhr, Amrum
  [/^258(49|59|63)$/, "Husum", "25813"],                // Pellworm, Halligen
  [/^26757$/, "Emden", "26721"],                         // Borkum
  [/^26(571|548|579)$/, "Norden", "26506"],              // Juist, Norderney, Baltrum
  [/^26(465|474)$/, "Esens", "26427"],                   // Langeoog, Spiekeroog
  [/^26486$/, "Wittmund", "26409"],                      // Wangerooge
  [/^2749[89]$/, "Cuxhaven", "27472"],                   // Helgoland, Neuwerk
];
export const istInsel = plz => INSEL_FESTLAND.some(([re]) => re.test(String(plz)));
// Hotelort zum letzten Besuch von Tag 1 (Insel -> Festlandort). Ergebnis { ort, plz, lat, lng[, insel] }
export function hotelOrt(c) {
  const m = INSEL_FESTLAND.find(([re]) => re.test(String(c.plz)));
  if (!m) return { ort: c.ort, plz: c.plz, lat: c.lat, lng: c.lng };
  const p = PLZ[m[2]] || [c.lat, c.lng];
  return { ort: m[1], plz: m[2], lat: p[0], lng: p[1], insel: c.ort };
}

/* ---------- Öffnungszeiten ---------- */
const DAYK = ["mo", "di", "mi", "do", "fr", "sa", "so"];
const TAGNAMEN = [[/\bmontags?\b/g, "mo"], [/\bdienstags?\b/g, "di"], [/\bmittwochs?\b/g, "mi"], [/\bdonnerstags?\b/g, "do"], [/\bfreitags?\b/g, "fr"],
  [/\b(samstags?|sonnabends?)\b/g, "sa"], [/\bsonntags?\b/g, "so"]];
// Zeitspanne: "8:00-12:30", "8.00 - 12.30", "9-12", "14:30-18" (nach dem Entfernen von "von", "bis", "Uhr")
const ZEIT = /(?<!\d)(\d{1,2})(?:[:.](\d{2}))?\s*-\s*(\d{1,2})(?:[:.](\d{2}))?(?!\d)/g;
function zeiten(seg) {
  const out = [];
  for (const x of seg.matchAll(ZEIT)) {
    const a = +x[1] * 60 + +(x[2] || 0), b = +x[3] * 60 + +(x[4] || 0);
    if (+x[1] <= 24 && +x[3] <= 24 && +(x[2] || 0) < 60 && +(x[4] || 0) < 60 && b > a) out.push([a, b]);
  }
  return out;
}
export function parseOH(txt) {
  const res = { known: false, days: [null, null, null, null, null, null, null] };
  if (!txt) return res;
  let t = txt.toLowerCase().replace(/\(.*?\)/g, " ");
  for (const [re, k] of TAGNAMEN) t = t.replace(re, k);
  t = t.replace(/(mo|di|mi|do|fr|sa|so)\./g, "$1").replace(/–|—/g, "-").replace(/\bbis\b/g, "-").replace(/\b(uhr|von)\b/g, " ");
  let lastDays = null;
  for (const seg of t.split(/[;,]/)) {
    const dm = seg.match(/\b(mo|di|mi|do|fr|sa|so)\b(\s*(-|\/|u\.|und|\+|&)\s*\b(mo|di|mi|do|fr|sa|so)\b)*/);
    let ds = null;
    if (dm) {
      ds = new Set(); const parts = dm[0].replace(/\s+/g, ""); const re = /(mo|di|mi|do|fr|sa|so)(?:-(mo|di|mi|do|fr|sa|so))?/g; let mm;
      while ((mm = re.exec(parts))) { const a = DAYK.indexOf(mm[1]), b = mm[2] ? DAYK.indexOf(mm[2]) : a; for (let i = a; i <= b; i++) ds.add(i); }
      lastDays = ds;
    } else if (lastDays && zeiten(seg).length) ds = lastDays;
    else if (!lastDays && /vereinbarung|termin/.test(seg)) ds = new Set([0, 1, 2, 3, 4]); // "Nur nach Vereinbarung" ohne Tage: Mo–Fr
    else continue;
    const times = zeiten(seg);
    let val = null;
    if (times.length) val = times; else if (/geschlossen|ruhetag/.test(seg)) val = "closed"; else if (/vereinbarung|termin/.test(seg)) val = "appt";
    if (val === null) continue;
    for (const d of ds) { res.days[d] = (Array.isArray(val) && Array.isArray(res.days[d])) ? mergeIv(res.days[d].concat(val)) : val; }
    res.known = true;
  }
  return res;
}
function mergeIv(a) {
  a = a.slice().sort((x, y) => x[0] - y[0]); const o = [];
  for (const i of a) { if (o.length && i[0] <= o[o.length - 1][1]) o[o.length - 1][1] = Math.max(o[o.length - 1][1], i[1]); else o.push(i.slice()); }
  return o;
}
