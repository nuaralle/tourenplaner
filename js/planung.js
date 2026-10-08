// Planungslogik (aus dem Prototyp übernommen, ohne Oberfläche – dadurch auch automatisch testbar).
import { HOME, DEFAULTS, tmin, hhmm, iso, parseISO, addDays, today, luftlinie, parseOH, hotelOrt } from "./grundlagen.js";
import { PLZ } from "./plz.js";

export let S = { ...DEFAULTS };
export let CUST = [];  // aufbereitete Kunden (mit Lage, Fälligkeit usw.)
let FIX = {};          // id -> {day,time} für die geplante Woche
let SPAETER = new Set(); // Kunden mit festem Termin später (Fr–So dieser Woche oder spätere Woche) – bis dahin nicht zusätzlich einplanen
let BELEGT = new Set();  // Kunden, die schon in einer anderen geplanten Woche stehen – nicht doppelt einplanen
export function setzeBelegt(ids) { BELEGT = new Set(ids || []); }
const gesperrt = id => SPAETER.has(id) || BELEGT.has(id);
let byIdMap = new Map();

export function setzeEinstellungen(e) { S = { ...DEFAULTS, ...(e || {}) }; setzeStart(S); }
// Startpunkt aus den Einstellungen: genaue Koordinaten, sonst Mitte der PLZ aus der Startadresse
export function setzeStart(s) {
  const k = String(s.startKoord || "").split(",").map(Number);
  if (k.length === 2 && k.every(Number.isFinite) && k[0]) { HOME.lat = k[0]; HOME.lng = k[1]; return; }
  const plz = (String(s.start || "").match(/\b\d{5}\b/) || [])[0];
  if (plz && PLZ[plz]) { HOME.lat = PLZ[plz][0]; HOME.lng = PLZ[plz][1]; } else { HOME.lat = HOME.lng = null; }
}
export const startBekannt = () => HOME.lat != null;

/* ---------- Entfernungen ---------- */
// Grobe Entfernung (Luftlinie × Umwegfaktor) – für "liegt in der Nähe"-Entscheidungen.
export const km = (a, b) => luftlinie(a, b) * S.roadFactor;
// Fahrt von a nach b: { km, min }. Später liefert hier OpenRouteService echte Werte;
// fehlt ein Wert, wird geschätzt.
let fahrtQuelle = null;
export function setzeFahrtQuelle(fn) { fahrtQuelle = fn; }
export function fahrt(a, b) {
  const echt = fahrtQuelle && fahrtQuelle(a, b);
  if (echt) return echt;
  const k = km(a, b); return { km: k, min: k / S.speed * 60, geschaetzt: true };
}

export const dauer = c => +c.vm || S.visitMin;

