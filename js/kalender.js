// Termine aus dem Google Kalender in den Tourenplaner übernehmen (Wunsch 2026-10-27).
// Alles passiert auf dem Gerät: die Termine kommen aus dem eigenen Google Kalender, nichts geht an fremde Dienste.
// Übernommene Termine sind „extern“: der Tourenplaner ändert oder löscht sie im Google Kalender nie.
//  - Titel enthält eindeutig einen Kundennamen → fester Kundentermin
//  - sonst mit Ort (PLZ im Feld „Ort“) → persönlicher Termin mit Fahrt dorthin
//  - sonst ohne Ort → persönlicher Termin, die Zeit wird beim vorigen Besuch freigehalten
//  - ganztägig (oder über mehrere Tage) → an dem Tag keine Besuche
// Nur Montag bis Donnerstag (Freitag ist Home-Office).
import { PLZ } from "./plz.js";
import { nameWoerter, textWoerter } from "./neukunden.js";

export const FENSTER_TAGE = 56; // so weit voraus wird gelesen (8 Wochen)
const MARKE = "Eingetragen vom Tourenplaner"; // steht in jedem Eintrag, den der Tourenplaner selbst anlegt
export const PRIVAT_PREFIX = "P:G-";

const zwei = n => String(n).padStart(2, "0");
const isoTag = d => d.getFullYear() + "-" + zwei(d.getMonth() + 1) + "-" + zwei(d.getDate());
const uhr = d => zwei(d.getHours()) + ":" + zwei(d.getMinutes());
const wochentag = iso => { const [y, m, t] = iso.split("-").map(Number); return (new Date(y, m - 1, t).getDay() + 6) % 7; };
const naechsterTag = iso => { const [y, m, t] = iso.split("-").map(Number); return isoTag(new Date(y, m - 1, t + 1)); };
const tourTag = iso => wochentag(iso) <= 3;

// Adresse aus dem Feld „Ort“: „Firma, Hauptstr. 5, 26121 Oldenburg, Deutschland“ → { str, plz, ort } (nur bekannte PLZ)
export function adresseLesen(text) {
  const s = String(text || "");
  for (const m of s.matchAll(/(^|[^\d])(\d{5})\s+([^,\n]+)/g)) {
    if (!PLZ[m[2]]) continue;
    const vor = s.slice(0, m.index + m[1].length).split(/[,\n]/).map(x => x.trim()).filter(Boolean);
    return { str: vor.length ? vor[vor.length - 1] : "", plz: m[2], ort: m[3].trim() };
  }
  return null;
}

// Kunde am Titel erkennen: alle Namenswörter des Kunden (ohne Rechtsform) müssen im Titel stehen.
// Einwort-Namen brauchen mindestens 4 Buchstaben. Nur ein eindeutiger Treffer zählt (bei Gleichstand hilft die PLZ im Ort).
export function kundeErkennen(titel, kunden, plz = "") {
  const t = new Set(textWoerter(titel)); if (!t.size) return null;
  let best = [], bestWert = 0;
  for (const k of kunden) {
    if (k.out || !k.n1) continue;
    const w = [...new Set(nameWoerter(k.n1))];
    if (!w.length || (w.length === 1 && w[0].length < 4) || !w.every(x => t.has(x))) continue;
    const wert = w.reduce((a, x) => a + x.length, 0);
    if (wert > bestWert) { best = [k]; bestWert = wert; } else if (wert === bestWert) best.push(k);
  }
  if (best.length > 1 && plz) best = best.filter(k => k.plz === plz);
  return best.length === 1 ? best[0] : null;
}

// Google-Termine auswerten. eigene: Kalender-IDs, die der Tourenplaner selbst eingetragen hat.
// Ergebnis: Liste von { art: "kunde" | "privat" | "ganztag", gid, date, … , gs } (gs = Stand in Google, zum Erkennen von Änderungen)
export function auswerten(events, kunden, eigene = new Set()) {
  const L = [];
  for (const e of events || []) {
    if (!e || e.status === "cancelled" || !e.start) continue;
    if (eigene.has(e.id) || String(e.description || "").includes(MARKE)) continue;
    if ((e.attendees || []).some(a => a.self && a.responseStatus === "declined")) continue;
    const betreff = String(e.summary || "").trim() || "Termin";
    const gs = JSON.stringify([e.start, e.end, betreff, e.location || ""]);
    // ganztägig oder über mehrere Tage: jeder Tourtag dazwischen ist belegt
    let tage = null;
    if (e.start.date) { tage = []; for (let d = e.start.date; d < (e.end && e.end.date || naechsterTag(e.start.date)); d = naechsterTag(d)) tage.push(d); }
    else {
      const s = new Date(e.start.dateTime), en = new Date(e.end && e.end.dateTime || e.start.dateTime);
      if (isNaN(s)) continue;
      const d0 = isoTag(s), d1 = isoTag(new Date(Math.max(+s, +en - 1)));
      if (d0 !== d1) { tage = []; for (let d = d0; d <= d1; d = naechsterTag(d)) tage.push(d); }
      else {
        if (!tourTag(d0)) continue;
        const adr = adresseLesen(e.location), k = kundeErkennen(betreff, kunden, adr && adr.plz);
        const ende = +en > +s ? uhr(en) : uhr(new Date(+s + 30 * 60e3));
        L.push({ art: k ? "kunde" : "privat", gid: e.id, kd: k ? k.id : null, date: d0, time: uhr(s), ende, betreff, str: adr ? adr.str : "", plz: adr ? adr.plz : "", ort: adr ? adr.ort : "", gs });
        continue;
      }
    }
    for (const d of tage) if (tourTag(d)) L.push({ art: "ganztag", gid: e.id, date: d, betreff });
  }
  return L;
}