/* ---------- Kunden aufbereiten ---------- */
/* ---------- Umsatzentwicklung ---------- */
// Vergleich neuestes Jahr mit Vorjahr. Ist das neueste Jahr noch nicht vorbei, wird es aufs ganze Jahr hochgerechnet
// (Stand = Datum der Umsatzliste, Einstellung "umsatzStand"; ohne Angabe gilt heute). Vor Mitte Februar ist das zu ungenau.
let TREND = null;
export const trendInfo = () => TREND;
function trendGrundlage(kunden) {
  const jahre = [...new Set(kunden.flatMap(k => Object.entries(k.ums || {}).filter(([, v]) => v > 0).map(([j]) => +j)))];
  if (!jahre.length) return null;
  const jahr = Math.max(...jahre), vorjahr = jahr - 1;
  if (!jahre.includes(vorjahr)) return null;
  const stand = S.umsatzStand || (jahr === new Date().getFullYear() ? today() : "");
  let anteil = 1;
  if (stand && +stand.slice(0, 4) === jahr) { const j0 = new Date(jahr, 0, 1), j1 = new Date(jahr + 1, 0, 1); anteil = Math.min(1, Math.max(0, (parseISO(stand) - j0 + 864e5) / (j1 - j0))); }
  return { jahr, vorjahr, anteil, stand: anteil < 1 ? stand : "", zuFrueh: anteil < 0.12 };
}
// c.trend: Veränderung zum Vorjahr (-0.35 = -35 %), Infinity = neuer Umsatz, null = nicht bewertbar
function umsatzTrend(c) {
  c.trend = null; const T = TREND; if (!T || T.zuFrueh) return;
  const alt = (c.ums || {})[T.vorjahr] || 0, neu = (c.ums || {})[T.jahr] || 0, hoch = neu / T.anteil;
  c.trendAlt = alt; c.trendNeu = neu; c.trendHoch = hoch;
  c.trend = alt > 0 ? (hoch - alt) / alt : neu > 0 ? Infinity : null;
}
export function rebuild(kunden) {
  const list = []; TREND = trendGrundlage(kunden);
  for (const k of kunden) {
    if (k.inactive) continue;
    const c = Object.assign({}, k, { notes: k.notes || [], planHold: !!k.hold });
    if (c.lat == null && c.plz && PLZ[c.plz]) { c.lat = PLZ[c.plz][0]; c.lng = PLZ[c.plz][1]; }
    c.ohp = parseOH(c.oh);
    c.dHome = c.lat != null && startBekannt() ? fahrt(HOME, c).km : null; // echte Fahrstrecke, sobald bekannt
    c.since = c.lv ? Math.round((parseISO(today()) - parseISO(c.lv)) / 864e5) : null; // Tage seit dem letzten Besuch
    c.uPlan = (c.ums && c.ums[S.umsatzJahr]) || 0; // Umsatz des gewählten Jahres
    // Wichtigkeit für die Planung: umsatzstärkste zuerst – oder am längsten nicht besuchte zuerst
    // (noch nie besucht ganz vorn; bei gleichem Abstand entscheidet der Umsatz)
    c.urg = LAENGST() ? (c.since == null || !LV_NUTZEN() ? 1e5 : c.since) + c.uPlan / 1e9 : c.uPlan;
    umsatzTrend(c);
    // wahlweise: Kunden mit deutlich rückläufigem Umsatz (ab -20 %) bevorzugt einplanen (bis zu 50 % mehr Gewicht)
    if (!LAENGST() && S.trendBevorzugen && c.trend != null && isFinite(c.trend) && c.trend <= -0.2) c.urg = c.uPlan * (1 + Math.min(0.5, -c.trend));
    c.out = c.dHome == null || c.dHome > 330;
    list.push(c);
  }
  CUST = list; byIdMap = new Map(list.map(c => [c.id, c]));
  setzeStichtag(today());
}
// Planungsgrundlage: "umsatz" = umsatzstärkste zuerst, "laengst" = am längsten nicht besuchte Kunden zuerst (auch ohne Umsatz)
export const LAENGST = () => S.grundlage === "laengst";
// Häkchen in den Einstellungen: ohne Häkchen plant die App so, als wäre kein Kunde besucht worden
// (kein Mindestabstand, "am längsten nicht besucht" sortiert dann nur nach Umsatz); das Datum selbst bleibt erhalten
export const LV_NUTZEN = () => S.lvNutzen !== false;
// Planungsgrundlage „nur Kunden mit Häkchen“ (z. B. "merkmal:Deko Kunde"): Name der Häkchen-Spalte oder null
export const MERKMAL = () => String(S.grundlage || "").startsWith("merkmal:") ? S.grundlage.slice(8) : null;
const istJa = v => v === true || /^(ja|x|1|wahr|true)$/i.test(String(v ?? "").trim());
export const hatMerkmal = (c, name = MERKMAL()) => !!name && istJa((c.extra || {})[name]);
// Mindestabstand: gapOk = letzter Besuch liegt am Stichtag (Montag der geplanten Woche) mindestens "abstandWochen" zurück
export function setzeStichtag(datumISO) {
  const grenze = iso(addDays(parseISO(datumISO), -7 * (+S.abstandWochen || 0)));
  for (const c of CUST) c.gapOk = !LV_NUTZEN() || !c.lv || c.lv <= grenze;
}
export const byId = id => byIdMap.get(id);
// Kommt für die Planung in Frage: Mindestabstand eingehalten und – je nach Grundlage – Umsatz im gewählten Jahr bzw. Häkchen gesetzt
export const el = c => c.gapOk && (MERKMAL() ? hatMerkmal(c) : LAENGST() || c.uPlan > 0);

/* ---------- Tagessimulation ---------- */
function hoursFor(c, day) { const v = c.ohp.days[day]; if (v === null) { return day >= 5 ? "closed" : [[8 * 60, 18 * 60]]; } return v; }
export function openOn(c, day) { return hoursFor(c, day) !== "closed"; }
export function simulate(start, startMin, ids, day, end) {
  let t = startMin, pos = start, kmSum = 0; const legs = []; let ok = true, lateFix = false, spaet = false;
  for (const id of ids) {
    const c = byId(id); if (!c) { continue; }
    const f = fahrt(pos, c); kmSum += f.km; t += f.min;
    const dur = dauer(c); const hs = hoursFor(c, day); let begin = null, warn = "";
    const fx = FIX[id] && FIX[id].day === day ? tmin(FIX[id].time) : null;
    if (fx != null && !legs.length && t > fx) { const sh = Math.min(t - fx, Math.max(0, startMin - tmin("05:30"))); startMin -= sh; t -= sh; }
    if (fx != null) {
      begin = Math.max(t, fx);
      if (t > fx + 10) { lateFix = true; warn = "Fixtermin " + FIX[id].time + " wird nicht erreicht (Ankunft ca. " + hhmm(t) + ")"; }
      else if (t > fx) { spaet = true; warn = "Knapp: Ankunft ca. " + hhmm(t); }
      else if (fx - t > 45) warn = "Puffer " + Math.round(fx - t) + " Min. bis zum Fixtermin";
    }
    else if (hs === "closed") { ok = false; warn = "An diesem Tag geschlossen"; begin = t; }
    else if (hs === "appt") { begin = t; warn = "Nur nach Vereinbarung – vorher anrufen"; }
    else {
      for (const [a, b] of hs) { const s = Math.max(t, a); if (b - s >= Math.min(dur, 45)) { begin = s; break; } }
      if (begin === null) { ok = false; begin = t; warn = "Kommt außerhalb der Öffnungszeiten an"; }
      else if (begin - t > 45) warn = "Wartezeit " + Math.round(begin - t) + " Min. bis Öffnung";
    }
    if (!legs.length && begin > t && ok) { const sh = begin - t; startMin += sh; warn = /^(Wartezeit|Puffer)/.test(warn) ? "" : warn; }
    legs.push({ id, km: f.km, min: f.min, geschaetzt: !!f.geschaetzt, arr: t, begin, leave: begin + dur, dur, warn, fixed: fx != null, verz: fx != null ? Math.max(0, t - fx) : 0 }); t = begin + dur; pos = c;
  }
  let back = 0, backMin = 0; if (end) { const f = fahrt(pos, end); back = f.km; backMin = f.min; kmSum += back; t += backMin; }
  const wait = legs.reduce((a, l) => a + Math.max(0, l.begin - l.arr), 0) - (legs[0] ? Math.max(0, legs[0].begin - legs[0].arr) : 0);
  return { legs, end: t, km: kmSum, ok, lateFix, spaet, lastPos: pos, backKm: back, backMin, depart: startMin, wait };
}
function order(start, ids, end, ctx) {
  if (ids.length < 2) return ids.slice();
  const rest = ids.map(byId); const seq = []; let p = start;
  while (rest.length) { let bi = 0, bd = 1e9; rest.forEach((c, i) => { const d = km(p, c); if (d < bd) { bd = d; bi = i; } }); p = rest[bi]; seq.push(rest.splice(bi, 1)[0]); }
  const len = s => { let L = 0, q = start; for (const c of s) { L += km(q, c); q = c; } if (end) L += km(q, end); return L; };
  let best = seq, bl = len(seq), imp = true;
  while (imp) { imp = false; for (let i = 0; i < best.length - 1; i++) for (let j = i + 1; j < best.length; j++) { const n = best.slice(0, i).concat(best.slice(i, j + 1).reverse(), best.slice(j + 1)); const l = len(n); if (l < bl - 0.01) { best = n; bl = l; imp = true; } } }
  const a = best.map(c => c.id); if (ctx == null) return a;
  const b = a.slice().reverse(); const sa = simulate(start, ctx.sMin, a, ctx.day, end), sb = simulate(start, ctx.sMin, b, ctx.day, end);
  const sc = s => (s.ok ? 0 : 1e6) + s.end + s.wait * 0.5; return sc(sb) < sc(sa) ? b : a;
}