// Ausgewertete Termine in die Terminliste T übernehmen (nur Termine im Zeitraum von–bis werden ergänzt, geändert oder entfernt).
// kal: { aus: [gid, …] (im Tourenplaner gelöscht – nicht wieder holen), ganztag: [{ gid, date, betreff }] }
// Rückgabe: Änderungen { neu, geaendert, weg: [{ id, date, alt? }], ganztagNeu, ganztagWeg: [date] }
export function uebernehmen(T, kal, liste, von, bis) {
  const aus = new Set(kal.aus || []), res = { neu: [], geaendert: [], weg: [], ganztagNeu: [], ganztagWeg: [] };
  const imFenster = d => d >= von && d <= bis;
  const extern = new Map(); // gid -> Kennung in T
  for (const [id, f] of Object.entries(T)) if (f.extern && f.ev) extern.set(f.ev, id);
  const gesehen = new Set();
  for (const x of liste) {
    if (x.art === "ganztag" || aus.has(x.gid) || !imFenster(x.date)) continue;
    gesehen.add(x.gid);
    const altId = extern.get(x.gid), alt = altId && T[altId];
    if (alt && alt.gs === x.gs) continue; // in Google unverändert (auch wenn im Tourenplaner verschoben)
    let art = x.art;
    // Kunde hat schon einen anderen Termin (aus dem Tourenplaner oder einem anderen Google-Termin):
    // derselbe Termin doppelt eingetragen → nichts tun; sonst die Zeit als persönlicher Termin freihalten
    if (art === "kunde" && T[x.kd] && T[x.kd].ev !== x.gid) {
      if (T[x.kd].date === x.date && T[x.kd].time === x.time) continue;
      art = "privat";
    }
    const neuId = art === "kunde" ? x.kd : PRIVAT_PREFIX + x.gid;
    if (altId && altId !== neuId) { delete T[altId]; res.weg.push({ id: altId, date: alt.date }); }
    const f = { date: x.date, time: x.time, ev: x.gid, cal: "ok", extern: true, gs: x.gs };
    if (art === "privat") Object.assign(f, { ende: x.ende, betreff: x.betreff, str: x.str, plz: x.plz, ort: x.ort });
    const war = altId === neuId ? alt : null;
    T[neuId] = f;
    if (war) res.geaendert.push({ id: neuId, date: f.date, alt: war.date }); else res.neu.push({ id: neuId, date: f.date });
  }
  // in Google gelöscht oder abgesagt (nur im gelesenen Zeitraum)
  for (const [gid, id] of extern) {
    const f = T[id]; if (!f || gesehen.has(gid) || !imFenster(f.date)) continue;
    delete T[id]; res.weg.push({ id, date: f.date });
  }
  // ganztägige Termine: Liste im Zeitraum ersetzen
  const vorher = (kal.ganztag || []).filter(g => imFenster(g.date));
  const jetzt = liste.filter(x => x.art === "ganztag" && !aus.has(x.gid) && imFenster(x.date)).map(x => ({ gid: x.gid, date: x.date, betreff: x.betreff }));
  const tageV = new Set(vorher.map(g => g.date)), tageJ = new Set(jetzt.map(g => g.date));
  res.ganztagNeu = [...tageJ].filter(d => !tageV.has(d)); res.ganztagWeg = [...tageV].filter(d => !tageJ.has(d));
  kal.ganztag = (kal.ganztag || []).filter(g => !imFenster(g.date)).concat(jetzt);
  return res;
}
export const ganztagAm = (kal, datum) => (kal && kal.ganztag || []).filter(g => g.date === datum);