/* ---------- Wochenplanung ---------- */
export function weekStart(now = new Date()) { const d = new Date(now); const wd = (d.getDay() + 6) % 7; let m = addDays(d, -wd); if (wd >= 3) m = addDays(m, 7); m.setHours(0, 0, 0, 0); return m; }
// Übernachtung: wird jede Woche selbst gewählt (kein Standard): "0-1" (Mo→Di), "1-2" (Di→Mi), "2-3" (Mi→Do)
export const UEBERNACHTUNG = [["0-1", "Mo → Di"], ["1-2", "Di → Mi"], ["2-3", "Mi → Do"]];
export const ovGueltig = u => UEBERNACHTUNG.some(x => x[0] === u);
// belegt: Kunden aus anderen geplanten Wochen (werden in dieser Woche nicht noch einmal eingeplant)
export function planWeek(mondayISO, excluded, fixed, uebernachtung, belegt) {
  if (!ovGueltig(uebernachtung)) throw new Error("Bitte zuerst bei „Übernachtung“ die Nacht wählen.");
  setzeBelegt(belegt);
  const plan = planWeekTage(mondayISO, excluded, fixed, uebernachtung);
  plan.uebernachtung = uebernachtung;
  for (const D of plan.days) feinschliff(D); // zum Schluss: schnellste Reihenfolge je Tag
  return plan;
}
// Mehrere Wochen nacheinander planen: wer in einer Woche eingeplant ist, kommt in den folgenden nicht noch einmal dran.
export function planeWochen(startMonISO, anzahl, fixed, belegt = [], uebernachtung) {
  const gesamt = new Set(belegt), plaene = [];
  for (let i = 0; i < anzahl; i++) {
    const plan = planWeek(iso(addDays(parseISO(startMonISO), 7 * i)), [], fixed, uebernachtung, gesamt);
    plan.days.forEach(D => D.stops.forEach(id => gesamt.add(id))); plaene.push(plan);
  }
  return plaene;
}
function planWeekTage(mondayISO, excluded, fixed, uebernachtung) {
  fixed = fixed || {}; setFix(fixed, mondayISO); setzeStichtag(mondayISO);
  const ex = new Set(excluded || []); const used = new Set();
  const mon = parseISO(mondayISO);
  const [o1, o2] = uebernachtung.split("-").map(Number);
  const days = [0, 1, 2, 3].map(i => ({ date: iso(addDays(mon, i)), day: i, type: "tour", stops: [], hotel: null }));
  days.push({ date: iso(addDays(mon, 4)), day: 4, type: "home", stops: [] });
  const pool = () => CUST.filter(c => !c.out && c.lat != null && !used.has(c.id) && !ex.has(c.id) && !c.planHold && !gesperrt(c.id));
  const due = el;
  for (const id in FIX) { if (!byId(id)) continue; const D = days[FIX[id].day]; if (D && D.type !== "home") { D.stops.push(id); used.add(id); } }
  for (const D of days) D.stops.sort((a, b) => tmin(FIX[a].time) - tmin(FIX[b].time));
  const nearSeeds = (seeds, maxKm) => c => seeds.some(x => km(x, c) <= maxKm);
  const distTo = (seeds, c) => Math.min(...seeds.map(x => km(x, c)));

  /* Übernachtungstour */
  const ovFix = days[o1].stops.concat(days[o2].stops).map(byId);
  if (ovFix.length && ovFix.some(c => c.dHome > S.overnightKm * 0.7)) {
    days[o1].type = "ov1"; days[o2].type = "ov2";
    const cands = pool().filter(c => nearSeeds(ovFix, 75)(c) && c.dHome > S.overnightKm * 0.6 && el(c)).sort((a, b) => b.urg / (1 + distTo(ovFix, b) / 30) - a.urg / (1 + distTo(ovFix, a) / 30));
    for (const c of cands) { if (days[o1].stops.length >= S.maxVisits) break; if (!openOn(c, o1)) continue; const r = insertBest(days[o1], c.id); if (r) { days[o1].stops = r; used.add(c.id); } }
    const hp = days[o1].stops.length ? byId(days[o1].stops[days[o1].stops.length - 1]) : byId(days[o2].stops[0]);
    days[o1].hotel = days[o2].hotel = hotelOrt(hp);
    for (const c of cands) { if (used.has(c.id)) continue; if (days[o2].stops.length >= S.maxVisits) break; if (!openOn(c, o2)) continue; const r = insertBest(days[o2], c.id); if (r) { days[o2].stops = r; used.add(c.id); } }
  }
  const far = pool().filter(c => c.dHome > S.overnightKm && openOn(c, o1) && el(c));
  let seed = null, bestSum = -1;
  for (const c of far.filter(el)) { const s = far.filter(x => km(c, x) <= 50).reduce((a, x) => a + x.urg, 0); if (s > bestSum) { bestSum = s; seed = c; } }
  if (seed && !days[o1].stops.length && !days[o2].stops.length) {
    const region = pool().filter(c => km(seed, c) <= 75 && c.dHome > S.overnightKm * 0.7 && (openOn(c, o1) || openOn(c, o2)) && el(c))
      .sort((a, b) => b.urg / (1 + km(seed, b) / 30) - a.urg / (1 + km(seed, a) / 30));
    const chosen = [];
    const split = (ids) => {
      const seq = order(HOME, ids, HOME);
      const d1 = []; let i = 0;
      for (; i < seq.length && d1.length < S.maxVisits; i++) { const t = simulate(HOME, tmin(S.depart), d1.concat(seq[i]), o1, null); if (t.ok && t.legs[t.legs.length - 1].begin <= tmin(S.lastVisitDay1)) d1.push(seq[i]); else break; }
      const d2 = seq.slice(i); if (d2.length > S.maxVisits || !d1.length) return null;
      const hotelPos = d1.length ? hotelOrt(byId(d1[d1.length - 1])) : HOME;
      const s2 = simulate(hotelPos, tmin(S.hotelStart), d2, o2, HOME); if (!s2.ok || s2.end > tmin(S.latestOv)) return null;
      return { d1, d2 };
    };
    let res = null;
    for (const c of region) { if (chosen.length >= S.maxVisits * 2) break; const r = split(chosen.concat(c.id)); if (r) { chosen.push(c.id); res = r; } }
    if (res) {
      res.d1.concat(res.d2).forEach(id => used.add(id));
      const h = byId(res.d1[res.d1.length - 1]);
      days[o1].type = "ov1"; days[o1].stops = res.d1; days[o1].hotel = hotelOrt(h);
      days[o2].type = "ov2"; days[o2].stops = res.d2; days[o2].hotel = days[o1].hotel;
    }
  }
  /* Tagestouren */
  for (const D of days) {
    if (D.type !== "tour") continue;
    const cands = pool().filter(c => c.dHome <= S.overnightKm && openOn(c, D.day));
    if (D.stops.length) {
      const sd = D.stops.map(byId);
      const near = cands.filter(c => nearSeeds(sd, 45)(c) && el(c)).sort((a, b) => b.urg / (1 + distTo(sd, b) / 20) - a.urg / (1 + distTo(sd, a) / 20));
      for (const c of near) { if (D.stops.length >= S.maxVisits) break; const r = insertBest(D, c.id); if (r) { D.stops = r; used.add(c.id); } }
      continue;
    }
    const seeds = cands.filter(due).sort((a, b) => b.urg - a.urg); if (!seeds.length) continue;
    const sd = seeds[0]; let ids = [sd.id];
    const near = cands.filter(c => c.id !== sd.id && km(sd, c) <= 45 && el(c)).sort((a, b) => b.urg / (1 + km(sd, b) / 20) - a.urg / (1 + km(sd, a) / 20));
    for (const c of near) { if (ids.length >= S.maxVisits) break; const t = order(HOME, ids.concat(c.id), HOME, { sMin: tmin(S.depart), day: D.day }); const s = simulate(HOME, tmin(S.depart), t, D.day, HOME); if (s.ok && s.end <= tmin(S.latest)) ids = t; }
    D.stops = ids; D.stops.forEach(id => used.add(id));
  }
  /* Auffüllen: Kunden in der Nähe oder mit kleinem Umweg auf der Strecke (auch auf dem Heimweg) */
  const frei = c => !c.out && c.lat != null && !used.has(c.id) && !ex.has(c.id) && !c.planHold && !gesperrt(c.id);
  for (const D of days) { if (D.type !== "home" && (D.stops.length || D.type === "ov2")) auffuellen(D, frei, id => used.add(id)); } // Tag 2: Heimweg vom Hotel
  return { week: mondayISO, days, excluded: [...ex], fixed, created: new Date().toISOString() };
}
/* ---------- Feinschliff: schnellste Reihenfolge eines Tages ---------- */
// Prüft alle Reihenfolgen der Besuche mit den echten Fahrzeiten (Verzweigen und Abschneiden: Reihenfolgen, die schon
// unterwegs nicht mehr besser werden können, werden verworfen). Bewertung: Dauer des Arbeitstags (Abfahrt bis Rückkehr bzw. bis Ende letzter Besuch an Tag 1)
// + ein Viertel der Fahrzeit (bei gleicher Dauer gewinnt weniger Fahren).
// Eingehalten wird: Öffnungszeiten, feste Termine nicht später als bisher, Rückkehrzeit (bzw. letzter Besuch Tag 1 bis 18 Uhr),
// bei Übernachtung Tag 1 bleibt der letzte Besuch (Hotelort) der letzte.
export function feinschliff(D) {
  if (!D || D.type === "home" || D.stops.length < 3) return false;
  const n = D.stops.length;
  const e = dayEnds(D), jetzt = simulate(e.start, e.sMin, D.stops, D.day, e.end);
  const fahrMin = s => s.legs.reduce((a, L) => a + L.min, 0) + s.backMin;
  const verz = Object.fromEntries(jetzt.legs.filter(L => L.fixed).map(L => [L.id, L.verz]));
  const grenze = e.limit != null ? Math.max(e.limit, jetzt.end) : null;
  const gueltig = s => s.ok && !s.legs.some(L => L.fixed && L.verz > (verz[L.id] || 0) + 1)
    && (D.type === "ov1" ? s.legs[s.legs.length - 1].begin <= Math.max(tmin(S.lastVisitDay1), jetzt.legs[jetzt.legs.length - 1].begin) : s.end <= grenze);
  const wertVon = s => (D.type === "ov1" ? s.legs[s.legs.length - 1].leave : s.end) - s.depart + 0.25 * fahrMin(s);
  let bestWert = wertVon(jetzt) - 0.5, best = null; // nur wirklich bessere Reihenfolgen übernehmen
  const letzter = D.type === "ov1" ? D.stops[n - 1] : null, frei = letzter ? D.stops.slice(0, -1) : D.stops.slice();
  const seq = [], benutzt = frei.map(() => false); let schritte = 0;
  const rec = (pos, fahr, besuche) => {
    // untere Grenze: bisherige Fahrzeit + Besuchsdauer (+ ein Viertel der Fahrzeit) – schon zu hoch? (bzw. Notbremse)
    if (1.25 * fahr + besuche >= bestWert || ++schritte > 400000) return;
    if (seq.length === frei.length) {
      const voll = letzter ? seq.concat(letzter) : seq.slice();
      const s = simulate(e.start, e.sMin, voll, D.day, e.end); const wert = wertVon(s);
      if (wert < bestWert && gueltig(s)) { bestWert = wert; best = voll; }
      return;
    }
    for (let i = 0; i < frei.length; i++) {
      if (benutzt[i]) continue; const c = byId(frei[i]); if (!c) continue;
      benutzt[i] = true; seq.push(frei[i]); rec(c, fahr + fahrt(pos, c).min, besuche + dauer(c)); seq.pop(); benutzt[i] = false;
    }
  };
  rec(e.start, 0, 0);
  if (best) { D.stops = best; return true; }
  return false;
}
// Umweg (km), wenn Kunde c in die Strecke des Tages eingefügt wird – zwischen zwei Punkten der Strecke
// (Start, Besuche, Rückfahrt nach Hause). Bei Übernachtung Tag 1 nur vor dem letzten Besuch (dort ist das Hotel).
function umweg(D, c) {
  const e = dayEnds(D), pts = [e.start, ...D.stops.map(byId).filter(Boolean)]; if (e.end) pts.push(e.end);
  let best = Infinity; const k = (a, b) => fahrt(a, b).km; // echte Straßen-km, soweit berechnet (sonst Schätzung)
  for (let i = 0; i < pts.length - 1; i++) best = Math.min(best, k(pts[i], c) + k(c, pts[i + 1]) - k(pts[i], pts[i + 1]));
  return best;
}
const UMWEG_MAX = 20, NAH_KM = 15;
// Tag auffüllen, bis er voll ist oder nichts mehr passt: Kunden höchstens 15 km neben einem Besuch oder mit höchstens
// 20 km Umweg auf der Strecke; wichtigste (Umsatz bzw. am längsten nicht besucht) zuerst, kleiner Umweg bevorzugt.
function auffuellen(D, frei, genommen) {
  const ov1Ende = D.type === "ov1" ? D.stops[D.stops.length - 1] : null; // Hotel bleibt beim letzten Besuch von Tag 1
  while (D.stops.length < S.maxVisits) {
    const st = D.stops.map(byId).filter(Boolean);
    // An Übernachtungstagen nur Kunden in der Ferne – Kunden nahe Bremen bleiben für Tagestouren
    const fern = D.type === "tour" ? (() => true) : (c => c.dHome > S.overnightKm * 0.5);
    const kand = CUST.filter(c => frei(c) && !D.stops.includes(c.id) && el(c) && openOn(c, D.day) && fern(c))
      .map(c => ({ c, u: Math.min(umweg(D, c), st.some(s => km(s, c) <= NAH_KM) ? 0 : Infinity) }))
      .filter(x => x.u <= UMWEG_MAX).sort((a, b) => b.c.urg / (1 + b.u / 20) - a.c.urg / (1 + a.u / 20));
    let rein = null; const e = dayEnds(D), vorKm = simulate(e.start, e.sMin, D.stops, D.day, e.end).km;
    for (const { c } of kand.slice(0, 60)) {
      // Tag 1 einer Übernachtung: nur vor dem letzten Besuch einfügen (Hotelort bleibt), sonst beste Stelle/Reihenfolge
      const r = ov1Ende ? insertBest(D, c.id, false, D.stops.length - 1) : tryInsert(D, c.id);
      // tatsächliche Mehr-km der neuen Tour prüfen (hin und zurück zu einem Kunden in der Nähe zählt doppelt)
      if (r && simulate(e.start, e.sMin, r, D.day, e.end).km - vorKm <= Math.max(UMWEG_MAX, 2 * NAH_KM)) { rein = r; genommen(c.id); break; }
    }
    if (!rein) break;
    D.stops = rein;
  }
}
// Start/Ende und späteste Rückkehr eines Tages
export function dayEnds(D) {
  if (D.type === "ov1") return { start: HOME, sMin: tmin(S.depart), end: null, limit: null };
  if (D.type === "ov2") return { start: D.hotel, sMin: tmin(S.hotelStart), end: HOME, limit: tmin(S.latestOv) };
  return { start: HOME, sMin: tmin(S.depart), end: HOME, limit: tmin(S.latest) };
}
export function setFix(fixed, mondayISO) {
  FIX = {}; SPAETER = new Set(); const mon = parseISO(mondayISO);
  for (const id in (fixed || {})) { const f = fixed[id]; const di = Math.round((parseISO(f.date) - mon) / 864e5); if (di >= 0 && di <= 3) FIX[id] = { day: di, time: f.time }; else if (di > 3) SPAETER.add(id); }
}
export const istFix = (id, day) => !!(FIX[id] && FIX[id].day === day);
const hasFix = D => D.stops.some(id => FIX[id] && FIX[id].day === D.day);
function feasible(D, seq) {
  const e = dayEnds(D); const s = simulate(e.start, e.sMin, seq, D.day, e.end); if (!s.ok) return null;
  if (s.lateFix || s.spaet) {
    // Ein fester Termin wird zu spät erreicht: nur in Ordnung, wenn das sowieso nicht zu schaffen ist
    // (gleiche Verspätung wie ohne die übrigen Besuche) – der Tag wird dann trotzdem aufgefüllt
    const fx = seq.filter(id => FIX[id] && FIX[id].day === D.day).sort((a, b) => tmin(FIX[a].time) - tmin(FIX[b].time));
    const grenze = Object.fromEntries(simulate(e.start, e.sMin, fx, D.day, e.end).legs.map(L => [L.id, L.verz]));
    if (s.legs.some(L => L.fixed && L.verz > (grenze[L.id] || 0) + 1)) return null;
  }
  if (D.type === "ov1") return s.legs.length && s.legs[s.legs.length - 1].begin > tmin(S.lastVisitDay1) ? null : s;
  return s.end <= e.limit ? s : null;
}
function insertBest(D, id, force, bisPos = D.stops.length) {
  let best = null, bv = 1e9, fb = null, fv = 1e9; const e = dayEnds(D);
  for (let i = 0; i <= bisPos; i++) {
    const seq = D.stops.slice(0, i).concat(id, D.stops.slice(i)); const f = feasible(D, seq);
    if (f && f.end < bv) { bv = f.end; best = seq; }
    if (force) { const s = simulate(e.start, e.sMin, seq, D.day, e.end); const v = s.end + (s.lateFix ? 1e5 : 0) + (s.ok ? 0 : 1e4); if (v < fv) { fv = v; fb = seq; } }
  }
  return best || (force ? fb : null);
}
export function resequence(D) {
  const fx = D.stops.filter(id => FIX[id] && FIX[id].day === D.day).sort((a, b) => tmin(FIX[a].time) - tmin(FIX[b].time));
  const rest = D.stops.filter(id => !fx.includes(id)); const tmp = { ...D, stops: fx };
  for (const id of rest) { tmp.stops = insertBest(tmp, id, true); }
  D.stops = tmp.stops;
}
// Einen Tag der geplanten Woche um seine festen Termine herum neu planen (z. B. nach einem neu vereinbarten Termin).
// Feste Termine bleiben, die übrigen Besuche werden durch passende Kunden in der Nähe der Termine ersetzt.
// Ergebnis: { raus: Kunden, die vorher geplant waren und jetzt nicht mehr, neu: Anzahl Besuche danach }
export function planeTagUm(plan, di) {
  setFix(plan.fixed || {}, plan.week); setzeStichtag(plan.week);
  const D = plan.days[di]; if (!D || D.type === "home") return null;
  const vorher = D.stops.slice();
  D.stops = D.stops.filter(id => FIX[id] && FIX[id].day === D.day).sort((a, b) => tmin(FIX[a].time) - tmin(FIX[b].time));
  if (!D.stops.length) { D.stops = vorher; return null; }
  const anderswo = new Set(plan.days.filter((X, i) => i !== di).flatMap(X => X.stops)), ex = new Set(plan.excluded || []);
  const frei = c => !c.out && c.lat != null && !c.planHold && !gesperrt(c.id) && !ex.has(c.id) && !anderswo.has(c.id) && !D.stops.includes(c.id) && openOn(c, D.day) && el(c);
  // Kunden in der Nähe der Termine (auch wenn der Termin weit draußen liegt – ob der Tag passt, prüft insertBest)
  const sd = D.stops.map(byId).filter(Boolean), dist = c => Math.min(...sd.map(x => km(x, c)));
  const near = CUST.filter(c => frei(c) && dist(c) <= 45).sort((a, b) => b.urg / (1 + dist(b) / 20) - a.urg / (1 + dist(a) / 20));
  for (const c of near) { if (D.stops.length >= S.maxVisits) break; const r = insertBest(D, c.id); if (r) D.stops = r; }
  // Auffüllen: in der Nähe oder mit kleinem Umweg auf der Strecke (auch auf dem Heimweg)
  auffuellen(D, frei, () => {});
  feinschliff(D); // schnellste Reihenfolge (bei Tag 1 bleibt der letzte Besuch = Hotelort)
  // Übernachtung Tag 1: Hotel im Ort des letzten Besuchs
  if (D.type === "ov1") {
    D.hotel = hotelOrt(byId(D.stops[D.stops.length - 1]));
    const D2 = plan.days.find(X => X.type === "ov2"); if (D2) D2.hotel = D.hotel;
  }
  return { raus: vorher.filter(id => !D.stops.includes(id)), neu: D.stops.length };
}
export function tryInsert(D, id) {
  if (hasFix(D)) return insertBest(D, id);
  const e = dayEnds(D); const seq = order(e.start, D.stops.concat(id), e.end || null, { sMin: e.sMin, day: D.day });
  const s = simulate(e.start, e.sMin, seq, D.day, e.end); if (!s.ok) return null;
  if (D.type === "ov1") { if (s.legs[s.legs.length - 1].begin > tmin(S.lastVisitDay1)) return null; return seq; }
  return s.end <= e.limit ? seq : null;
}
export function simDay(D) { const e = dayEnds(D); return simulate(e.start, e.sMin, D.stops, D.day, e.end); }

/* ---------- Ersatz und Alternativen ---------- */
// Kunden, die als Ersatz für einen Tag in Frage kommen (nicht verplant, nicht ausgeschlossen, an dem Tag geöffnet).
// weit = true: auch Kunden, die sonst nicht dran wären (z. B. ohne Umsatz im gewählten Jahr) – Mindestabstand gilt trotzdem.
function ersatzKandidaten(plan, D, extraAus, weit) {
  const inPlan = new Set(plan.days.flatMap(X => X.stops)); const ex = new Set(plan.excluded || []);
  const nah = D.type === "tour" ? (c => c.dHome <= S.overnightKm) : (() => true);
  // weit: auch Kunden ohne Umsatz (Mindestabstand gilt trotzdem)
  const passt = weit ? (c => c.gapOk) : el;
  return CUST.filter(c => !c.out && c.lat != null && !c.planHold && !gesperrt(c.id) && !inPlan.has(c.id) && !ex.has(c.id) && !(extraAus && extraAus.has(c.id)) && nah(c) && openOn(c, D.day) && passt(c));
}
// Nach dem Entfernen eines Kunden: passenden Ersatz in den Tag einfügen.
export function findReplacement(plan, D, removed) {
  const anchors = D.stops.map(byId).filter(Boolean); if (!anchors.length && removed) anchors.push(removed);
  if (!anchors.length) return null;
  const dist = c => Math.min(...anchors.map(a => km(a, c)));
  const cands = ersatzKandidaten(plan, D).filter(c => dist(c) <= 40).sort((a, b) => b.urg / (1 + dist(b) / 20) - a.urg / (1 + dist(a) / 20));
  for (const c of cands.slice(0, 40)) { const r = tryInsert(D, c.id); if (r) return { seq: r, c }; }
  return null;
}
// Zu jedem geplanten Besuch einen Alternativ-Kunden in der Nähe, der an dieselbe Stelle der Tour passt.
// Reihenfolge der Suche: eigener Alternativ-Kunde -> mit anderem Besuch geteilt -> auch Kunden, die sonst nicht dran wären.
export function alternativen(plan) {
  setFix(plan.fixed || {}, plan.week); setzeStichtag(plan.week);
  const res = {}, vergeben = new Set();
  const stufen = [{ teilen: false, weit: false }, { teilen: true, weit: false }, { teilen: false, weit: true }, { teilen: true, weit: true }];
  for (const D of plan.days) {
    if (D.type === "home") continue;
    D.stops.forEach((id, i) => {
      const s = byId(id); if (!s) return;
      for (const st of stufen) {
        const alle = ersatzKandidaten(plan, D, st.teilen ? null : vergeben, st.weit);
        for (const radius of [30, 50, 80]) {
          const cands = alle.filter(c => km(s, c) <= radius).sort((a, b) => b.urg / (1 + km(s, b) / 10) - a.urg / (1 + km(s, a) / 10));
          for (const c of cands.slice(0, 25)) {
            const seq = D.stops.slice(); seq[i] = c.id;
            if (feasible(D, seq)) { res[id] = { id: c.id, km: km(s, c), geteilt: vergeben.has(c.id), weit: st.weit }; vergeben.add(c.id); return; }
          }
        }
      }
    });
  }
  return res;
}
