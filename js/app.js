// Oberfläche des Tourenplaners.
import { HOME, WD, WDS, DEFAULTS, tmin, hhmm, iso, parseISO, addDays, fmtD, eur, today, esc } from "./grundlagen.js";
import * as P from "./planung.js";
import { PLZ } from "./plz.js";
import { leseStand, schreibeStand, kundenNormalisieren, umsatzJahre, umsatzJahr, eigeneSpalten, spalteBekannt, STANDARD_REIHENFOLGE, kundenlisteLesen, abgleichVorschlag, abgleichAnwenden, stammName } from "./excel.js";
import * as Sp from "./speicher.js";
import * as G from "./google.js";
import * as F from "./fahrzeiten.js";
import * as B from "./bestellung.js";
import * as BF from "./beanstandung.js";
import * as A from "./auswertung.js";

const $ = s => document.querySelector(s);
const XLSX = window.XLSX;
const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const XLSX_TYP = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// DATA: { kunden, einst, plan, kalLoeschen, quelle, ungesichert, drive:{id,modifiedTime}, driveOffen, aenderung }
let DATA = null;
let ORDNER = null;      // Infos zum Tourenplaner-Ordner, wenn die App auf dem Rechner läuft
let AUSW = { zr: "3m", von: "", bis: "", q: "" }; // Auswertung der Notizen
let TAB = "plan", FILTER = { q: "", abc: "", due: false, merkmal: "", ohneOh: false, trend: false };
let SPEICHER_OK = true, SYNC_LAEUFT = false, SYNC_FEHLER = "", KONFLIKT = null, syncTimer = null;
let FZ = F.neueTabelle(), FZ_LAEUFT = "", FZ_MELDUNG = "";
const S = () => P.S;
const PLAN = () => DATA && DATA.plan; // die gerade angezeigte Woche
// Höchstens so viele kommende Wochen sind geplant (2026-10-08). Die 2. Woche wird nur auf Knopfdruck geplant.
// Termine gehen trotzdem für jedes Datum; die Woche wird um sie herum geplant, sobald sie geplant wird.
const MAX_WOCHEN = 2;
// Alle geplanten Wochen (kommende und die letzten 4 Wochen zum Abschließen der Tage; oben angezeigt werden nur die kommenden).
// DATA.plan ist immer eine davon (nach dem Laden aus dem Gerätespeicher wird sie wieder verknüpft).
function PLAENE() {
  if (!DATA.plaene) DATA.plaene = DATA.plan ? [DATA.plan] : [];
  const grenze = iso(addDays(parseISO(montag(today())), -28));
  DATA.plaene = DATA.plaene.filter(p => p.week >= grenze).sort((a, b) => a.week.localeCompare(b.week));
  if (DATA.plan) DATA.plan = DATA.plaene.find(p => p.week === DATA.plan.week) || null;
  if (DATA.plan && DATA.plan.week < ab()) DATA.plan = null; // vergangene Woche nicht mehr anzeigen
  if (!DATA.plan) DATA.plan = DATA.plaene.find(p => p.week >= ab()) || null;
  return DATA.plaene;
}
// erste Woche, die noch geplant werden kann (Mo–Mi diese Woche, ab Donnerstag die nächste)
const ab = () => iso(P.weekStart());
// kommende geplante Wochen (nur diese stehen oben als Reiter)
const kommende = () => PLAENE().filter(p => p.week >= ab());
// Vor dem Planen einer neuen Woche: sind schon MAX_WOCHEN kommende Wochen geplant, wird nach Rückfrage
// die am weitesten entfernte gelöscht (feste Termine bleiben erhalten). false = abgebrochen.
function platzFuer(mon) {
  const andere = kommende().filter(p => p.week !== mon);
  if (mon < ab() || andere.length < MAX_WOCHEN) return true;
  const weg = andere.slice().sort((a, b) => Math.abs(parseISO(b.week) - parseISO(mon)) - Math.abs(parseISO(a.week) - parseISO(mon))).slice(0, andere.length - MAX_WOCHEN + 1);
  if (!confirm(`Es werden höchstens ${MAX_WOCHEN} Wochen geplant. Dafür wird ${weg.map(p => "KW " + kw(p.week)).join(", ")} gelöscht (feste Termine bleiben erhalten). Weiter?`)) return false;
  DATA.plaene = PLAENE().filter(p => !weg.includes(p)); return true;
}
// Woche in die Liste aufnehmen (ersetzt dieselbe Woche) und auf Wunsch anzeigen
function planSetzen(plan, zeigen = true) {
  DATA.plaene = PLAENE().filter(p => p.week !== plan.week).concat(plan).sort((a, b) => a.week.localeCompare(b.week));
  plan.fixed = TERMINE(); if (zeigen) DATA.plan = plan;
}
const planVon = week => PLAENE().find(p => p.week === week);
// Kunden, die in anderen (noch nicht vergangenen) Wochen eingeplant sind – nicht doppelt einplanen
const belegtFuer = week => PLAENE().filter(p => p.week !== week && p.week >= montag(today())).flatMap(p => p.days.flatMap(D => D.stops));
// Kalenderwoche nach ISO (Montag als erster Tag)
const kw = d => { const t = parseISO(d); t.setDate(t.getDate() + 3 - (t.getDay() + 6) % 7); const j = new Date(t.getFullYear(), 0, 4); return 1 + Math.round(((t - j) / 864e5 - 3 + (j.getDay() + 6) % 7) / 7); };
// Feste Termine aller Wochen ({ Kd-Nr.: { date, time, ev, cal } }). Die Wochenpläne nutzen dieselbe Liste (plan.fixed).
// Ältere Stände hatten die Termine nur im Wochenplan; Termine, die länger als 60 Tage vorbei sind, fallen weg.
function TERMINE() {
  if (!DATA.termine) DATA.termine = (PLAN() && PLAN().fixed) || {};
  for (const p of PLAENE()) p.fixed = DATA.termine;
  const alt = iso(addDays(new Date(), -60));
  for (const id in DATA.termine) if (DATA.termine[id].date < alt) delete DATA.termine[id];
  return DATA.termine;
}
const wochentag = d => (parseISO(d).getDay() + 6) % 7; // 0 = Montag
const montag = d => iso(addDays(parseISO(d), -wochentag(d)));
const roh = id => DATA.kunden.find(k => k.id === id);
const byId = P.byId;
const driveBereit = () => G.konfiguriert() && G.angemeldet();

/* ---------- Speichern ---------- */
function persist(geaendert = true) {
  if (geaendert) { DATA.ungesichert = true; DATA.driveOffen = true; DATA.aenderung = (DATA.aenderung || 0) + 1; planeAbgleich(); }
  SPEICHER_OK = Sp.speichern(DATA);
  statusZeigen();
}
function statusZeigen() {
  const el = $("#sync"), gb = $("#gbtn"); if (!el) return;
  let t, warn = false, knopf = false;
  if (!DATA) t = "";
  else if (!SPEICHER_OK) { t = "Speichern auf dem Gerät fehlgeschlagen"; warn = true; }
  else if (G.konfiguriert() && !G.angemeldet()) { t = DATA.driveOffen ? "Nur auf diesem Gerät gespeichert" : "Nicht mit Google verbunden"; warn = DATA.driveOffen; knopf = true; }
  else if (G.konfiguriert()) {
    if (!navigator.onLine) { t = DATA.driveOffen ? "Offline – wird später in Google Drive gespeichert" : "Offline"; warn = DATA.driveOffen; }
    else if (SYNC_FEHLER) { t = SYNC_FEHLER; warn = true; }
    else t = SYNC_LAEUFT ? "Wird abgeglichen …" : DATA.driveOffen ? "Wird gespeichert …" : "In Google Drive gespeichert";
  }
  else { t = DATA.ungesichert ? "Änderungen noch nicht als Excel gesichert" : "Gespeichert"; warn = DATA.ungesichert; }
  if (FZ_LAEUFT) t += " · " + FZ_LAEUFT;
  el.textContent = t; el.className = "sync" + (warn ? " dirty" : "");
  if (gb) gb.hidden = !knopf;
}
function aufbereiten() { P.setzeEinstellungen(DATA.einst); fzAnschliessen(); P.rebuild(DATA.kunden); const T = TERMINE(); if (PLAN()) P.setFix(T, PLAN().week); P.setzeBelegt(PLAN() ? belegtFuer(PLAN().week) : []); }

/* ---------- Fahrzeiten (OpenRouteService) ---------- */
const FZ_KEY = "tourenplaner-fahrzeiten", FZ_DRIVE_KEY = "tourenplaner-fahrzeiten-drive";
function fzLadenLokal() { try { const s = localStorage.getItem(FZ_KEY); if (s) FZ = F.ausText(s); } catch (e) { FZ = F.neueTabelle(); } }
function fzSpeichernLokal() { try { localStorage.setItem(FZ_KEY, F.alsText(FZ)); } catch (e) { /* zu groß o. ä. – dann nur im Speicher */ } }
function fzAnschliessen() { P.setzeFahrtQuelle(FZ.punkte.length ? F.fahrtQuelle(FZ, +S().zuschlag || 0) : null); }
// Alle Orte, für die Fahrzeiten gebraucht werden: Startadresse + Lage aller aktiven Kunden (PLZ-Mittelpunkte)
function benoetigtePunkte() { if (!P.startBekannt()) return []; return [F.punktKey(HOME)].concat(P.CUST.filter(c => c.lat != null && !c.out).map(F.punktKey)); }
async function fzBerechnen(manuell) {
  if (!DATA || FZ_LAEUFT) return;
  const key = (DATA.einst.orsKey || "").trim();
  if (!key) { if (manuell) toast("Bitte zuerst den OpenRouteService-Schlüssel eintragen"); return; }
  if (!P.startBekannt()) { if (manuell) toast("Bitte zuerst die Startadresse eintragen"); return; }
  aufbereiten();
  FZ = F.punkteErgaenzen(FZ, benoetigtePunkte());
  if (!F.fehlendePaare(FZ)) { if (manuell) toast("Alle Fahrzeiten sind schon berechnet"); return; }
  FZ_LAEUFT = "Fahrzeiten werden berechnet …"; FZ_MELDUNG = ""; statusZeigen();
  const r = await F.berechnen(FZ, key, { fortschritt: (a, b) => { FZ_LAEUFT = `Fahrzeiten ${a} von ${b}`; statusZeigen(); } });
  FZ = r.tabelle; fzSpeichernLokal(); FZ_LAEUFT = ""; FZ_MELDUNG = r.abbruch || "";
  render(); toast(r.abbruch ? "Fahrzeiten: " + r.abbruch : "Echte Fahrzeiten sind jetzt da");
  if (!r.abbruch && driveBereit()) fzNachDrive().catch(e => console.warn(e));
}
async function fzNachDrive() {
  const info = await G.dateiInfo(G.FAHRZEIT_DATEI);
  const res = await G.dateiSpeichern(G.FAHRZEIT_DATEI, F.alsText(FZ), "application/json", info && info.id);
  try { localStorage.setItem(FZ_DRIVE_KEY, res.modifiedTime); } catch (e) { /* egal */ }
}
// Fahrzeiten, die ein anderes Gerät berechnet hat, übernehmen (spart Anfragen)
async function fzVonDrive() {
  const info = await G.dateiInfo(G.FAHRZEIT_DATEI); if (!info) { if (FZ.punkte.length && !F.fehlendePaare(FZ)) await fzNachDrive(); return; }
  let bekannt = ""; try { bekannt = localStorage.getItem(FZ_DRIVE_KEY) || ""; } catch (e) { /* egal */ }
  if (info.modifiedTime === bekannt) return;
  const t = F.ausText(new TextDecoder().decode(await G.dateiLaden(info.id)));
  if (t.punkte.length >= FZ.punkte.length) { FZ = t; fzSpeichernLokal(); render(); }
  try { localStorage.setItem(FZ_DRIVE_KEY, info.modifiedTime); } catch (e) { /* egal */ }
}

/* ---------- Abgleich mit Google Drive und Kalender ---------- */
function planeAbgleich() { clearTimeout(syncTimer); syncTimer = setTimeout(abgleichen, 2500); }
async function abgleichen() {
  if (!driveBereit() || SYNC_LAEUFT || KONFLIKT) { statusZeigen(); return; }
  SYNC_LAEUFT = true; SYNC_FEHLER = ""; statusZeigen();
  try {
    if (DATA) await kalenderAbgleichen();
    const meta = await G.dateiInfo(G.STAND_DATEI);
    if (!DATA) { if (meta) await vonDriveLaden(meta); }
    else if (!meta) await nachDrive(null);
    else if (DATA.drive && DATA.drive.modifiedTime === meta.modifiedTime) { if (DATA.driveOffen) await nachDrive(meta.id); }
    else if (DATA.drive && !DATA.driveOffen) await vonDriveLaden(meta);
    else { KONFLIKT = meta; konfliktDialog(meta); }
    await fzVonDrive();
    if (DATA && !KONFLIKT) await wochenSicherung();
  } catch (e) {
    console.warn(e);
    SYNC_FEHLER = e.code === "anmelden" ? "" : navigator.onLine ? "Google Drive nicht erreichbar – wird erneut versucht" : "";
  } finally {
    SYNC_LAEUFT = false; statusZeigen();
    if (DATA && DATA.driveOffen && !KONFLIKT && !SYNC_FEHLER) planeAbgleich(); // z. B. Datum der Sicherung nachtragen
  }
}
/* ---------- Sicherungen in Google Drive (Ordner Tourenplaner › Sicherungen) ---------- */
// Kopie des ganzen Stands anlegen; zusatz kommt in den Dateinamen (z. B. "vor_Abgleich_1432")
async function sicherungAnlegen(zusatz) {
  const name = `Tourenplaner_Sicherung_${today()}${zusatz ? "_" + zusatz : ""}.xlsx`;
  await G.sicherungSpeichern(name, schreibeStand(XLSX, DATA), XLSX_TYP);
  DATA.sicherung = today(); persist(); // Datum geht mit in den Stand, damit nicht jedes Gerät noch einmal sichert
  return name;
}
// Einmal pro Woche beim ersten Abgleich mit Google Drive
async function wochenSicherung() {
  if (DATA.sicherung && DATA.sicherung >= montag(today())) return;
  try { const n = await sicherungAnlegen(""); toast("Wöchentliche Sicherung angelegt: " + n); }
  catch (e) { console.warn("Sicherung", e); }
}
const uhrzeitJetzt = () => { const d = new Date(); return String(d.getHours()).padStart(2, "0") + String(d.getMinutes()).padStart(2, "0"); };
async function nachDrive(id) {
  const stand = DATA.aenderung;
  const res = await G.dateiSpeichern(G.STAND_DATEI, schreibeStand(XLSX, DATA), XLSX_TYP, id);
  DATA.drive = { id: res.id, modifiedTime: res.modifiedTime };
  if (DATA.aenderung === stand) { DATA.driveOffen = false; DATA.ungesichert = false; }
  persist(false);
}
async function vonDriveLaden(meta) {
  const st = leseStand(XLSX, await G.dateiLaden(meta.id));
  DATA = { kunden: st.kunden, einst: st.einst, plan: st.plan, plaene: st.plaene, sicherung: st.sicherung, kalLoeschen: st.kalLoeschen, spalten: st.spalten, spaltenArten: st.spaltenArten, termine: st.termine, quelle: "Google Drive › " + G.ORDNER + " › " + G.STAND_DATEI,
    drive: { id: meta.id, modifiedTime: meta.modifiedTime }, driveOffen: false, ungesichert: false, aenderung: 0 };
  persist(false); render(); toast("Aktueller Stand aus Google Drive geladen");
}
function konfliktDialog(meta) {
  const wann = new Date(meta.modifiedTime).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
  dlg(`<header class="dh"><h3>Zwei verschiedene Stände</h3></header>
   <p>Der Stand in Google Drive wurde am ${esc(wann)} geändert (z. B. in Excel oder auf einem anderen Gerät). Auf diesem Gerät gibt es ebenfalls Änderungen, die noch nicht in Google Drive sind.</p>
   <p class="muted">Google Drive hebt ältere Fassungen 30 Tage lang auf („Versionen verwalten“). Es geht also nichts endgültig verloren.</p>
   <div class="row wrap"><button class="pri" value="drivelade">Stand aus Google Drive laden</button><button value="driveueber">Stand von diesem Gerät behalten</button></div>`);
}
const kalBody = (c, f) => {
  const ende = hhmm(tmin(f.time) + P.dauer(c));
  const z = [c.tel ? "Telefon: " + c.tel : "", c.mob ? "Mobil: " + c.mob : "", c.tel2 ? "Telefon 2: " + c.tel2 : "", c.ap ? "Ansprechpartner: " + c.ap + (c.pos ? " (" + c.pos + ")" : "") : "", c.dk ? "Direkt: " + c.dk : "", "Kd.-Nr.: " + (vorlaeufig(c.id) ? "noch keine" : c.id)].filter(Boolean);
  const last = c.notes.slice(-2).map(n => fmtD(n.d) + ": " + n.t); if (last.length) z.push("", "Letzte Notizen:", ...last);
  z.push("", "Eingetragen vom Tourenplaner");
  return { summary: "Kundenbesuch: " + c.n1, location: [c.str, (c.plz + " " + c.ort).trim()].filter(Boolean).join(", "), description: z.join("\n"),
    start: { dateTime: f.date + "T" + f.time + ":00", timeZone: "Europe/Berlin" }, end: { dateTime: f.date + "T" + ende + ":00", timeZone: "Europe/Berlin" } };
};
async function kalenderAbgleichen() {
  let geaendert = false;
  DATA.kalLoeschen = DATA.kalLoeschen || [];
  while (DATA.kalLoeschen.length) { await G.terminLoeschen(DATA.kalLoeschen[0]); DATA.kalLoeschen.shift(); geaendert = true; }
  if (S().calSync) {
    aufbereiten();
    for (const [id, f] of Object.entries(TERMINE())) {
      if (f.cal === "ok") continue;
      const c = byId(id); if (!c) continue;
      f.ev = await G.terminEintragen(kalBody(c, f), f.ev); f.cal = "ok"; geaendert = true;
    }
  }
  if (geaendert) { DATA.driveOffen = true; DATA.aenderung = (DATA.aenderung || 0) + 1; persist(false); render(); }
}
// Fester Termin fällt weg: Kalendereintrag zum Löschen vormerken.
// Mit Datum nur, wenn der Termin an diesem Tag ist (ein Termin in einer anderen Woche bleibt dann bestehen).
function fixWeg(id, datum) {
  const T = TERMINE(), f = T[id]; if (!f || (datum && f.date !== datum)) return;
  if (f.ev) (DATA.kalLoeschen = DATA.kalLoeschen || []).push(f.ev);
  delete T[id];
}
function geaendert() { persist(); aufbereiten(); render(); }

/* ---------- Anzeige ---------- */
function render() {
  document.querySelectorAll(".tabs button").forEach(b => b.setAttribute("aria-current", b.dataset.t === TAB ? "page" : "false"));
  const m = $("#main");
  if (!DATA) { m.innerHTML = renderStart(); return; }
  aufbereiten();
  if (TAB === "plan") { m.innerHTML = renderPlan(); drawMap(); }
  else if (TAB === "kunden") m.innerHTML = renderList();
  else if (TAB === "auswertung") m.innerHTML = renderAuswertung();
  else m.innerHTML = renderSettings();
}
function renderStart() {
  return `<section class="start"><h2>Willkommen</h2>
   ${G.konfiguriert() ? (G.angemeldet() ? `<p>Mit Google verbunden – der Stand wird aus Google Drive geladen …</p>`
     : `<p>Melden Sie sich mit Ihrem Google-Konto an. Dann wird Ihr Stand aus Google Drive geladen.</p><button class="pri" data-a="gverbinden">Mit Google verbinden</button><p class="muted">Oder:</p>`) : ""}
   <p>Auf diesem Gerät ist noch kein Stand gespeichert. Bitte laden Sie Ihren Excel-Stand (Datei <b>Tourenplaner_Stand_….xlsx</b>).</p>
   ${ORDNER && ORDNER.stand ? `<button class="pri" data-a="ordnerladen">Neuesten Stand aus dem Ordner laden<br><small>${esc(ORDNER.stand)}</small></button>` : ""}
   <label>Excel-Datei auswählen<input type="file" id="xlsxfile" accept=".xlsx"></label></section>`;
}
const abcTag = c => `<span class="abc abc-${c.abc}">${c.abc}</span>`;
/* ---------- Umsatzentwicklung ---------- */
const ruecklaeufig = c => c.trend != null && isFinite(c.trend) && c.trend <= -0.2;
const prozent = t => Math.round(t * 100) === 0 ? "±0 %" : (t > 0 ? "+" : "−") + Math.abs(Math.round(t * 100)) + " %";
const trendBewertbar = () => { const T = P.trendInfo(); return T && !T.zuFrueh ? T : null; };
// Pfeil/Zeichen: ▲/▼ ab 10 % Veränderung, ● darunter (gleichbleibend)
function trendZeichen(t) {
  if (Math.abs(t) < 0.1) return `<span class="muted">● ${prozent(t)}</span>`;
  return t < 0 ? `<span class="warn">▼ ${prozent(t)}</span>` : `<span class="ok">▲ ${prozent(t)}</span>`;
}
// kurz für Listen – bei jedem Kunden, sobald die Entwicklung bewertbar ist
function trendKurz(c) {
  const T = trendBewertbar(); if (!T) return "";
  if (c.trend == null) return ` · <span class="muted">kein Umsatz ${String(T.vorjahr).slice(2)}/${String(T.jahr).slice(2)}</span>`;
  if (!isFinite(c.trend)) return ` · <span class="ok">neu ${String(T.jahr).slice(2)}</span>`;
  return " · " + trendZeichen(c.trend);
}
// ausführlich für die Kundenansicht
function trendLang(c) {
  const T = trendBewertbar(); if (!T) return "";
  if (c.trend == null) return `<dt>Entwicklung</dt><dd class="muted">kein Umsatz ${T.vorjahr} und ${T.jahr}</dd>`;
  const j = String(T.jahr).slice(2), bis = T.stand ? " bis " + fmtD(T.stand).slice(0, 6) : "";
  const neu = `Umsatz ${j}${bis}: ${eur(c.trendNeu)}${T.anteil < 1 ? ` → aufs Jahr hochgerechnet ca. ${eur(c.trendHoch)}` : ""}`;
  const verg = !isFinite(c.trend) ? `<span class="ok">neuer Umsatz (${T.vorjahr} ohne Umsatz)</span>`
    : `Vorjahr ${eur(c.trendAlt)} · ${trendZeichen(c.trend)}${Math.abs(c.trend) < 0.1 ? " (gleichbleibend)" : ""}`;
  return `<dt>Entwicklung</dt><dd>${neu} · ${verg}</dd>`;
}
function dueText(c) {
  const w = c.since == null ? "noch nie besucht" : "zuletzt vor " + Math.round(c.since / 7) + " Wo.";
  return "Umsatz " + S().umsatzJahr + ": " + eur(c.uPlan) + trendKurz(c) + " · " + w + (c.gapOk ? "" : " · Mindestabstand noch nicht erreicht");
}
const telLink = t => t ? `<a href="tel:${esc(t.replace(/[^\d+]/g, ""))}">${esc(t)}</a>` : "";
// Navigation zu einem Kunden: auf dem iPhone Apple Karten, sonst Google Maps. Es wird nur die Adresse übergeben (kein Firmenname).
function navLink(c, text) {
  const adr = [c.str, (c.plz + " " + c.ort).trim()].filter(Boolean).join(", ");
  const url = IOS ? "https://maps.apple.com/?daddr=" + encodeURIComponent(adr) + "&dirflg=d" : "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(adr) + "&travelmode=driving";
  return `<a href="${url}" target="_blank" rel="noopener">${text}</a>`;
}
function gmaps(D) {
  const pts = []; const e = P.dayEnds(D); pts.push(e.start === HOME ? S().start : (D.hotel.plz + " " + D.hotel.ort));
  for (const id of D.stops) { const c = byId(id); if (c) pts.push(`${c.str}, ${c.plz} ${c.ort}`); }
  if (e.end) pts.push(S().start);
  return "https://www.google.com/maps/dir/" + pts.map(encodeURIComponent).join("/");
}
function bookingUrl(h, date) {
  const ci = date, co = iso(addDays(parseISO(date), 1));
  let f = "mealplan=1;price=EUR-0-" + S().hotelMax + "-1"; if (S().parking) f += ";hotelfacility=2";
  return `https://www.booking.com/searchresults.de.html?ss=${encodeURIComponent(h.ort + ", Deutschland")}&checkin=${ci}&checkout=${co}&group_adults=1&no_rooms=1&group_children=0&nflt=${encodeURIComponent(f)}`;
}

// Warum in der geplanten Woche keine Übernachtung zustande kam
function ovGrund(PL) {
  const wahl = P.ovGueltig(PL.uebernachtung) ? PL.uebernachtung : null;
  const tage = wahl ? wahl.split("-").map(Number) : [0, 1, 2, 3];
  const fx = Object.entries(TERMINE()).map(([id, f]) => ({ c: byId(id), f, di: Math.round((parseISO(f.date) - parseISO(PL.week)) / 864e5) }))
    .filter(x => x.c && tage.includes(x.di) && !(x.c.dHome > S().overnightKm * 0.7));
  const label = wahl ? "Übernachtung " + P.UEBERNACHTUNG.find(u => u[0] === wahl)[1] : "Übernachtung";
  if (wahl && fx.length) return `${label} geht nicht: Termin bei ${fx.map(x => x.c.n1 + " (" + WDS[x.di] + " " + x.f.time + ")").join(", ")} liegt nicht im Übernachtungsgebiet. Bitte andere Tage wählen und neu planen.`;
  if (!wahl && fx.length >= 2) return "An allen möglichen Übernachtungstagen liegen Termine in der Nähe von Bremen.";
  return `Kein passendes Gebiet über ${S().overnightKm} km mit fälligen Kunden gefunden.`;
}
// Auswahl, wann in der geplanten Woche übernachtet wird
// Kein Standard: bei einer neuen Woche steht „bitte wählen“, die Nacht wird jede Woche selbst gewählt
const ovAuswahl = wert => `<label>Übernachtung <select id="ovwahl" required><option value="" ${P.ovGueltig(wert) ? "" : "selected"}>– bitte wählen –</option>${P.UEBERNACHTUNG.map(([v, l]) => `<option value="${v}" ${v === wert ? "selected" : ""}>${l}</option>`).join("")}</select></label>`;
/* ---------- Tag abschließen ---------- */
const besucht = (id, datum) => { const k = roh(id); return !!(k && k.lv && k.lv >= datum); };
// Besuche vergangener Tage, die weder als besucht erfasst noch abgeschlossen sind
const offeneBesuche = p => p.days.filter(D => D.type !== "home" && D.date < today() && !D.abgeschlossen)
  .flatMap(D => D.stops.filter(id => roh(id) && !besucht(id, D.date)).map(id => ({ D, id })));
function offeneHinweis() {
  const tage = PLAENE().flatMap(p => p.days.filter(D => D.type !== "home" && D.date < today() && !D.abgeschlossen)
    .map(D => ({ p, D, n: D.stops.filter(id => roh(id) && !besucht(id, D.date)).length })).filter(x => x.n));
  if (!tage.length) return "";
  return `<aside class="offen"><b>Noch nicht abgeschlossen:</b> ${tage.map(x => `<button class="link" data-a="tagab" data-week="${x.p.week}" data-d="${x.p.days.indexOf(x.D)}">${WDS[x.D.day]} ${fmtD(x.D.date).slice(0, 6)} (${x.n} ${x.n === 1 ? "Besuch" : "Besuche"})</button>`).join(" · ")}
   <span class="muted">– nicht erfasste Besuche plant die App sonst erneut ein.</span></aside>`;
}
function tagAbschliessenDialog(week, di) {
  const p = planVon(week), D = p && p.days[di]; if (!D) return;
  const L = D.stops.filter(id => roh(id));
  dlg(`<header class="dh"><h3>${WD[D.day]}, ${fmtD(D.date)} abschließen</h3><button value="x" class="ghost">Abbrechen</button></header>
   <p class="muted">Haken = besucht („Letzter Besuch“ wird auf diesen Tag gesetzt). Ohne Haken = nicht angetroffen – der Kunde wird bei der nächsten Planung wieder berücksichtigt.</p>
   <div class="tagliste">${L.map(id => { const k = roh(id), schon = besucht(id, D.date);
     return `<label class="chk"><input type="checkbox" data-tagab="${esc(id)}" ${schon ? "checked disabled" : "checked"}> ${esc(k.n1)} <small class="muted">${esc(k.ort)}${schon ? " · schon erfasst" : ""}</small></label>`; }).join("")}</div>
   <div class="row"><button class="pri" value="tagabspeichern" data-week="${week}" data-d="${di}">Tag abschließen</button></div>`);
}
function tagAbschliessen(week, di) {
  const p = planVon(week), D = p && p.days[di]; if (!D) return;
  let n = 0, nicht = 0;
  document.querySelectorAll("#dlg input[data-tagab]").forEach(el => {
    if (el.disabled) return; const k = roh(el.dataset.tagab); if (!k) return;
    if (el.checked) { if (!k.lv || k.lv < D.date) k.lv = D.date; n++; } else nicht++;
  });
  D.abgeschlossen = true; geaendert();
  toast(`${WD[D.day]} abgeschlossen: ${n} besucht${nicht ? ", " + nicht + " nicht angetroffen" : ""}`);
}
// Nur die Reihenfolge eines Tages verbessern (dieselben Kunden, schnellste Reihenfolge)
function reihenfolgeVerbessern(di) {
  const D = PLAN() && PLAN().days[di]; if (!D) return;
  aufbereiten();
  const dauer = s => (D.type === "ov1" ? s.legs[s.legs.length - 1].leave : s.end) - s.depart;
  const vorher = P.simDay(D), besser = P.feinschliff(D), nachher = P.simDay(D);
  if (!besser) { toast("Die Reihenfolge ist schon die schnellste"); return; }
  geaendert();
  const fz = s => s.legs.reduce((a, L) => a + L.min, 0) + s.backMin;
  toast(`Reihenfolge verbessert: Arbeitstag ${Math.round(dauer(vorher) - dauer(nachher))} Min. kürzer, ${Math.round(fz(vorher) - fz(nachher))} Min. weniger Fahrzeit`);
}
// Reiter mit allen geplanten Wochen (vergangene Wochen mit offenen Besuchen bekommen einen Hinweis)
function wochenReiter() {
  const L = kommende(); if (L.length < 2) return "";
  return `<nav class="wtabs" aria-label="Geplante Wochen">${L.map(p => { const n = offeneBesuche(p).length;
    return `<button data-a="wzeigen" data-week="${p.week}" aria-current="${p === PLAN() ? "page" : "false"}">KW ${kw(p.week)}<small>ab ${fmtD(p.week).slice(0, 6)}${n ? ` · <span class="warn">${n} offen</span>` : ""}</small></button>`; }).join("")}</nav>`;
}
function renderPlan() {
  const PL = PLAN();
  const ws = PL ? PL.week : iso(P.weekStart());
  if (!P.startBekannt()) return `<section class="empty"><h2>Startadresse fehlt</h2><p>Bitte unter <b>Einstellungen › Tagesablauf</b> Ihre Startadresse (zu Hause) mit PLZ eintragen.</p></section>`;
  if (!PL) return `<section class="empty"><h2>Noch keine Woche geplant</h2><p>Der Planer sucht fällige Kunden heraus, bündelt sie zu Tagestouren und plant eine Übernachtungstour für Gebiete über ${S().overnightKm} km. Freitag bleibt Home-Office.</p>
    <div class="row"><label>Woche ab <input type="date" id="wk" value="${ws}"></label>${ovAuswahl("")}<button class="pri" data-a="plan">Woche planen</button></div></section>`;
  const alt = P.alternativen(PL);
  const legs = PL.days.filter(D => D.type !== "home").flatMap(D => P.simDay(D).legs);
  const nGesch = legs.filter(L => L.geschaetzt).length;
  const fzText = !legs.length ? "" : nGesch === 0 ? `Echte Fahrzeiten (OpenRouteService${+S().zuschlag ? ", +" + S().zuschlag + " % Zuschlag" : ""})`
    : nGesch === legs.length ? "Entfernungen und Fahrzeiten sind noch Schätzungen" : "Fahrzeiten teilweise geschätzt (≈)";
  let html = `${wochenReiter()}<div class="planhead"><div><h2>KW ${kw(PL.week)} · Woche ab ${fmtD(PL.week)}</h2><p class="muted">Tourvorschlag · ${fzText}${P.LV_NUTZEN() ? "" : " · ohne „Letzter Besuch“ (Einstellungen)"}${+S().ersterMaxKm > 0 ? " · erster Besuch höchstens " + S().ersterMaxKm + " km" : ""}</p></div>
   <div class="row"><label>Woche ab <input type="date" id="wk" value="${PL.week}"></label>${ovAuswahl(PL.uebernachtung)}<button class="pri" data-a="plan">Neu planen</button>${PL.week >= ab() && kommende().length < MAX_WOCHEN && !planVon(iso(addDays(parseISO(PL.week), 7))) ? `<button data-a="plannext">Nächste Woche planen</button>` : ""}<button class="ghost" data-a="wloeschen">Woche löschen</button></div></div>
   ${offeneHinweis()}<section class="overview"><figure class="map"><svg id="map" role="img" aria-label="Tourskizze Norddeutschland"></svg><figcaption id="legend"></figcaption></figure>${weekSummary()}</section><div class="days">`;
  PL.days.forEach((D, di) => {
    const date = fmtD(D.date);
    if (D.type === "home") { html += `<article class="day home"><header><h3>${WD[D.day]}</h3><span class="muted">${date}</span></header><p>Home-Office. Zeit für Angebote, Muster und die Ausschreibungsrecherche.</p>${homeTermine(D.date)}${openTasksHTML()}</article>`; return; }
    const sim = P.simDay(D);
    const nFix = D.stops.filter(id => P.istFix(id, D.day)).length;
    const label = D.type === "ov1" ? "Übernachtungstour · Tag 1" : D.type === "ov2" ? "Übernachtungstour · Tag 2" : "Tagestour";
    html += `<article class="day ${D.type}" style="--dc:var(--d${di})"><header><h3>${WD[D.day]}</h3><span class="muted">${date}</span><span class="kind">${label}</span></header>`;
    if (!D.stops.length) { html += `<p class="muted">Keine passenden Kunden gefunden.</p></article>`; return; }
    const startName = D.type === "ov2" ? "Hotel in " + esc(D.hotel.ort) : "Bremen";
    html += `<ol class="stops"><li class="node">${hhmm(sim.depart)} Abfahrt ${startName}</li>`;
    sim.legs.forEach((L, i) => { const nr = i + 1;
      const c = byId(L.id); const done = c.lv && c.lv >= D.date;
      const a = alt[c.id], ac = a && byId(a.id);
      html += `<li class="leg"><span class="drv">${L.geschaetzt && nGesch < legs.length ? "≈ " : ""}${Math.round(L.km)} km · ${Math.round(L.min)} Min.</span></li>
       <li class="stop${done ? " done" : ""}${L.fixed ? " isfix" : ""}"><div class="t"><span class="nr" style="background:var(--dc)">${nr}</span>${hhmm(L.begin)}${L.fixed ? `<span class="fixb">fix</span>` : ""}</div><div class="who"><button class="link" data-a="open" data-id="${c.id}">${esc(c.n1)}</button> ${abcTag(c)}
       <div class="sub">${esc(c.plz)} ${esc(c.ort)} · ${kdKurz(c)} · ${navLink(c, "Navi")}${c.tel ? " · " + telLink(c.tel) : ""}${c.mob ? " · Mobil " + telLink(c.mob) : ""} · ${L.dur} Min. · ${dueText(c)}${!c.oh ? " · Öffnungszeiten unbekannt" : c.ohp.known ? "" : " · Öffnungszeiten nicht lesbar"}</div>${L.warn ? `<div class="warn">${esc(L.warn)}</div>` : ""}${L.fixed ? kalHinweis(c.id) : ""}</div>
       <div class="acts">${done ? `<span class="ok">besucht</span>` : D.abgeschlossen ? `<span class="warn">nicht angetroffen</span>` : `${L.fixed ? `<button data-a="unfix" data-d="${di}" data-id="${c.id}">Fix lösen</button>` : `<button class="fixbtn" data-a="fix" data-d="${di}" data-id="${c.id}" data-time="${hhmm(L.begin)}">Termin fix</button>`}<button data-a="visit" data-id="${c.id}">Besuch erfassen</button>`}<button class="ghost" data-a="rm" data-d="${di}" data-id="${c.id}" aria-label="${esc(c.n1)} aus der Tour nehmen">Entfernen</button></div>
       ${done ? "" : ac ? `<div class="alt"><span>Falls keine Zeit: <b>${esc(ac.n1)}</b> · ${esc(ac.ort)}, ${a.km < 1 ? "gleicher Ort" : Math.round(a.km) + " km entfernt"}${ac.tel ? " · " + telLink(ac.tel) : ""}${a.weit ? " · " + (P.MERKMAL() ? "kein " + esc(P.MERKMAL()) : "wenig Umsatz") : ""}</span><button data-a="alt" data-d="${di}" data-id="${c.id}" data-alt="${ac.id}">Alternative nehmen</button></div>`
        : `<div class="alt">Keine Alternative in der Nähe gefunden</div>`}</li>`;
    });
    if (D.type === "ov1") {
      html += `<li class="node">ca. ${hhmm(sim.end)} Ende · Übernachtung in ${esc(D.hotel.ort)}</li></ol>
      <div class="hotel"><strong>Hotel in ${esc(D.hotel.ort)}</strong><span>bis ${S().hotelMax} € mit Frühstück${S().parking ? ", mit Parkplatz" : ""}</span><a href="${bookingUrl(D.hotel, D.date)}" target="_blank" rel="noopener">Passende Hotels bei Booking.com</a></div>`;
    }
    else html += `<li class="leg"><span class="drv">${Math.round(sim.backKm)} km · ${Math.round(sim.backMin)} Min.</span></li><li class="node">ca. ${hhmm(sim.end)} zurück in Bremen</li></ol>`;
    const lim = P.dayEnds(D).limit; const over = lim != null && sim.end > lim;
    html += `<footer><span>${Math.round(sim.km)} km · ${D.stops.length} Besuche · ${nFix} fix</span>${over ? `<span class="warn">später als ${hhmm(lim)} zurück</span>` : ""}${D.date <= today() && D.stops.some(id => !besucht(id, D.date)) && !D.abgeschlossen ? `<button class="pri" data-a="tagab" data-week="${PL.week}" data-d="${di}">Tag abschließen</button>` : ""}${D.date >= today() && D.stops.length >= 3 ? `<button class="ghost" data-a="feinschliff" data-d="${di}">Reihenfolge verbessern</button>` : ""}<a href="${gmaps(D)}" target="_blank" rel="noopener">Route in Google Maps</a></footer></article>`;
  });
  return html + `</div>`;
}
// Ausnahme: Termine, die ein Kunde ausdrücklich am Freitag haben möchte
function homeTermine(datum) {
  const L = Object.entries(TERMINE()).filter(([id, f]) => f.date === datum && byId(id)).sort((a, b) => a[1].time.localeCompare(b[1].time));
  if (!L.length) return "";
  return `<p class="warn">Ausnahme – Termin am Home-Office-Tag:</p><ul class="wnotes">` + L.map(([id, f]) => { const c = byId(id);
    return `<li>${f.time} Uhr · <button class="link" data-a="open" data-id="${c.id}">${esc(c.n1)}</button> · ${esc(c.ort)}${kalHinweis(id)}</li>`; }).join("") + `</ul>`;
}
function kalHinweis(id) {
  const f = TERMINE()[id]; if (!f || !S().calSync || !G.konfiguriert()) return "";
  if (f.cal === "ok") return `<div class="cal ok">Im Google Kalender eingetragen</div>`;
  return `<div class="cal">${driveBereit() ? "Wird in den Google Kalender eingetragen …" : "Wird in den Kalender eingetragen, sobald Google verbunden ist"}</div>`;
}
function weekSummary() {
  const PL = PLAN(); let kmT = 0, vis = 0;
  PL.days.forEach(D => { if (D.type === "home" || !D.stops.length) return; const s = P.simDay(D); kmT += s.km; vis += D.stops.length; });
  const hotel = PL.days.find(D => D.type === "ov1"); const nFixAll = PL.days.reduce((a, D) => a + D.stops.filter(id => P.istFix(id, D.day)).length, 0);
  return `<aside class="summary"><div><b>${vis}</b><span>Besuche geplant, davon ${nFixAll} fest bestätigt</span></div><div><b>${Math.round(kmT).toLocaleString("de-DE")} km</b><span>geschätzte Fahrstrecke</span></div>
   <div><b>${hotel && hotel.hotel ? esc(hotel.hotel.ort) : "–"}</b><span>${hotel ? "Übernachtung " + WD[hotel.day] : "keine Übernachtung möglich"}</span>${hotel ? "" : `<span class="warn">${esc(ovGrund(PL))}</span>`}</div>
   <div><b>${eur(PL.days.reduce((a, D) => a + D.stops.reduce((x, id) => x + ((byId(id) || {}).uPlan || 0), 0), 0))}</b><span>Umsatz ${S().umsatzJahr} der geplanten Kunden</span></div>
   <p class="muted">Freitag: Home-Office</p></aside>`;
}
function openTasksHTML() {
  const mon = PLAN() ? PLAN().week : iso(P.weekStart()); const notes = [];
  for (const c of P.CUST) for (const n of c.notes) if (n.d >= mon) notes.push({ c, n });
  if (!notes.length) return `<p class="muted">Notizen dieser Woche erscheinen hier gesammelt.</p>`;
  return `<h4>Notizen dieser Woche</h4><ul class="wnotes">` + notes.map(x => `<li><strong>${esc(x.c.n1)}</strong>: ${esc(x.n.t)}</li>`).join("") + `</ul>`;
}

/* ---------- Skizze ---------- */
const hl = c => c.abc === "A";
function drawMap() {
  const svg = $("#map"); const PL = PLAN(); if (!svg || !PL) return;
  const pts = P.CUST.filter(c => !c.out && c.lat != null);
  const la = pts.map(c => c.lat), ln = pts.map(c => c.lng);
  const minLa = Math.min(...la, HOME.lat) - 0.15, maxLa = Math.max(...la) + 0.15, minLn = Math.min(...ln) - 0.2, maxLn = Math.max(...ln) + 0.2;
  const k = Math.cos(53.5 * Math.PI / 180); const H = 460, W = Math.round(H * ((maxLn - minLn) * k) / (maxLa - minLa)) + 20; svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const sx = (W - 20) / ((maxLn - minLn) * k), sy = (H - 20) / (maxLa - minLa), sc = Math.min(sx, sy);
  const ox = (W - (maxLn - minLn) * k * sc) / 2, oy = (H - (maxLa - minLa) * sc) / 2;
  const Pt = p => [ox + (p.lng - minLn) * k * sc, oy + (maxLa - p.lat) * sc];
  let g = "";
  const [hx, hy] = Pt(HOME); const r = (S().overnightKm / S().roadFactor) / 111 * sc;
  g += `<circle cx="${hx}" cy="${hy}" r="${r}" class="ring"/><text x="${hx}" y="${hy - r - 4}" class="ringl">${S().overnightKm} km Fahrstrecke</text>`;
  for (const c of pts) { const [x, y] = Pt(c); g += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${hl(c) ? 2.4 : 1.6}" class="pt${hl(c) ? " due" : ""}"/>`; }
  let leg = "";
  PL.days.forEach((D, di) => {
    if (!D.stops.length) return; const e = P.dayEnds(D); const seq = [e.start].concat(D.stops.map(byId).filter(Boolean)); if (e.end) seq.push(e.end);
    g += `<polyline points="${seq.map(p => Pt(p).map(v => v.toFixed(1)).join(",")).join(" ")}" class="route" style="stroke:var(--d${di})"/>`;
    D.stops.forEach((id, i) => { const c = byId(id); if (!c) return; const [x, y] = Pt(c); g += `<circle cx="${x}" cy="${y}" r="6.5" class="stopdot" style="fill:var(--d${di})"/><text x="${x}" y="${y}" class="stopnr">${i + 1}</text>`; });
    if (D.type === "ov1" && D.hotel) { const [x, y] = Pt(D.hotel); g += `<rect x="${x - 5}" y="${y - 5}" width="10" height="10" class="hotelmk"/>`; }
    leg += `<span><i style="background:var(--d${di})"></i>${WDS[D.day]}</span>`;
  });
  const cities = [["Hamburg", 53.55, 10.0], ["Kiel", 54.32, 10.13], ["Oldenburg", 53.14, 8.21], ["Osnabrück", 52.28, 8.05], ["Hannover", 52.37, 9.73], ["Emden", 53.37, 7.21], ["Lübeck", 53.87, 10.69], ["Flensburg", 54.78, 9.43], ["Cuxhaven", 53.86, 8.69]];
  for (const [n, a, b] of cities) { const [x, y] = Pt({ lat: a, lng: b }); g += `<text x="${x + 5}" y="${y - 5}" class="city">${n}</text>`; }
  g += `<circle cx="${hx}" cy="${hy}" r="6" class="home"/><text x="${hx + 8}" y="${hy + 4}" class="homel">Bremen</text>`;
  svg.innerHTML = g;
  $("#legend").innerHTML = leg + `<span><i class="dueI"></i>A-Kunde</span><span><i class="hotI"></i>Hotel</span>`;
}

/* ---------- Eigene Spalten der Kundenliste ---------- */
// Spaltenarten: { "Deko Kunde": "jn" } – "jn" = Häkchen (in Excel "ja" oder leer), sonst Text
const istJa = v => v === true || /^(ja|x|1|wahr|true)$/i.test(String(v ?? "").trim());
const eigene = () => eigeneSpalten(DATA.spalten);
const istHaekchen = s => (DATA.spaltenArten || {})[s] === "jn";
const haekchenSpalten = () => eigene().filter(istHaekchen);
const merkmaleKurz = c => haekchenSpalten().filter(s => istJa((c.extra || {})[s])).map(s => ` · <b class="termin">${esc(s)}</b>`).join("");
function spalteHinzufuegen() {
  const name = ($("#spname").value || "").trim().replace(/\s+/g, " "), art = $("#spart").value;
  if (!name) { toast("Bitte einen Namen für die Spalte eingeben"); return; }
  const spalten = DATA.spalten && DATA.spalten.length ? DATA.spalten : STANDARD_REIHENFOLGE.slice();
  if (spalten.some(s => s.toLowerCase() === name.toLowerCase()) || spalteBekannt(name)) { toast("Die Spalte „" + name + "“ gibt es schon"); return; }
  if (umsatzJahr(name)) {
    // Umsatz-Spalte: vor die bisherigen Umsatz-Spalten (neuestes Jahr zuerst)
    const i = spalten.findIndex(s => umsatzJahr(s)); if (i >= 0) spalten.splice(i, 0, name); else spalten.push(name);
  } else {
    spalten.push(name);
    if (art === "jn") DATA.spaltenArten = { ...(DATA.spaltenArten || {}), [name]: "jn" };
  }
  DATA.spalten = spalten; persist(); render();
  toast("Spalte „" + name + "“ angelegt – sie wird mit der nächsten Speicherung in die Excel-Datei übernommen");
}

/* ---------- Kundenliste ---------- */
// Kommender Termin eines Kunden (vergangene werden nicht angezeigt)
const kommenderTermin = id => { const f = TERMINE()[id]; return f && f.date >= today() ? f : null; };
const terminText = f => `${WD[wochentag(f.date)]}, ${fmtD(f.date)}, ${f.time} Uhr`;
const terminKurz = id => { const f = kommenderTermin(id); return f ? ` · <b class="termin">Termin ${WDS[wochentag(f.date)]} ${fmtD(f.date)} ${f.time}</b>` : ""; };
function renderList() {
  let L = P.CUST.slice();
  const q = FILTER.q.toLowerCase();
  if (q) L = L.filter(c => (c.n1 + " " + c.n2 + " " + c.ort + " " + c.plz + " " + c.id).toLowerCase().includes(q));
  if (FILTER.abc) L = L.filter(c => c.abc === FILTER.abc);
  if (FILTER.merkmal) L = L.filter(c => istJa((c.extra || {})[FILTER.merkmal]));
  if (FILTER.due) L = L.filter(P.el);
  if (FILTER.ohneOh) L = L.filter(c => !c.oh || !c.ohp.known);
  if (FILTER.trend) L = L.filter(ruecklaeufig);
  if (FILTER.trend) L.sort((a, b) => (b.trendAlt - b.trendHoch) - (a.trendAlt - a.trendHoch)); // größter Verlust in Euro zuerst
  else L.sort((a, b) => b.urg - a.urg);
  return `<div class="listhead"><div><h2>Kunden</h2><p class="muted">${P.CUST.length} aktiv · ${P.MERKMAL() ? "Planung: nur " + esc(P.MERKMAL()) + " · " : ""}${P.LAENGST() ? "am längsten nicht besuchte zuerst" : "sortiert nach Umsatz " + S().umsatzJahr}</p></div>
   <div class="row"><button class="pri" data-a="new">Kunde hinzufügen</button><button data-a="export">Als Excel sichern</button></div></div>
   <div class="filters"><input type="search" id="q" placeholder="Name, Ort oder PLZ suchen" value="${esc(FILTER.q)}" aria-label="Kunden suchen">
   <select id="fabc" aria-label="Priorität"><option value="">Alle Prioritäten</option>${["A", "B", "C"].map(x => `<option ${FILTER.abc === x ? "selected" : ""}>${x}</option>`).join("")}</select>
   ${haekchenSpalten().length ? `<select id="fmerkmal" aria-label="Merkmal"><option value="">Alle Kunden</option>${haekchenSpalten().map(s => `<option value="${esc(s)}" ${FILTER.merkmal === s ? "selected" : ""}>nur ${esc(s)}</option>`).join("")}</select>` : ""}
   <label class="chk"><input type="checkbox" id="fdue" ${FILTER.due ? "checked" : ""}> nur planbare</label>
   <label class="chk"><input type="checkbox" id="foh" ${FILTER.ohneOh ? "checked" : ""}> ohne Öffnungszeiten (${P.CUST.filter(c => !c.oh || !c.ohp.known).length})</label>
   ${P.trendInfo() && !P.trendInfo().zuFrueh ? `<label class="chk"><input type="checkbox" id="ftrend" ${FILTER.trend ? "checked" : ""}> Umsatz rückläufig (${P.CUST.filter(ruecklaeufig).length})</label>` : ""}</div>
   <ul class="clist">${L.slice(0, 200).map(c => `<li><button class="crow" data-a="open" data-id="${c.id}">${abcTag(c)}<span class="cn">${esc(c.n1)}<small>${esc(c.plz)} ${esc(c.ort)} · ${kdKurz(c)}${merkmaleKurz(c)}${c.out && P.startBekannt() ? " · außerhalb des Gebiets, wird nicht eingeplant" : ""}${c.planHold ? " · aus der Planung genommen" : ""}${c.isNew ? " · neu angelegt" : ""}${terminKurz(c.id)}</small></span>
   <span class="cd">${dueText(c)}</span></button></li>`).join("")}</ul>${L.length > 200 ? `<p class="muted">${L.length - 200} weitere – bitte Suche nutzen.</p>` : ""}`;
}

/* ---------- Auswertung der geschäftlichen Notizen (private Notizen nie) ---------- */
function auswertungDaten() {
  const zr = A.zeitraum(AUSW.zr, AUSW.von, AUSW.bis);
  return { zr, L: A.notizen(DATA.kunden, zr, AUSW.q) };
}
function renderAuswertung() {
  const { zr, L } = auswertungDaten(), gruppen = A.nachKunde(L);
  const zahl = a => L.filter(n => n.art === a).length;
  const worte = A.stichworte(L);
  return `<div class="listhead"><div><h2>Auswertung der Notizen</h2><p class="muted">Nur geschäftliche Notizen, über alle Kunden. Private Notizen werden nicht ausgewertet.</p></div>
   <div class="row"><button data-a="auswexport" ${L.length ? "" : "disabled"}>Als Excel speichern</button></div></div>
   <div class="filters ausw"><label>Zeitraum<select id="azr">${A.ZEITRAEUME.map(([v, l]) => `<option value="${v}" ${AUSW.zr === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
   ${AUSW.zr === "frei" ? `<label>von<input type="date" id="avon" value="${esc(AUSW.von)}"></label><label>bis<input type="date" id="abis" value="${esc(AUSW.bis || today())}"></label>` : ""}
   <label>Suchen (Wort, Kunde oder Ort)<input type="search" id="aq" value="${esc(AUSW.q)}" placeholder="z. B. Muster, Angebot, Kollektion"></label></div>
   <p class="muted">${zr.von ? fmtD(zr.von) : "Anfang"} bis ${fmtD(zr.bis)}</p>
   <div class="kacheln"><div><b>${zahl("Besuchsnotiz")}</b><span>Besuchsnotizen</span></div><div><b>${gruppen.length}</b><span>Kunden mit Notizen</span></div>
   <div><b>${zahl("Bestellformular")}</b><span>Bestellformulare</span></div><div><b>${zahl("Beanstandung")}</b><span>Beanstandungen</span></div></div>
   ${worte.length ? `<h4>Häufige Stichworte</h4><div class="worte">${worte.map(([w, n]) => `<button data-a="awort" data-w="${esc(w)}" class="${AUSW.q.toLowerCase() === w ? "an" : ""}">${esc(w)} <small>${n}</small></button>`).join("")}</div>` : ""}
   ${L.length ? gruppen.map(([k, N]) => `<section class="ausk"><h4><button class="link" data-a="open" data-id="${esc(k.id)}">${esc(k.n1)}</button> <span class="muted">${esc(k.plz)} ${esc(k.ort)} · ${N.length} ${N.length === 1 ? "Notiz" : "Notizen"}</span></h4>
     <ul class="notes">${N.map(n => `<li><time>${fmtD(n.d)}${n.art !== "Besuchsnotiz" ? " · " + n.art : ""}</time>${esc(n.t)}</li>`).join("")}</ul></section>`).join("")
    : `<p class="muted">Keine Notizen in diesem Zeitraum${AUSW.q ? " zu „" + esc(AUSW.q) + "“" : ""}.</p>`}`;
}
function auswertungExport() {
  const { zr, L } = auswertungDaten();
  const rows = L.map(n => ({ "Datum": fmtD(n.d), "Kd Nr.": vorlaeufig(n.k.id) ? "" : n.k.id, "Kunde": n.k.n1, "PLZ": n.k.plz, "Ort": n.k.ort, "Art": n.art, "Notiz": n.t }));
  const wb = XLSX.utils.book_new(), ws = XLSX.utils.json_to_sheet(rows, { header: ["Datum", "Kd Nr.", "Kunde", "PLZ", "Ort", "Art", "Notiz"] });
  ws["!cols"] = [{ wch: 11 }, { wch: 9 }, { wch: 32 }, { wch: 7 }, { wch: 18 }, { wch: 15 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(wb, ws, "Notizen");
  const name = `Notizen_Auswertung_${zr.von || "Anfang"}_bis_${zr.bis}.xlsx`;
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([XLSX.write(wb, { type: "array", bookType: "xlsx" })], { type: XLSX_TYP }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  toast("Excel-Datei erstellt: " + name);
}

/* ---------- Einstellungen ---------- */
function renderSettings() {
  const s = S();
  const f = (k, l, t = "number", extra = "") => `<label>${l}<input type="${t}" data-s="${k}" value="${esc(s[k])}" ${extra}></label>`;
  return `<h2>Einstellungen</h2><p class="muted">Änderungen gelten ab der nächsten Planung.</p>
  <div class="sets"><fieldset><legend>Planungsgrundlage</legend>
   <label>Kunden auswählen nach<select data-s="grundlage">${grundlagen().map(([v, l]) => `<option value="${esc(v)}" ${s.grundlage === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
   <label>Umsatz-Jahr für die Planung<select data-s="umsatzJahr" data-zahl="1">${umsatzAuswahl()}</select></label>
   ${P.trendInfo() ? `<label>Umsätze ${P.trendInfo().jahr} gelten bis (Stand der Liste, leer = heute)<input type="date" data-s="umsatzStand" value="${esc(s.umsatzStand || "")}"></label>
   <p class="muted">Damit wird ${P.trendInfo().jahr} für den Vergleich mit ${P.trendInfo().vorjahr} aufs ganze Jahr hochgerechnet. „Kundenliste abgleichen“ trägt das Datum aus dem Dateinamen selbst ein.</p>
   <label class="chk"><input type="checkbox" data-s="trendBevorzugen" ${s.trendBevorzugen ? "checked" : ""}> Kunden mit rückläufigem Umsatz (ab −20 %) bevorzugt einplanen</label>` : ""}
   <label class="chk"><input type="checkbox" data-s="lvNutzen" ${P.LV_NUTZEN() ? "checked" : ""}> „Letzter Besuch“ bei der Planung berücksichtigen</label>
   ${P.LV_NUTZEN() ? f("abstandWochen", "Mindestabstand zwischen zwei Besuchen (Wochen)") : `<p class="warn">Ohne Häkchen plant die App so, als wäre noch kein Kunde besucht worden: kein Mindestabstand${P.LAENGST() ? ", und „am längsten nicht besucht“ sortiert nur nach Umsatz" : ""}. Die Daten in der Spalte bleiben erhalten. Danach „Neu planen“.</p>`}
   <p class="muted">${P.MERKMAL() ? `Es werden nur Kunden mit Häkchen bei „${esc(P.MERKMAL())}“ eingeplant (${DATA.kunden.filter(k => !k.inactive && P.hatMerkmal(k)).length} Kunden), die umsatzstärksten zuerst. Fehlt in der Nähe ein Alternativ-Kunde mit Häkchen, wird ein anderer Kunde vorgeschlagen.` : P.LAENGST() ? "Kunden, deren letzter Besuch am längsten zurückliegt, werden zuerst eingeplant (noch nie besuchte ganz vorn), auch Kunden ohne Umsatz." : "Die umsatzstärksten Kunden werden zuerst eingeplant, nur Kunden mit Umsatz im gewählten Jahr."}${P.LV_NUTZEN() ? " Wer innerhalb des Mindestabstands besucht wurde, wird übersprungen." : ""}</p></fieldset>
  <fieldset><legend>Woche und Übernachtung</legend>
   ${f("overnightKm", "Übernachtung ab Fahrstrecke (km)")}
   ${f("hotelMax", "Hotelbudget pro Nacht inkl. Frühstück (€)")}
   <label class="chk"><input type="checkbox" data-s="parking" ${s.parking ? "checked" : ""}> Hotel mit Parkplatz</label>
   <p class="muted">Höchstens eine Übernachtung pro Woche. Die Nacht wählen Sie im Wochenplan bei „Übernachtung“ für jede Woche selbst (Mo→Di, Di→Mi oder Mi→Do). Freitag ist immer Home-Office.</p></fieldset>
  <fieldset><legend>Tagesablauf</legend>
   <label>Startadresse (zu Hause)<input type="text" data-s="start" value="${esc(s.start || "")}" placeholder="Straße Nr., PLZ Ort"></label>
   ${P.startBekannt() ? "" : `<p class="warn">Bitte Startadresse mit PLZ eintragen – ohne sie kann nicht geplant werden.</p>`}
   ${f("depart", "Abfahrt", "time")}${f("latest", "Späteste Rückkehr Tagestour", "time")}${f("latestOv", "Späteste Rückkehr Übernachtungstour (Tag 2)", "time")}
   ${f("lastVisitDay1", "Letzter Besuchsbeginn vor Hotelnacht", "time")}${f("hotelStart", "Abfahrt vom Hotel", "time")}
   ${f("ersterMaxKm", "Erster Besuch höchstens … km von zu Hause (0 = aus)", "number", 'min="0" step="5"')}${f("maxVisits", "Höchstens Besuche pro Tag")}${f("visitMin", "Dauer pro Besuch (Min.)")}<p class="muted">Eigene Dauer je Kunde: Kunden › Kunde öffnen › Bearbeiten.</p></fieldset>
  <fieldset><legend>Echte Fahrzeiten (OpenRouteService)</legend>
   <label>Persönlicher Schlüssel (kostenlos von openrouteservice.org)<input type="password" data-s="orsKey" value="${esc(s.orsKey || "")}" autocomplete="off" spellcheck="false"></label>
   ${f("zuschlag", "Zuschlag auf die Fahrzeit für Verkehr (%)")}
   <p class="muted">${fzStatusText()}</p>
   <button data-a="fzrechnen" ${FZ_LAEUFT || !s.orsKey ? "disabled" : ""}>Fehlende Fahrzeiten jetzt berechnen</button>
   <p class="muted">Gesendet werden nur Koordinaten (Mitte der PLZ), keine Namen. Gratis-Tarif: die App macht höchstens ${F.GRENZE_TAG} Anfragen pro Tag (heute: ${F.zaehlerLesen()}), danach geht es am nächsten Tag weiter – es entstehen keine Kosten.</p></fieldset>
  <fieldset><legend>Schätzung (wenn keine echte Fahrzeit da ist)</legend>
   ${f("roadFactor", "Umwegfaktor zur Luftlinie", "number", 'step="0.05"')}${f("speed", "Durchschnittstempo (km/h)")}</fieldset>
  <fieldset><legend>Google (Drive und Kalender)</legend>
   ${!G.konfiguriert() ? `<p class="muted">Die Google-Verbindung ist noch nicht eingerichtet.</p>`
    : G.angemeldet() ? `<p>Verbunden${G.email() ? " als " + esc(G.email()) : ""}.</p><p class="muted">Ihr Stand liegt in Google Drive im Ordner „${G.ORDNER}“ als „${G.STAND_DATEI}“. Auf dem Rechner finden Sie ihn über „Google Drive für Desktop“ und können ihn dort mit Excel öffnen.</p><button data-a="gtrennen">Verbindung trennen</button>`
    : `<p class="muted">Nicht verbunden. Änderungen bleiben auf diesem Gerät, bis Sie sich verbinden.</p><button class="pri" data-a="gverbinden">Mit Google verbinden</button>`}
   <label class="chk"><input type="checkbox" data-s="calSync" ${s.calSync ? "checked" : ""}> Feste Termine automatisch in den Google Kalender eintragen</label>
   <p class="muted">Ohne Einladungen. „Fix lösen“, „Entfernen“ oder „Alternative nehmen“ löscht den Eintrag wieder.</p></fieldset>
  <fieldset><legend>Bestell- und Beanstandungsformulare</legend>
   <p class="muted">Vorlagen auf diesem Gerät: ${VORLAGE_ARTEN.map(a => esc(VORL[a].titel) + (VORLAGEN[a] ? " ✓" : " – fehlt")).join(", ")}.</p>
   <label>Vorlagen auswählen (PDF-Bestellformulare und Beanstandungsformular als Word-Datei, auch alle auf einmal)<input type="file" id="vorlagenfile" accept="${VORLAGE_ACCEPT}" multiple></label>
   <p class="muted">Die App erkennt selbst, welches Formular es ist. Die Vorlagen bleiben auf diesem Gerät${G.konfiguriert() ? " und werden in Google Drive › " + G.ORDNER + " gespeichert, damit das andere Gerät sie auch hat" : ""}. ${ORDNER ? " Am Rechner werden PDFs im Ordner „Vorlagen“ (im Tourenplaner-Ordner) automatisch übernommen." : ""} Ausfüllen: Kunde öffnen › „Bestellformular“ bzw. „Beanstandung“.</p></fieldset>
  <fieldset><legend>Eigene Spalten der Kundenliste</legend>
   <p class="muted">${eigene().length ? "Vorhanden: " + eigene().map(s => esc(s) + (istHaekchen(s) ? " (Häkchen)" : " (Text)")).join(", ") + "." : "Noch keine eigenen Spalten."} Eigene Spalten können Sie beim Kunden unter „Bearbeiten“ ausfüllen.</p>
   <label>Neue Spalte<input id="spname" placeholder="z. B. Objektkunde oder Umsatz 26" autocomplete="off"></label>
   <label>Art<select id="spart"><option value="jn">Häkchen (ja/nein)</option><option value="text">Text</option></select></label>
   <button data-a="spalteneu">Spalte hinzufügen</button>
   <p class="muted">„Umsatz 26“, „Umsatz 27“ … werden automatisch als Umsatz-Spalte erkannt und vor die älteren Umsatz-Spalten gestellt.</p></fieldset>
  <fieldset><legend>Daten</legend>
   <p class="muted">Stand: ${esc(DATA.quelle || "–")}${G.konfiguriert() ? "" : `<br>Gespeichert auf diesem Gerät.${DATA.ungesichert ? ` <span class="warn">Es gibt Änderungen, die noch nicht als Excel gesichert sind.</span>` : ""}`}</p>
   ${G.konfiguriert() ? `<p class="muted">Sicherungen: einmal pro Woche und vor jedem Kundenlisten-Abgleich in Google Drive › ${G.ORDNER} › ${G.SICHERUNG_ORDNER}. Letzte Sicherung: ${DATA.sicherung ? fmtD(DATA.sicherung) : "noch keine"}.</p>
   <button data-a="sichern" ${driveBereit() ? "" : "disabled"}>Jetzt sichern</button>` : ""}
   ${ORDNER ? `<button class="pri" data-a="ordnerspeichern">Im Tourenplaner-Ordner als Excel speichern</button>` : ""}
   <button ${ORDNER ? "" : `class="pri"`} data-a="export">Excel herunterladen</button>
   ${ORDNER && ORDNER.stand ? `<button data-a="ordnerladen">Neuesten Stand aus dem Ordner laden</button>` : ""}
   <label>Kundenliste abgleichen (neue Liste mit Spalte „Kd Nr.“ und Umsätzen)<input type="file" id="abglfile" accept=".xlsx,.xls"></label>
   <p class="muted">Die App zeigt vorher, was sich ändert: neue Umsätze, neue Kunden, Kunden, die nicht mehr in der Liste stehen. Sie wählen aus, was übernommen wird.</p>
   <label>Anderen Excel-Stand laden<input type="file" id="xlsxfile" accept=".xlsx"></label>
   <p class="muted">Beim Laden wird der Stand auf diesem Gerät ersetzt.</p></fieldset></div>`;
}

// Planungsgrundlagen: Umsatz, am längsten nicht besucht und „nur …“ für jede Häkchen-Spalte (z. B. Deko Kunde)
function grundlagen() {
  const L = [["umsatz", "Umsatz (umsatzstärkste zuerst)"], ["laengst", "Am längsten nicht besuchte Kunden zuerst"]];
  for (const s of haekchenSpalten()) L.push(["merkmal:" + s, `Nur „${s}“ (${DATA.kunden.filter(k => !k.inactive && P.hatMerkmal(k, s)).length} Kunden, umsatzstärkste zuerst)`]);
  const akt = S().grundlage; if (!L.some(([v]) => v === akt)) L.push([akt, `Nur „${String(akt).replace(/^merkmal:/, "")}“ (Spalte nicht mehr vorhanden)`]);
  return L.map(([v, l]) => [v, esc(l)]);
}
// Auswahl der Umsatz-Jahre, die in der Kundenliste vorkommen (z. B. Spalten "Umsatz 24", "Umsatz 25", "Umsatz 26")
function umsatzAuswahl() {
  const jahre = umsatzJahre(DATA.kunden); const akt = +S().umsatzJahr;
  if (!jahre.includes(akt)) jahre.unshift(akt);
  return jahre.map(j => {
    const n = DATA.kunden.filter(k => !k.inactive && (k.ums || {})[j] > 0).length;
    return `<option value="${j}" ${j === akt ? "selected" : ""}>Umsatz ${j} (${n} Kunden mit Umsatz)</option>`;
  }).join("");
}
function fzStatusText() {
  if (FZ_LAEUFT) return FZ_LAEUFT;
  const n = F.punkteErgaenzen(FZ, benoetigtePunkte()); const fehl = F.fehlendePaare(n), ges = n.punkte.length ** 2;
  if (!S().orsKey) return "Noch kein Schlüssel eingetragen – bis dahin wird geschätzt.";
  return (fehl === 0 ? `Alle Fahrzeiten zwischen ${n.punkte.length} Orten sind berechnet.` : `${Math.round((ges - fehl) / ges * 100)} % der Fahrzeiten berechnet.`) + (FZ_MELDUNG ? " Hinweis: " + FZ_MELDUNG : "");
}

/* ---------- Excel ---------- */
function standUebernehmen(name, daten) {
  const st = leseStand(XLSX, daten);
  if (DATA && DATA.ungesichert && !confirm("Auf diesem Gerät gibt es Änderungen, die noch nicht als Excel gesichert sind. Trotzdem den Stand aus „" + name + "“ laden?")) return;
  Sp.sichern();
  const drive = DATA && DATA.drive;
  DATA = { kunden: st.kunden, einst: st.einst, plan: st.plan, plaene: st.plaene, sicherung: st.sicherung, kalLoeschen: st.kalLoeschen, spalten: st.spalten, spaltenArten: st.spaltenArten, termine: st.termine, quelle: name + " (geladen " + fmtD(today()) + ")", ungesichert: false, drive, driveOffen: true, aenderung: 1 };
  planeAbgleich();
  persist(false); TAB = "plan"; render();
  toast(st.kunden.length + " Kunden geladen");
}
async function exportXlsx(inOrdner) {
  const buf = schreibeStand(XLSX, DATA);
  if (inOrdner) {
    try { const datei = await Sp.inOrdnerSpeichern(buf); DATA.quelle = datei; DATA.ungesichert = false; persist(false); ORDNER = await Sp.ordnerVerfuegbar(); render(); toast("Gespeichert: " + datei); }
    catch (e) { toast("Speichern im Ordner nicht möglich: " + e.message); }
    return;
  }
  const name = "Tourenplaner_Stand_" + today() + ".xlsx";
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  DATA.ungesichert = false; persist(false); render(); toast("Excel-Datei erstellt: " + name);
}

/* ---------- Dialoge ---------- */
function dlg(html) { const d = $("#dlg"); d.classList.remove("breit"); d.innerHTML = `<form method="dialog" class="dlgin">${html}</form>`; d.showModal(); return d; }
function openCustomer(id) {
  const c = byId(id); if (!c) return;
  const PL = PLAN();
  const dayOpts = PL ? PL.days.map((D, i) => D.type === "home" ? "" : `<option value="${i}">${WD[D.day]}</option>`).join("") : "";
  const tf = kommenderTermin(id);
  dlg(`<header class="dh"><h3>${esc(c.n1)} ${abcTag(c)}</h3><button value="x" class="ghost" aria-label="Schließen">Schließen</button></header>
   <p class="muted">${kdText(c)}</p>
   <p>${esc(c.n2)} ${esc(c.n3)}<br>${esc(c.str)}, ${esc(c.plz)} ${esc(c.ort)}<br>${navLink(c, "Navigation starten")}</p>
   <dl class="facts"><dt>Telefon</dt><dd>${c.tel ? telLink(c.tel) : "–"}</dd>
   <dt>Mobil</dt><dd>${c.mob ? telLink(c.mob) : "–"}</dd>${c.tel2 ? `<dt>Telefon 2</dt><dd>${telLink(c.tel2)}</dd>` : ""}
   <dt>E-Mail</dt><dd>${c.mail ? `<a href="mailto:${esc(c.mail)}">${esc(c.mail)}</a>` : "–"}</dd>
   <dt>Ansprechpartner</dt><dd>${esc(c.ap || "–")}${c.pos ? " (" + esc(c.pos) + ")" : ""}${c.dk ? " · " + telLink(c.dk) : ""}</dd>
   <dt>Öffnungszeiten</dt><dd>${esc(c.oh || "unbekannt")}${c.oh && !c.ohp.known ? `<br><span class="warn">Kann vom Programm nicht gelesen werden – geplant wird mit Mo–Fr 8–18 Uhr. Bitte z. B. so schreiben: Mo-Fr 9-12 und 14:30-18 Uhr</span>` : ""}</dd>
   <dt>Umsatz</dt><dd>${Object.keys(c.ums || {}).sort().reverse().map(j => j + ": " + eur(c.ums[j])).join(" · ") || "–"}</dd>${trendLang(c)}${Object.entries(c.extra || {}).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}
   <dt>Besuch</dt><dd>Letzter: ${fmtD(c.lv)} · Dauer ${P.dauer(c)} Min. · ${c.dHome != null ? Math.round(c.dHome) + " km ab Bremen" : "Lage unbekannt"}</dd>
   <dt>Termin</dt><dd>${tf ? `<b class="termin">${terminText(tf)}</b>${terminHinweis(c, tf.date, tf.time) ? `<br><span class="warn">${esc(terminHinweis(c, tf.date, tf.time))}</span>` : ""}<br>${wocheKnopf(tf.date, "link small")}` : "kein Termin vereinbart"}</dd></dl>
   ${c.planHold ? `<p class="warn">Wird nicht automatisch eingeplant. <button type="button" class="link small" data-a="unhold" data-id="${c.id}">Wieder einplanen</button></p>` : ""}
   <h4>Notizen</h4>${notizListe(c, "notes") || `<p class="muted">Noch keine Notizen.</p>`}
   <h4>Private Notizen</h4>${notizListe(c, "pnotes") || `<p class="muted">Noch keine privaten Notizen.</p>`}
   <div class="row wrap"><button class="pri" value="visit" data-id="${c.id}">Besuch erfassen</button><button value="edit" data-id="${c.id}">Bearbeiten</button><button value="bestwahl" data-id="${c.id}">Bestellformular</button><button value="bfform" data-id="${c.id}">Beanstandung</button>
   <button value="appt" data-id="${c.id}">${tf ? "Termin ändern" : "Termin vereinbaren"}</button>${tf ? `<button value="delappt" data-id="${c.id}" class="ghost">Termin absagen</button>` : ""}
   ${PL && dayOpts ? `<label class="inl">Zur Tour am <select id="addday">${dayOpts}</select></label><button value="addtour" data-id="${c.id}">hinzufügen</button>` : ""}</div>`);
}
function removeDialog(di, id) {
  const c = byId(id), D = PLAN().days[di];
  dlg(`<header class="dh"><h3>${esc(c.n1)} aus der Planung nehmen</h3><button value="x" class="ghost">Abbrechen</button></header>
   <p class="muted">Für ${WD[D.day]} wird automatisch ein passender Ersatz in der Nähe vorgeschlagen.</p>
   <div class="row wrap"><button class="pri" value="rmweek" data-id="${id}" data-d="${di}">Nur diese Woche</button>
   <button value="rmhold" data-id="${id}" data-d="${di}">Dauerhaft nicht mehr einplanen</button></div>
   <p class="muted">„Dauerhaft“ können Sie in der Kundenansicht jederzeit rückgängig machen.</p>`);
}
function removeStop(di, id, hold) {
  const PL = PLAN(); const D = PL.days[di]; const removed = byId(id);
  fixWeg(id, D.date);
  D.stops = D.stops.filter(x => x !== id); PL.excluded = [...new Set((PL.excluded || []).concat(id))];
  if (hold) roh(id).hold = true;
  aufbereiten();
  const rep = P.findReplacement(PL, D, removed);
  if (rep) D.stops = rep.seq;
  geaendert();
  toast(rep ? "Ersatz: " + rep.c.n1 + " (" + rep.c.ort + ")" : "Kein passender Ersatz in der Nähe gefunden");
}
function alternativeNehmen(di, id, altId) {
  const PL = PLAN(); const D = PL.days[di]; const i = D.stops.indexOf(id); if (i < 0) return;
  fixWeg(id, D.date);
  D.stops[i] = altId; PL.excluded = [...new Set((PL.excluded || []).concat(id))];
  geaendert();
  toast((byId(altId) || {}).n1 + " statt " + (byId(id) || roh(id)).n1 + " eingeplant");
}
function fixDialog(di, id, t) {
  const c = byId(id), D = PLAN().days[di];
  dlg(`<header class="dh"><h3>Termin bei ${esc(c.n1)}</h3><button value="x" class="ghost">Abbrechen</button></header>
   <p>${WD[D.day]}, ${fmtD(D.date)}${c.tel ? " · " + telLink(c.tel) : ""}${c.mob ? " · Mobil " + telLink(c.mob) : ""}</p>
   <label>Bestätigte Uhrzeit<input type="time" id="fxt" value="${esc(t)}" required></label>
   <p class="muted">Feste Termine bleiben beim Neuplanen erhalten. Die übrigen Besuche des Tages werden um sie herum geplant.</p>
   <div class="row"><button class="pri" value="savefix" data-id="${id}" data-d="${di}">Termin fix setzen</button></div>`);
}
// Hinweise zu einem Termindatum (der Termin wird trotzdem gespeichert)
function terminHinweis(c, d, t) {
  if (!d) return "";
  const wd = wochentag(d), h = [];
  if (d < today()) h.push("Das Datum liegt in der Vergangenheit.");
  if (wd === 4) h.push("Freitag ist Home-Office. Der Termin wird trotzdem eingetragen, an diesem Tag werden aber keine weiteren Besuche geplant.");
  else if (wd >= 5) h.push("Der Termin liegt am Wochenende. Er wird trotzdem eingetragen, an diesem Tag werden aber keine weiteren Besuche geplant.");
  else if (c.ohp && !P.openOn(c, wd)) h.push("Laut Öffnungszeiten hat der Kunde an diesem Tag geschlossen.");
  // Passt der Termin zu anderen Terminen am selben Tag? (Besuchsdauer + Fahrzeit dazwischen)
  if (t && c.lat != null) for (const [oid, o] of Object.entries(TERMINE())) {
    const oc = byId(oid); if (oid === c.id || o.date !== d || !oc || oc.lat == null) continue;
    if (tmin(o.time) <= tmin(t)) {
      const an = tmin(o.time) + P.dauer(oc) + P.fahrt(oc, c).min;
      if (an > tmin(t)) h.push(`Passt nicht zum Termin bei ${oc.n1} um ${o.time} Uhr: danach sind Sie frühestens ca. ${hhmm(an)} Uhr hier (${P.dauer(oc)} Min. Besuch + ${Math.round(P.fahrt(oc, c).min)} Min. Fahrt).`);
    } else {
      const an = tmin(t) + P.dauer(c) + P.fahrt(c, oc).min;
      if (an > tmin(o.time)) h.push(`Passt nicht zum Termin bei ${oc.n1} um ${o.time} Uhr: von hier aus wären Sie erst ca. ${hhmm(an)} Uhr dort (${P.dauer(c)} Min. Besuch + ${Math.round(P.fahrt(c, oc).min)} Min. Fahrt).`);
    }
  }
  // Von zu Hause aus pünktlich erreichbar? (früheste Abfahrt 5:30 Uhr)
  if (t && P.startBekannt() && c.lat != null) {
    const frueh = tmin(FRUEHESTE_ABFAHRT) + P.fahrt(HOME, c).min;
    if (tmin(t) < frueh) {
      const vorschlag = hhmm(Math.ceil(frueh / 15) * 15);
      h.push(`Von zu Hause frühestens ca. ${hhmm(frueh)} Uhr erreichbar (Abfahrt ${FRUEHESTE_ABFAHRT} Uhr). Besser ${vorschlag} Uhr oder später – oder als Tag 2 einer Übernachtung in der Nähe.`);
    }
  }
  return h.join(" ");
}
const FRUEHESTE_ABFAHRT = "05:30";
function terminDialog(id) {
  const c = byId(id), f = TERMINE()[id];
  dlg(`<header class="dh"><h3>Termin bei ${esc(c.n1)}</h3><button value="x" class="ghost">Abbrechen</button></header>
   <p>${[c.tel ? telLink(c.tel) : "", c.mob ? "Mobil " + telLink(c.mob) : "", c.oh ? "Öffnungszeiten: " + esc(c.oh) : ""].filter(Boolean).join(" · ")}</p>
   <div class="grid2"><label>Datum<input type="date" id="td" value="${f ? esc(f.date) : ""}" required></label>
   <label>Uhrzeit<input type="time" id="tt" value="${f ? esc(f.time) : ""}" required></label></div>
   <p id="tdh" class="warn" aria-live="polite"></p>
   <p class="muted">Der Termin bleibt beim Neuplanen erhalten und der Tag wird um ihn herum geplant – liegt er in der geplanten Woche, sofort${S().calSync ? ". Er wird ohne Einladung in den Google Kalender eingetragen" : ""}.</p>
   <div class="row"><button class="pri" value="saveappt" data-id="${id}">Termin speichern</button></div>`);
  const pruefen = () => { $("#tdh").textContent = terminHinweis(c, $("#td").value, $("#tt").value); };
  for (const f of ["#td", "#tt"]) { $(f).addEventListener("input", pruefen); $(f).addEventListener("change", pruefen); } pruefen();
}
function terminSpeichern(id) {
  const d = $("#td").value, t = $("#tt").value; if (!d || !t) return;
  const T = TERMINE(), alt = T[id], PL = planVon(montag(d)); // geplante Woche, in der der Termin liegt (falls vorhanden)
  T[id] = { date: d, time: t, ev: alt && alt.ev || null };
  let zusatz = "";
  // Liegt der Termin in der geplanten Woche, wird der Kunde dort an keinem anderen Tag besucht;
  // an einem Tourtag (Mo–Do) kommt er gleich an diesem Tag in die Tour
  const di = PL ? Math.round((parseISO(d) - parseISO(PL.week)) / 864e5) : -1;
  const warDrin = di >= 0 && di <= 6 && PL.days.some((X, i) => i !== di && X.stops.includes(id));
  if (warDrin) PL.days.forEach((X, i) => { if (i !== di) X.stops = X.stops.filter(x => x !== id); });
  if (warDrin && di >= 4) zusatz = " – aus den Touren dieser Woche genommen";
  if (di >= 0 && di <= 3) {
    const D = PL.days[di];
    PL.excluded = (PL.excluded || []).filter(x => x !== id);
    if (!D.stops.includes(id)) D.stops.push(id);
    // Tag um den Termin herum neu planen (feste Termine bleiben, passende Kunden in der Nähe kommen dazu)
    aufbereiten(); P.setzeBelegt(belegtFuer(PL.week)); const r = P.planeTagUm(PL, di);
    zusatz = " – " + WD[D.day] + " um den Termin neu geplant (" + (r ? r.neu : D.stops.length) + " Besuche)" + (P.simDay(D).lateFix ? ", Zeiten bitte prüfen" : "");
  }
  geaendert();
  const h = terminHinweis(byId(id), d, t), text = "Termin " + WDS[wochentag(d)] + " " + fmtD(d) + ", " + t + " Uhr";
  if (di >= 0 && di <= 6) { toast(text + zusatz + (h ? ". " + h : "")); return; }
  // Termin in einer anderen Woche: anbieten, diese Woche gleich zu planen und anzuschauen
  dlg(`<header class="dh"><h3>Termin gespeichert</h3><button value="x" class="ghost">Schließen</button></header>
   <p><b class="termin">${esc(byId(id).n1)}: ${terminText(T[id])}</b></p>${h ? `<p class="warn">${esc(h)}</p>` : ""}
   <p class="muted">Der Termin liegt in keiner der geplanten Wochen. Drumherum geplant wird, sobald diese Woche geplant wird.</p>
   <div class="row wrap">${wocheKnopf(d, "pri")}<button value="x">Später</button></div>`);
}
// Knopf "Woche planen und ansehen" (bzw. "Im Wochenplan ansehen", wenn die Woche schon geplant ist)
function wocheKnopf(d, cls = "") {
  const mon = montag(d), da = !!planVon(mon);
  return `<button type="button" class="${cls}" data-a="woche" data-datum="${esc(d)}">${da ? "Im Wochenplan ansehen" : "Woche ab " + fmtD(mon).slice(0, 6) + " jetzt planen und ansehen"}</button>`;
}
// Woche eines Termins zeigen – ist sie noch nicht geplant, wird sie geplant (die übrigen Wochen bleiben erhalten)
function wocheAnsehen(d) {
  const mon = montag(d), da = planVon(mon);
  if (!da) { // erst die Übernachtung für diese Woche wählen lassen
    dlg(`<header class="dh"><h3>Woche ab ${fmtD(mon)} planen</h3><button value="x" class="ghost">Schließen</button></header>
     <p>Wann soll in dieser Woche übernachtet werden?</p><div class="row wrap">${ovAuswahl("")}</div>
     <div class="row wrap"><button class="pri" value="wocheplanen" data-datum="${esc(d)}">Woche planen</button><button value="x">Abbrechen</button></div>`);
    return;
  }
  DATA.plan = da; TAB = "plan"; persist(false); render();
  zumTag(d);
}
function wocheMitNachtPlanen(d, nacht) {
  const mon = montag(d);
  if (!platzFuer(mon)) return;
  aufbereiten(); planSetzen(P.planWeek(mon, [], TERMINE(), nacht, belegtFuer(mon)));
  TAB = "plan"; geaendert(); toast("Woche ab " + fmtD(mon) + " geplant");
  zumTag(d);
}
function zumTag(d) {
  const tag = [...document.querySelectorAll("article.day")][wochentag(d)];
  if (tag) tag.scrollIntoView({ behavior: "smooth", block: "start" });
}
/* ---------- Notizen bearbeiten (geschäftlich = notes, privat = pnotes) ---------- */
// Liste in der Kundenansicht, nach Datum (neueste zuerst); jede Notiz mit „Bearbeiten“ (Index = Stelle in der gespeicherten Liste)
function notizListe(c, liste) {
  const N = (roh(c.id) || c)[liste] || [];
  if (!N.length) return "";
  const sortiert = N.map((n, i) => ({ n, i })).sort((a, b) => (b.n.d || "").localeCompare(a.n.d || "") || b.i - a.i); // neueste zuerst
  return `<ul class="notes${liste === "pnotes" ? " privat" : ""}">${sortiert.map(({ n, i }) =>
    `<li><time>${fmtD(n.d)}<button class="link small nedit" value="notizedit" data-id="${esc(c.id)}" data-l="${liste}" data-i="${i}">Bearbeiten</button></time>${esc(n.t)}</li>`).join("")}</ul>`;
}
function notizDialog(id, liste, i) {
  const k = roh(id), n = k && (k[liste] || [])[i]; if (!n) return;
  dlg(`<header class="dh"><h3>Notiz bearbeiten – ${esc(k.n1)}</h3><button value="notizzurueck" data-id="${esc(id)}" class="ghost">Abbrechen</button></header>
   <label>Datum<input type="date" id="nd" value="${esc(n.d)}"></label>
   <label>Notiz<textarea id="nt" rows="6">${esc(n.t)}</textarea></label>
   <label>Art<select id="nl"><option value="notes" ${liste === "notes" ? "selected" : ""}>Geschäftliche Notiz</option><option value="pnotes" ${liste === "pnotes" ? "selected" : ""}>Private Notiz</option></select></label>
   <div class="row wrap"><button class="pri" value="notizsave" data-id="${esc(id)}" data-l="${liste}" data-i="${i}">Speichern</button>
   <button value="notizdel" data-id="${esc(id)}" data-l="${liste}" data-i="${i}" class="ghost">Notiz löschen</button></div>`);
}
function notizSpeichern(id, liste, i, loeschen) {
  const k = roh(id), N = k && (k[liste] || []), n = N && N[i]; if (!n) return;
  const t = loeschen ? "" : $("#nt").value.trim(), d = loeschen ? n.d : ($("#nd").value || n.d), ziel = loeschen ? liste : $("#nl").value;
  if (!t && !confirm("Diese Notiz wirklich löschen?")) { openCustomer(id); return; }
  if (t && ziel === liste) N[i] = { d, t }; // an derselben Stelle ändern
  else { N.splice(i, 1); if (t) k[ziel] = (k[ziel] || []).concat({ d, t }); }
  if (t) k[ziel].sort((a, b) => (a.d || "").localeCompare(b.d || "")); // nach Datum geordnet (gleiches Datum: Reihenfolge bleibt)
  geaendert(); openCustomer(id);
  toast(!t ? "Notiz gelöscht" : ziel !== liste ? (ziel === "pnotes" ? "Als private Notiz gespeichert" : "Als geschäftliche Notiz gespeichert") : "Notiz gespeichert");
}
function visitDialog(id) {
  const c = byId(id);
  const SR = !IOS && (window.SpeechRecognition || window.webkitSpeechRecognition);
  dlg(`<header class="dh"><h3>Besuch bei ${esc(c.n1)}</h3><button value="x" class="ghost">Abbrechen</button></header>
   <label>Datum<input type="date" id="vd" value="${today()}"></label>
   <label>Geschäftliche Notiz<textarea id="vt" rows="5" placeholder="Was wurde besprochen? Muster, Angebote, nächste Schritte …"></textarea></label>
   <label>Private Notiz<textarea id="vp" rows="3" placeholder="Persönliches, z. B. Familie, Hobbys, Urlaub …"></textarea></label>
   <div class="row">${SR ? `<button type="button" id="mic" class="mic" aria-pressed="false">Diktieren</button><span id="micst" class="muted" aria-live="polite"></span>` : `<span class="hint">Zum Diktieren ins gewünschte Notizfeld tippen und auf das Mikrofon der Tastatur drücken.</span>`}</div>
   <div class="row"><button class="pri" value="savevisit" data-id="${id}">Besuch speichern</button></div>`);
  if (SR) {
    // Diktat schreibt in das zuletzt angetippte Notizfeld (geschäftlich oder privat)
    let rec = null, base = "", ziel = $("#vt");
    ["#vt", "#vp"].forEach(s => $(s).addEventListener("focus", () => { if (!rec) ziel = $(s); }));
    $("#mic").onclick = () => {
      if (rec) { rec.stop(); return; }
      try {
        rec = new SR(); rec.lang = "de-DE"; rec.continuous = true; rec.interimResults = true; base = ziel.value; if (base && !/\s$/.test(base)) base += " ";
        rec.onresult = e => { let fin = "", tmp = ""; for (let i = 0; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) fin += r[0].transcript; else tmp += r[0].transcript; } ziel.value = base + fin + tmp; };
        rec.onerror = e => { $("#micst").textContent = e.error === "not-allowed" || e.error === "service-not-allowed" ? "Mikrofon nicht freigegeben – bitte Tastatur-Diktat nutzen." : "Diktat unterbrochen."; };
        rec.onend = () => { rec = null; $("#mic").textContent = "Diktieren"; $("#mic").setAttribute("aria-pressed", "false"); if (!$("#micst").textContent.includes("nicht")) $("#micst").textContent = ""; };
        rec.start(); $("#mic").textContent = ziel.id === "vp" ? "Diktat beenden (privat)" : "Diktat beenden"; $("#mic").setAttribute("aria-pressed", "true"); $("#micst").textContent = "Hört zu …";
      } catch (err) { $("#micst").textContent = "Diktat hier nicht verfügbar – bitte Tastatur-Diktat nutzen."; }
    };
  }
}
// Kundennummer: in der App angelegte Kunden haben bis zur echten Kd.-Nr. eine vorläufige Nummer ("N…")
const vorlaeufig = id => /^N/.test(String(id));
function kdText(c) { return vorlaeufig(c.id) ? "Noch keine Kd.-Nr. (selbst angelegt) – unter „Bearbeiten“ eintragen" : "Kd.-Nr. " + esc(c.id); }
function kdKurz(c) { return vorlaeufig(c.id) ? "ohne Kd.-Nr." : "Kd. " + esc(c.id); }
/* ---------- Kundenliste abgleichen ---------- */
let ABGL = null; // { liste, vorschlag, datei }
async function abgleichStarten(datei) {
  const liste = kundenlisteLesen(XLSX, await datei.arrayBuffer());
  ABGL = { liste, vorschlag: abgleichVorschlag(liste, DATA.kunden), datei: datei.name };
  abgleichDialog();
}
function abgleichDialog() {
  const { liste, vorschlag: v, datei } = ABGL, j = liste.jahre[0];
  const jahr = z => j ? ` · Umsatz ${String(j).slice(2)}: ${eur((z.ums || {})[j])}` : "";
  const liste_ = (art, L, an, text) => L.length ? `<details ${L.length <= 12 ? "open" : ""}><summary>${L.length} ${text}</summary><div class="tagliste">${L.map(x =>
    `<label class="chk"><input type="checkbox" data-abgl="${art}" data-id="${esc(x.id)}" ${an ? "checked" : ""}> ${esc(x.name || x.n1)} <small class="muted">${esc(x.ort || "")}${art === "neu" ? jahr(x) : ""}${art === "vorlaeufig" ? " → Kd.-Nr. " + esc(x.neu) : ""}</small></label>`).join("")}</div></details>` : "";
  const stammText = v.stamm.slice(0, 40).map(s => `<li><b>${esc(s.name)}</b>: ${s.felder.map(x => `${stammName(x.f)} „${esc(x.alt || "leer")}“ → „${esc(x.neu)}“`).join("; ")}</li>`).join("");
  const nichts = !v.umsatz.length && !v.neu.length && !v.fehlen.length && !v.vorlaeufig.length && !v.reaktiv.length && !v.stamm.length;
  dlg(`<header class="dh"><h3>Kundenliste abgleichen</h3><button value="x" class="ghost">Abbrechen</button></header>
   <p class="muted">${esc(datei)} · ${liste.zeilen.length} Kunden · Umsatz-Spalten: ${liste.jahre.map(x => String(x)).join(", ") || "keine"}. Abgleich über die Kd.-Nr.</p>
   ${nichts ? `<p>Alles ist schon auf dem Stand der Liste.</p>` : ""}
   ${v.umsatz.length ? `<label class="chk"><input type="checkbox" id="abgl-umsatz" checked> <b>Umsätze aktualisieren</b> bei ${v.umsatz.length} Kunden (${liste.jahre.join(", ")})</label>` : ""}
   ${liste_("vorlaeufig", v.vorlaeufig, true, "selbst angelegte Kunden bekommen ihre Kd.-Nr.")}
   ${liste_("neu", v.neu, true, "neue Kunden aufnehmen")}
   ${liste_("fehlen", v.fehlen, true, "Kunden stehen nicht mehr in der Liste – deaktivieren")}
   ${liste_("reaktiv", v.reaktiv, false, "deaktivierte Kunden stehen wieder in der Liste – wieder aktivieren")}
   ${v.stamm.length ? `<label class="chk"><input type="checkbox" id="abgl-stamm"> <b>Adressen und Kontaktdaten übernehmen</b> – bei ${v.stamm.length} Kunden weichen sie ab</label>
     <details><summary>Abweichungen ansehen</summary><ul class="wnotes">${stammText}${v.stamm.length > 40 ? `<li>… und ${v.stamm.length - 40} weitere</li>` : ""}</ul></details>` : ""}
   <p class="muted">Termine, Notizen, Öffnungszeiten, letzter Besuch und Ihre eigenen Spalten bleiben unverändert. Deaktivierte Kunden bleiben in der Excel-Datei und lassen sich wieder aktivieren.</p>
   ${nichts ? "" : `<div class="row"><button class="pri" value="abglspeichern">Übernehmen</button></div>`}`);
}
async function abgleichUebernehmen() {
  if (!ABGL) return;
  const { liste, vorschlag } = ABGL, sel = art => new Set([...document.querySelectorAll(`#dlg input[data-abgl="${art}"]`)].filter(el => el.checked).map(el => el.dataset.id));
  const auswahl = { umsatz: !!($("#abgl-umsatz") || {}).checked, stamm: !!($("#abgl-stamm") || {}).checked, neu: sel("neu"), fehlen: sel("fehlen"), vorlaeufig: sel("vorlaeufig"), reaktiv: sel("reaktiv") };
  // vorher den bisherigen Stand sichern
  if (driveBereit()) {
    try { toast("Sicherung wird angelegt …"); await sicherungAnlegen("vor_Abgleich_" + uhrzeitJetzt()); }
    catch (e) { if (!confirm("Die Sicherung in Google Drive hat nicht geklappt (" + e.message + "). Abgleich trotzdem übernehmen?")) return; }
  } else if (!confirm("Keine Verbindung zu Google Drive – vorher wird keine Sicherung angelegt. Tipp: erst „Excel herunterladen“. Abgleich trotzdem übernehmen?")) return;
  const erg = abgleichAnwenden(DATA.kunden, liste, vorschlag, auswahl);
  erg.umbenennen.forEach(([alt, neu]) => kundeUmbenennen(alt, neu));
  // neue Umsatz-Spalten (z. B. „Umsatz 27“) vor die älteren stellen
  const sp = DATA.spalten && DATA.spalten.length ? DATA.spalten : STANDARD_REIHENFOLGE.slice();
  for (const j of liste.jahre.slice().reverse()) if (!sp.some(s => umsatzJahr(s) === j)) { const i = sp.findIndex(s => umsatzJahr(s)); sp.splice(i < 0 ? sp.length : i, 0, "Umsatz " + String(j).slice(2)); }
  // Stand der Umsätze (für die Hochrechnung): Datum aus dem Dateinamen, z. B. „… zum 7.10.2026.xlsx“, sonst heute
  if (auswahl.umsatz && liste.jahre[0] === new Date().getFullYear()) {
    const m = String(ABGL.datei).match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    const d = m ? m[3] + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0") : today();
    DATA.einst.umsatzStand = /^\d{4}-\d\d-\d\d$/.test(d) && +d.slice(0, 4) === liste.jahre[0] ? d : today();
  }
  DATA.spalten = sp; ABGL = null; geaendert();
  const t = [erg.umsatz && erg.umsatz + " Umsätze", erg.neu && erg.neu + " neue Kunden", erg.umbenennen.length && erg.umbenennen.length + " Kd.-Nr. vergeben",
    erg.deaktiviert && erg.deaktiviert + " deaktiviert", erg.reaktiviert && erg.reaktiviert + " wieder aktiv", erg.stamm && erg.stamm + " Adressen aktualisiert"].filter(Boolean);
  toast("Abgleich übernommen: " + (t.join(", ") || "keine Änderungen"));
}
// Kundennummer ändern (nur vorläufige): Termine und Wochenplan gehen mit
function kundeUmbenennen(alt, neu) {
  roh(alt).id = neu;
  const T = TERMINE(); if (T[alt]) { T[neu] = T[alt]; delete T[alt]; T[neu].cal = ""; } // Kalendereintrag mit neuer Kd.-Nr. aktualisieren
  for (const PL of PLAENE()) { PL.days.forEach(D => { D.stops = D.stops.map(x => x === alt ? neu : x); }); PL.excluded = (PL.excluded || []).map(x => x === alt ? neu : x); }
}
function editDialog(id) {
  const c = id ? roh(id) : { abc: "C" };
  const kdFeld = !id || vorlaeufig(id)
    ? `<label>Kd.-Nr. (falls schon vergeben)<input id="e-kd" value="" inputmode="numeric" placeholder="noch keine"></label>`
    : `<label>Kd.-Nr.<input value="${esc(id)}" disabled></label>`;
  const fld = (k, l, t = "text", rq = "") => `<label>${l}<input type="${t}" id="e-${k}" value="${esc(c[k] || "")}" ${rq}></label>`;
  dlg(`<header class="dh"><h3>${id ? "Kunde bearbeiten" : "Neuer Kunde"}</h3><button value="x" class="ghost" formnovalidate>Abbrechen</button></header>
   <div class="grid2">${kdFeld}${fld("n1", "Firma", "text", "required")}${fld("n2", "Zusatz")}${fld("str", "Straße")}${fld("plz", "PLZ", "text", 'required inputmode="numeric" pattern="[0-9]{5}"')}${fld("ort", "Ort")}${fld("tel", "Telefon", "tel")}${fld("mob", "Mobil", "tel")}${fld("tel2", "Telefon 2 (z. B. Werkstatt)", "tel")}${fld("mail", "E-Mail", "email")}
   ${fld("ap", "Ansprechpartner")}${fld("pos", "Position")}${fld("dk", "Direktkontakt Ansprechpartner", "tel")}
   <label>Priorität<select id="e-abc">${["A", "B", "C"].map(x => `<option ${c.abc === x ? "selected" : ""}>${x}</option>`).join("")}</select></label>
   <label>Letzter Besuch<input type="date" id="e-lv" value="${esc(c.lv || "")}"></label>
   <label>Besuchsdauer (Min., leer = Standard ${S().visitMin})<input type="number" id="e-vm" value="${esc(c.vm || "")}"></label></div>
   <label>Öffnungszeiten<input id="e-oh" value="${esc(c.oh || "")}" placeholder="z. B. Mo-Fr 8:00-12:30 u. 14:00-18:00 Uhr, Sa geschlossen"></label>
   ${eigene().length ? `<div class="grid2">${eigene().map((s, i) => { const v = (c.extra || {})[s];
     return istHaekchen(s) ? `<label class="chk"><input type="checkbox" id="e-x${i}" ${istJa(v) ? "checked" : ""}> ${esc(s)}</label>` : `<label>${esc(s)}<input id="e-x${i}" value="${esc(v ?? "")}"></label>`; }).join("")}</div>` : ""}
   <p id="e-msg" class="warn" aria-live="polite"></p>
   <div class="row wrap"><button class="pri" value="saveedit" data-id="${id || ""}">Speichern</button>${id ? `<button value="deact" data-id="${id}" class="ghost" formnovalidate>Kunde deaktivieren</button>` : ""}</div>`);
}

/* ---------- Aktionen ---------- */
// Nacht muss gewählt sein (es gibt keinen Standard mehr)
function nachtGewaehlt() {
  const w = $("#main #ovwahl"); if (w && P.ovGueltig(w.value)) return w.value;
  if (w) { w.focus(); w.reportValidity(); }
  toast("Bitte zuerst bei „Übernachtung“ die Nacht wählen"); return null;
}
function doPlan() {
  const nacht = nachtGewaehlt(); if (!nacht) return;
  const mon = montag($("#wk").value || iso(P.weekStart()));
  const alt = planVon(mon); // dieselbe Woche neu planen: "nur diese Woche entfernt" bleibt
  if (!alt && !platzFuer(mon)) return;
  aufbereiten();
  // Termine aller Wochen; die Planung nimmt die dieser Woche. Kunden aus den anderen geplanten Wochen kommen nicht doppelt dran.
  planSetzen(P.planWeek(mon, alt ? alt.excluded : [], TERMINE(), nacht, belegtFuer(mon)));
  geaendert();
}
// Geplante Woche löschen (z. B. Urlaub) – feste Termine bleiben erhalten und kommen in die Woche, sobald sie wieder geplant wird
function wocheLoeschen() {
  const PL = PLAN(); if (!PL) return;
  if (!confirm(`KW ${kw(PL.week)} (Woche ab ${fmtD(PL.week)}) löschen? Feste Termine bleiben erhalten.`)) return;
  DATA.plaene = PLAENE().filter(p => p !== PL); DATA.plan = null; PLAENE();
  geaendert(); toast("KW " + kw(PL.week) + " gelöscht");
}
// Knopf in einem Dialog wurde gedrückt (direkt ausgeführt, nicht erst beim "close"-Ereignis – das kommt nicht in jedem Browser zuverlässig)
function dlgAktion(v, btn) {
  const id = btn && btn.dataset.id;
  const PL = PLAN();
  if (v === "wocheplanen") { wocheMitNachtPlanen(btn.dataset.datum, btn.dataset.nacht); return; }
  if (v === "drivelade" || v === "driveueber") {
    const meta = KONFLIKT; KONFLIKT = null;
    (v === "drivelade" ? vonDriveLaden(meta) : nachDrive(meta.id).then(() => toast("Stand dieses Geräts in Google Drive gespeichert")))
      .catch(e => { console.warn(e); toast("Google Drive nicht erreichbar – bitte später erneut versuchen"); }).finally(statusZeigen);
    return;
  }
  if (v === "bestwahl") { bestellWahl(id); return; }
  if (v === "bestform") { bestellFormular(id, btn.dataset.art).catch(fehlerZeigen); return; }
  if (v === "bestleeren") { entwurfWeg(); bestellFormular(id, btn.dataset.art).catch(fehlerZeigen); return; }
  if (v === "bestpdf") { bestellungErstellen(id, btn.dataset.art).catch(fehlerZeigen); return; }
  if (v === "bestteilen") { bestellungTeilen(); return; }
  if (v === "bestladen") { bestellungLaden(); return; }
  if (v === "bestaendern") { if (BEST) (BEST.art === "beanstandung" ? beanstandungFormular(BEST.id, BEST.w) : bestellFormular(BEST.id, BEST.art, BEST.w)).catch(fehlerZeigen); return; }
  if (v === "bfform") { beanstandungFormular(id).catch(fehlerZeigen); return; }
  if (v === "bfleeren") { entwurfWeg(); beanstandungFormular(id).catch(fehlerZeigen); return; }
  if (v === "bferstellen") { beanstandungErstellen(id).catch(fehlerZeigen); return; }
  if (v === "notizedit") { notizDialog(id, btn.dataset.l, +btn.dataset.i); return; }
  if (v === "notizsave" || v === "notizdel") { notizSpeichern(id, btn.dataset.l, +btn.dataset.i, v === "notizdel"); return; }
  if (v === "notizzurueck") { openCustomer(id); return; }
  if (v === "visit") { visitDialog(id); return; }
  if (v === "edit") { editDialog(id); return; }
  if (v === "appt") { terminDialog(id); return; }
  if (v === "tagabspeichern") { tagAbschliessen(btn.dataset.week, +btn.dataset.d); return; }
  if (v === "abglspeichern") { abgleichUebernehmen().catch(e => { console.error(e); toast("Fehler: " + e.message); }); return; }
  if (v === "saveappt") { terminSpeichern(id); return; }
  if (v === "delappt") {
    const f = TERMINE()[id]; if (!f || !confirm("Termin am " + fmtD(f.date) + " um " + f.time + " Uhr absagen?")) return;
    fixWeg(id); geaendert(); toast("Termin abgesagt" + (f.ev ? " – der Kalendereintrag wird gelöscht" : "")); return;
  }
  if (v === "savevisit") {
    const t = $("#vt").value.trim(), p = $("#vp").value.trim(), dt = $("#vd").value || today(); const k = roh(id);
    k.notes = (k.notes || []).concat(t ? [{ d: dt, t }] : []); k.pnotes = (k.pnotes || []).concat(p ? [{ d: dt, t: p }] : []);
    if (!k.lv || dt > k.lv) k.lv = dt;
    geaendert(); toast("Besuch gespeichert");
  }
  if (v === "addtour") {
    const di = +$("#addday").value; const D = PL.days[di];
    PL.days.forEach((X, i) => { if (i !== di) X.stops = X.stops.filter(x => x !== id); });
    const f = TERMINE()[id]; // fester Termin an einem anderen Tag dieser Woche fällt weg (Termine in anderen Wochen bleiben)
    if (f && f.date !== D.date && f.date >= PL.week && f.date <= PL.days[PL.days.length - 1].date) fixWeg(id);
    if (!D.stops.includes(id)) { aufbereiten(); const r = P.tryInsert(D, id); D.stops = r || D.stops.concat(id); TAB = "plan"; geaendert(); toast(r ? "Zur Tour hinzugefügt" : "Hinzugefügt – Tag wird knapp, bitte prüfen"); }
  }
  if (v === "rmweek" || v === "rmhold") { removeStop(+btn.dataset.d, id, v === "rmhold"); return; }
  if (v === "savefix") {
    const di = +btn.dataset.d, D = PL.days[di], tm = $("#fxt").value;
    if (tm) {
      const T = TERMINE(); const alt = T[id]; T[id] = { date: D.date, time: tm, ev: alt && alt.ev || null }; P.setFix(T, PL.week); P.resequence(D); geaendert();
      const s = P.simDay(D); toast(s.lateFix ? "Termin fix – Zeiten bitte prüfen" : "Termin fix: " + tm + " Uhr");
    }
    return;
  }
  if (v === "saveedit") {
    const g = k => ($("#e-" + k)?.value || "").trim();
    const f = { n1: g("n1"), n2: g("n2"), str: g("str"), plz: g("plz"), ort: g("ort"), tel: g("tel"), mob: g("mob"), tel2: g("tel2"), mail: g("mail"), ap: g("ap"), pos: g("pos"), dk: g("dk"), abc: g("abc"), oh: g("oh"), vm: +g("vm") || null };
    const lv = g("lv");
    const kd = g("kd"), fehler = msg => { editDialog(id); setTimeout(() => { $("#e-msg").textContent = msg; }, 0); };
    if (!f.n1 || !f.plz) { fehler("Firma und PLZ werden benötigt."); return; }
    if (kd && (vorlaeufig(kd) || /\s/.test(kd))) { fehler("Bitte die Kd.-Nr. ohne Leerzeichen eingeben."); return; }
    if (kd && DATA.kunden.some(k => k.id === kd)) { fehler("Die Kd.-Nr. " + kd + " gibt es schon bei „" + DATA.kunden.find(k => k.id === kd).n1 + "“."); return; }
    // eigene Spalten: Häkchen -> "ja" bzw. leer, Text wie eingegeben (leere Felder werden nicht gespeichert)
    const extra = {};
    eigene().forEach((s, i) => { const el = $("#e-x" + i); if (!el) return; const v = istHaekchen(s) ? (el.checked ? "ja" : "") : el.value.trim(); if (v) extra[s] = v; });
    if (id) { const k = roh(id); Object.assign(k, f); k.extra = { ...Object.fromEntries(Object.entries(k.extra || {}).filter(([s]) => !eigene().includes(s))), ...extra }; if (lv) k.lv = lv; if (kd) kundeUmbenennen(id, kd); }
    else DATA.kunden.push(Object.assign({ id: kd || "N" + Date.now().toString(36), n3: "", rab: "", pg: "", ums: {}, extra, notes: [], hold: false, isNew: true, inactive: false, lv: lv || "" }, f));
    geaendert(); toast(PLZ[f.plz] ? "Kunde gespeichert" : "Gespeichert – PLZ unbekannt, Kunde wird nicht eingeplant");
  }
  if (v === "deact") { roh(id).inactive = true; geaendert(); toast("Kunde deaktiviert"); }
}
/* ---------- Bestellformulare (Meterkonfektion, Flächenvorhang, Faltrollo) ---------- */
// Die PDF-Vorlagen liegen nur auf dem Gerät (IndexedDB) und in Google Drive – nie im öffentlichen Programm.
const VORL = { ...Object.fromEntries(B.ARTEN.map(a => [a, { titel: B.FORMULARE[a].titel, typ: "application/pdf", ext: "pdf" }])), beanstandung: { titel: "Beanstandungsformular", typ: BF.DOCX_TYP, ext: "docx" } };
const VORLAGE_ARTEN = Object.keys(VORL), VORLAGE_ACCEPT = "application/pdf,.pdf,.docx," + BF.DOCX_TYP;
const VORLAGE_DRIVE = art => "Tourenplaner_Vorlage_" + VORL[art].titel.replace("ä", "ae") + "." + VORL[art].ext;
// Welche Vorlage ist das? Word-Dateien (Zip, beginnen mit „PK“) nur als Beanstandungsformular, sonst PDF-Formulare
async function vorlageErkennen(bytes) {
  const b = new Uint8Array(bytes, 0, 2);
  if (b[0] === 0x50 && b[1] === 0x4b) return BF.erkennen(XLSX, bytes) ? "beanstandung" : null;
  return B.erkennen(await pdfLib(), bytes);
}
const VORLAGE_KEY = art => "vorlage:" + art, VORLAGEN_DRIVE_KEY = "tourenplaner-vorlagen-drive", ENTWURF_KEY = "tourenplaner-bestellentwurf";
let VORLAGEN = {};       // art -> true, wenn die Vorlage auf diesem Gerät liegt
let BEST = null;         // zuletzt erstelltes Formular { id, art, w, pdf, name }
let SIG = null, VORLAGE_FUER = null; // Unterschriftsfeld; { id, art }, wenn beim Öffnen die Vorlage fehlte
const fehlerZeigen = e => { console.error(e); toast("Fehler: " + e.message); };

let pdfLibLaeuft = null;
function pdfLib() { // pdf-lib erst laden, wenn ein Formular gebraucht wird (die Datei ist groß)
  if (window.PDFLib) return Promise.resolve(window.PDFLib);
  return pdfLibLaeuft ||= new Promise((ok, fehler) => {
    const el = document.createElement("script"); el.src = "vendor/pdf-lib.min.js";
    el.onload = () => ok(window.PDFLib);
    el.onerror = () => { pdfLibLaeuft = null; el.remove(); fehler(new Error("PDF-Programmteil konnte nicht geladen werden – bitte mit Netz erneut versuchen")); };
    document.head.appendChild(el);
  });
}
async function vorlagenPruefen() { for (const a of VORLAGE_ARTEN) VORLAGEN[a] = !!(await Sp.dateiLesen(VORLAGE_KEY(a))); }
const vorlagenInDrive = () => { try { return JSON.parse(localStorage.getItem(VORLAGEN_DRIVE_KEY) || "[]"); } catch (e) { return []; } };
async function vorlageNachDrive(art, bytes) {
  const i = await G.dateiInfo(VORLAGE_DRIVE(art)); await G.dateiSpeichern(VORLAGE_DRIVE(art), bytes, VORL[art].typ, i && i.id);
  try { localStorage.setItem(VORLAGEN_DRIVE_KEY, JSON.stringify([...new Set(vorlagenInDrive().concat(art))])); } catch (e) { /* egal */ }
}
// Vorlagen, die ohne Google-Verbindung ausgewählt wurden, nachträglich in Google Drive ablegen
async function vorlagenNachDrive() {
  if (!driveBereit()) return;
  for (const a of VORLAGE_ARTEN) if (VORLAGEN[a] && !vorlagenInDrive().includes(a)) await vorlageNachDrive(a, await Sp.dateiLesen(VORLAGE_KEY(a))).catch(e => console.warn(e));
}
// Am Rechner: fehlende Vorlagen aus dem Ordner „Vorlagen“ im Tourenplaner-Ordner übernehmen
async function vorlagenAusOrdner() {
  if (!ORDNER || VORLAGE_ARTEN.every(a => VORLAGEN[a])) return;
  const namen = await Sp.vorlagenImOrdner(); if (!namen.length) return;
  for (const n of namen) {
    const bytes = await Sp.vorlageAusOrdner(n), art = await vorlageErkennen(bytes);
    if (!art || VORLAGEN[art]) continue;
    await Sp.dateiAblegen(VORLAGE_KEY(art), bytes); VORLAGEN[art] = true;
  }
}
// Vorlage vom Gerät, sonst aus Google Drive (z. B. auf dem iPhone, wenn sie am Rechner ausgewählt wurde)
async function vorlageHolen(art) {
  if (!VORLAGEN[art]) await vorlagenAusOrdner().catch(e => console.warn(e));
  const b = await Sp.dateiLesen(VORLAGE_KEY(art)); if (b) return b;
  if (!driveBereit()) return null;
  const i = await G.dateiInfo(VORLAGE_DRIVE(art)).catch(() => null); if (!i) return null;
  const d = await G.dateiLaden(i.id); await Sp.dateiAblegen(VORLAGE_KEY(art), d); VORLAGEN[art] = true; return d;
}
// Ausgewählte Dateien als Vorlagen übernehmen; welches Formular es ist, erkennt die App an den Feldern
async function vorlagenEinlesen(dateien) {
  const gut = [], falsch = [];
  for (const f of dateien) {
    const bytes = await f.arrayBuffer(), art = await vorlageErkennen(bytes);
    if (!art) { falsch.push(f.name); continue; }
    await Sp.dateiAblegen(VORLAGE_KEY(art), bytes); VORLAGEN[art] = true; gut.push(VORL[art].titel);
    if (driveBereit()) vorlageNachDrive(art, bytes).catch(e => console.warn(e));
  }
  toast((gut.length ? "Vorlage übernommen: " + gut.join(", ") : "Keine Vorlage übernommen") + (falsch.length ? ". Nicht erkannt: " + falsch.join(", ") : ""));
  return gut.length;
}
const entwurfLesen = () => { try { return JSON.parse(localStorage.getItem(ENTWURF_KEY) || "null"); } catch (e) { return null; } };
const entwurfWeg = () => { try { localStorage.removeItem(ENTWURF_KEY); } catch (e) { /* egal */ } };

function vorlageFehlt(id, art) {
  const V = VORL[art], was = V.ext === "pdf" ? "PDF-Formular" : "Word-Formular";
  VORLAGE_FUER = { id, art };
  dlg(`<header class="dh"><h3>Vorlage ${V.titel} fehlt</h3><button value="x" class="ghost">Abbrechen</button></header>
   <p>Bitte einmal das ${was} „${V.titel}“ auswählen (z. B. aus Google Drive). Danach ist es auf diesem Gerät gespeichert${G.konfiguriert() ? " und wird auch in Google Drive abgelegt" : ""}.</p>
   <label>${was} auswählen<input type="file" id="vorlagefile" accept="${VORLAGE_ACCEPT}" multiple></label>
   ${G.konfiguriert() && !G.angemeldet() ? `<p class="muted">Tipp: Mit Google verbunden holt die App die Vorlage selbst, wenn sie schon auf einem anderen Gerät ausgewählt wurde.</p>` : ""}`);
}
function bestellWahl(id) {
  const c = byId(id) || roh(id);
  dlg(`<header class="dh"><h3>Bestellformular für ${esc(c.n1)}</h3><button value="x" class="ghost">Abbrechen</button></header>
   <p class="muted">Kundendaten und Datum werden eingetragen. Heraus kommt das ausgefüllte Original-Formular als PDF.</p>
   <div class="row wrap">${B.ARTEN.map(a => `<button class="pri" value="bestform" data-art="${a}" data-id="${esc(id)}">${B.FORMULARE[a].titel}</button>`).join("")}</div>`);
}
async function bestellFormular(id, art, werte) {
  const c = byId(id) || roh(id), F = B.FORMULARE[art];
  if (!(await vorlageHolen(art))) { vorlageFehlt(id, art); return; }
  const e = entwurfLesen(), mitEntwurf = !werte && e && e.id === id && e.art === art;
  const w = werte || (mitEntwurf ? e.w : B.vorbelegen(c));
  const d = dlg(`<header class="dh"><h3>${F.titel}: ${esc(c.n1)}</h3><button value="x" class="ghost">Abbrechen</button></header>
   ${mitEntwurf ? `<p class="hint">Die letzten Eingaben wurden wiederhergestellt. <button class="link small" value="bestleeren" data-id="${esc(id)}" data-art="${art}">Neu beginnen</button></p>` : ""}
   ${werte ? `<p class="hint">Unterschrift bitte bei Bedarf neu setzen.</p>` : ""}
   ${B.formularHTML(art, w)}
   <div class="row"><button class="pri" value="bestpdf" data-id="${esc(id)}" data-art="${art}">PDF erstellen</button></div>`);
  d.classList.add("breit");
  const form = d.querySelector("form");
  SIG = B.unterschriftFeld($("#bsig"), $("#bsigweg"));
  $("#bposplus").onclick = () => {
    const n = form.querySelector(".bpos[hidden]"); if (n) { n.hidden = false; n.querySelector("input,select").focus(); }
    if (!form.querySelector(".bpos[hidden]")) $("#bposplus").hidden = true;
  };
  form.oninput = () => { try { localStorage.setItem(ENTWURF_KEY, JSON.stringify({ id, art, w: B.werteLesen(form) })); } catch (err) { /* egal */ } };
  pdfLib().catch(() => {}); // schon einmal im Hintergrund laden
}
async function bestellungErstellen(id, art) {
  const form = $("#dlg form"), w = B.werteLesen(form), png = SIG && SIG.png();
  if (B.positionenLeer(w) && !confirm("Es ist noch keine Position ausgefüllt. Trotzdem ein PDF erstellen?")) { await bestellFormular(id, art, w); return; }
  toast("PDF wird erstellt …");
  const [L, vorlage] = await Promise.all([pdfLib(), vorlageHolen(art)]);
  if (!vorlage) throw new Error("Vorlage fehlt");
  const pdf = await B.ausfuellen(L, vorlage, art, w, png), name = B.dateiname(art, w), titel = B.FORMULARE[art].titel;
  BEST = { id, art, w, pdf, name, typ: "application/pdf" };
  entwurfWeg();
  const k = roh(id);
  if (k) { k.notes = (k.notes || []).concat({ d: today(), t: `${w.art === "angebot" ? "Angebot" : "Bestellung"} ${titel} erstellt${w.kommission ? " (Kommission " + w.kommission + ")" : ""}` }); geaendert(); }
  let drive = "";
  if (driveBereit()) {
    try { await G.bestellungSpeichern(name, pdf, "application/pdf", G.BESTELL_ORDNER); drive = `In Google Drive › ${G.ORDNER} › ${G.BESTELL_ORDNER} gespeichert.`; }
    catch (e) { console.warn(e); drive = "Google Drive war nicht erreichbar – bitte das PDF teilen oder herunterladen."; }
  } else if (G.konfiguriert()) drive = "Nicht mit Google verbunden – das PDF wurde nicht in Google Drive gespeichert.";
  dlg(`<header class="dh"><h3>${titel}: PDF fertig</h3><button value="x" class="ghost">Schließen</button></header>
   <p>${esc(name)}</p>${drive ? `<p class="muted">${esc(drive)}</p>` : ""}
   <p class="muted">Beim Kunden wurde eine Notiz eingetragen.</p>
   <div class="row wrap"><button class="pri" value="bestteilen">Teilen / per Mail senden</button><button value="bestladen">Herunterladen</button><button value="bestaendern">Ändern</button></div>`);
}
/* ---------- Beanstandungsformular (Word-Vorlage) ---------- */
async function beanstandungFormular(id, werte) {
  if (!(await vorlageHolen("beanstandung"))) { vorlageFehlt(id, "beanstandung"); return; }
  const c = byId(id) || roh(id);
  const e = entwurfLesen(), mitEntwurf = !werte && e && e.art === "beanstandung" && e.id === id;
  const w = werte || (mitEntwurf ? e.w : BF.vorbelegen(c));
  const d = dlg(`<header class="dh"><h3>Beanstandung: ${esc(c.n1)}</h3><button value="x" class="ghost">Abbrechen</button></header>
   ${mitEntwurf ? `<p class="hint">Die letzten Eingaben wurden wiederhergestellt. <button class="link small" value="bfleeren" data-id="${esc(id)}">Neu beginnen</button></p>` : ""}
   ${BF.formularHTML(w)}
   <div class="row"><button class="pri" value="bferstellen" data-id="${esc(id)}">Formular erstellen</button></div>`);
  d.classList.add("breit");
  const form = d.querySelector("form");
  form.oninput = () => { try { localStorage.setItem(ENTWURF_KEY, JSON.stringify({ id, art: "beanstandung", w: BF.werteLesen(form) })); } catch (err) { /* egal */ } };
}
async function beanstandungErstellen(id) {
  const w = BF.werteLesen($("#dlg form"));
  const vorlage = await vorlageHolen("beanstandung");
  if (!vorlage) throw new Error("Vorlage fehlt");
  const docx = BF.ausfuellen(XLSX, vorlage, w), name = BF.dateiname(w);
  BEST = { id, art: "beanstandung", w, pdf: docx, name, typ: BF.DOCX_TYP };
  entwurfWeg();
  const k = roh(id);
  if (k) { k.notes = (k.notes || []).concat({ d: today(), t: "Beanstandung erstellt" + (w.artikel ? ": " + w.artikel : "") + (w.schaden ? " – " + w.schaden.replace(/\s*\n\s*/g, " ") : "") }); geaendert(); }
  let drive = "";
  if (driveBereit()) {
    try { await G.bestellungSpeichern(name, docx, BF.DOCX_TYP, G.BEANSTANDUNG_ORDNER); drive = `In Google Drive › ${G.ORDNER} › ${G.BEANSTANDUNG_ORDNER} gespeichert.`; }
    catch (e) { console.warn(e); drive = "Google Drive war nicht erreichbar – bitte die Datei teilen oder herunterladen."; }
  } else if (G.konfiguriert()) drive = "Nicht mit Google verbunden – die Datei wurde nicht in Google Drive gespeichert.";
  dlg(`<header class="dh"><h3>Beanstandung: fertig</h3><button value="x" class="ghost">Schließen</button></header>
   <p>${esc(name)} (Word-Datei)</p>${drive ? `<p class="muted">${esc(drive)}</p>` : ""}
   <p class="muted">Beim Kunden wurde eine Notiz eingetragen. Fotos bitte beim Teilen in der Mail anhängen.</p>
   <div class="row wrap"><button class="pri" value="bestteilen">Teilen / per Mail senden</button><button value="bestladen">Herunterladen</button><button value="bestaendern">Ändern</button></div>`);
}
function bestellungLaden() {
  if (!BEST) return;
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([BEST.pdf], { type: BEST.typ }));
  a.download = BEST.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
function bestellungTeilen() {
  if (!BEST) return;
  const datei = new File([BEST.pdf], BEST.name, { type: BEST.typ });
  if (navigator.canShare && navigator.canShare({ files: [datei] })) navigator.share({ files: [datei], title: BEST.name }).catch(e => { if (e.name !== "AbortError") bestellungLaden(); });
  else { bestellungLaden(); toast("Teilen geht hier nicht – die Datei wurde heruntergeladen"); }
}

function toast(t) { const el = $("#toast"); el.textContent = t; el.classList.add("on"); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("on"), Math.max(2600, t.length * 55)); }

/* ---------- Start ---------- */
document.addEventListener("click", async e => {
  const db = e.target.closest("#dlg button[value]");
  if (db) {
    e.preventDefault();
    const fx = $("#fxt"); if (db.value === "savefix" && fx && !fx.value) { fx.reportValidity(); return; }
    if (db.value === "wocheplanen") { const w = $("#dlg #ovwahl"); if (!P.ovGueltig(w.value)) { w.reportValidity(); return; } db.dataset.nacht = w.value; }
    if (db.value === "saveappt") { const leer = ["#td", "#tt"].map($).find(x => x && !x.value); if (leer) { leer.reportValidity(); return; } }
    $("#dlg").close();
    try { dlgAktion(db.value, db); } catch (err) { console.error(err); toast("Fehler: " + err.message); }
    return;
  }
  const b = e.target.closest("button,[data-a]"); if (!b) return;
  if (b.dataset.t) { if (DATA) { TAB = b.dataset.t; render(); } return; }
  const a = b.dataset.a; if (!a) return;
  try {
    if (a === "plan") doPlan();
    if (a === "plannext") wocheAnsehen(iso(addDays(parseISO(PLAN().week), 7)));
    if (a === "wloeschen") wocheLoeschen();
    if (a === "feinschliff") reihenfolgeVerbessern(+b.dataset.d);
    if (a === "sichern") { const n = await sicherungAnlegen(uhrzeitJetzt()); render(); toast("Gesichert: " + n); }
    if (a === "tagab") tagAbschliessenDialog(b.dataset.week, +b.dataset.d);
    if (a === "wzeigen") { DATA.plan = planVon(b.dataset.week) || DATA.plan; persist(false); render(); scrollTo(0, 0); }
    if (a === "spalteneu") spalteHinzufuegen();
    if (a === "woche") { if ($("#dlg").open) $("#dlg").close(); wocheAnsehen(b.dataset.datum); }
    if (a === "open") openCustomer(b.dataset.id);
    if (a === "awort") { AUSW.q = AUSW.q.toLowerCase() === b.dataset.w ? "" : b.dataset.w; render(); }
    if (a === "auswexport") auswertungExport();
    if (a === "visit") visitDialog(b.dataset.id);
    if (a === "new") editDialog(null);
    if (a === "fix") fixDialog(+b.dataset.d, b.dataset.id, b.dataset.time);
    if (a === "unfix") { fixWeg(b.dataset.id); geaendert(); toast("Termin wieder offen"); }
    if (a === "alt") alternativeNehmen(+b.dataset.d, b.dataset.id, b.dataset.alt);
    if (a === "export") await exportXlsx(false);
    if (a === "ordnerspeichern") await exportXlsx(true);
    if (a === "ordnerladen") { const r = await Sp.ausOrdnerLaden(); standUebernehmen(r.name, r.daten); }
    if (a === "rm") removeDialog(+b.dataset.d, b.dataset.id);
    if (a === "unhold") { roh(b.dataset.id).hold = false; $("#dlg").close(); geaendert(); toast("Wird wieder eingeplant"); }
    if (a === "fzrechnen") await fzBerechnen(true);
    if (a === "gverbinden") G.anmelden(false);
    if (a === "gtrennen") { G.abmelden(); render(); statusZeigen(); toast("Verbindung zu Google getrennt"); }
  } catch (err) { console.error(err); toast("Fehler: " + err.message); }
});
document.addEventListener("input", e => {
  const t = e.target;
  if (t.id === "aq") { AUSW.q = t.value; const p = t.selectionStart; render(); const q = $("#aq"); q.focus(); q.setSelectionRange(p, p); }
  if (t.id === "q") { FILTER.q = t.value; const p = t.selectionStart; render(); const q = $("#q"); q.focus(); q.setSelectionRange(p, p); }
});
document.addEventListener("change", async e => {
  const t = e.target;
  if (t.id === "fabc") { FILTER.abc = t.value; render(); }
  if (t.id === "azr") { AUSW.zr = t.value; render(); }
  if (t.id === "avon" || t.id === "abis") { AUSW[t.id === "avon" ? "von" : "bis"] = t.value; render(); }
  if (t.id === "fmerkmal") { FILTER.merkmal = t.value; render(); }
  if (t.id === "fdue") { FILTER.due = t.checked; render(); }
  if (t.id === "foh") { FILTER.ohneOh = t.checked; render(); }
  if (t.id === "ftrend") { FILTER.trend = t.checked; render(); }
  if (t.id === "wk" && $("#main #ovwahl") && (!PLAN() || t.value !== PLAN().week)) $("#main #ovwahl").value = ""; // neue Woche: Übernachtung neu wählen
  if (t.id === "abglfile" && t.files[0]) {
    try { await abgleichStarten(t.files[0]); } catch (err) { console.error(err); toast("Liste konnte nicht gelesen werden: " + err.message); }
    t.value = "";
  }
  if ((t.id === "vorlagenfile" || t.id === "vorlagefile") && t.files.length) {
    try {
      await vorlagenEinlesen([...t.files]);
      if (t.id === "vorlagefile" && VORLAGE_FUER && VORLAGEN[VORLAGE_FUER.art]) { const v = VORLAGE_FUER; VORLAGE_FUER = null; await (v.art === "beanstandung" ? beanstandungFormular(v.id) : bestellFormular(v.id, v.art)); }
      else if (t.id === "vorlagenfile") render();
    } catch (err) { console.error(err); toast("Vorlage konnte nicht gelesen werden: " + err.message); }
    t.value = "";
  }
  if (t.id === "xlsxfile" && t.files[0]) {
    try { standUebernehmen(t.files[0].name, await t.files[0].arrayBuffer()); }
    catch (err) { console.error(err); toast("Datei konnte nicht gelesen werden: " + err.message); }
  }
  if (t.dataset.s) {
    const k = t.dataset.s;
    DATA.einst[k] = t.type === "checkbox" ? t.checked : t.dataset.zahl ? +t.value : (t.type === "number" ? (t.value === "" ? DEFAULTS[k] : +t.value) : t.value.trim());
    if (k === "start") DATA.einst.startKoord = ""; // neue Adresse: Lage aus der PLZ bestimmen
    persist(); aufbereiten(); if (["grundlage", "orsKey", "start", "umsatzJahr", "umsatzStand", "trendBevorzugen", "lvNutzen"].includes(k)) render(); toast("Einstellung gespeichert");
    if (k === "start" && DATA.einst.orsKey) fzBerechnen(false);
    if (k === "orsKey" && DATA.einst.orsKey) fzBerechnen(true);
    if (k === "calSync" && DATA.einst.calSync) planeAbgleich();
  }
});

/* ---------- Start ---------- */
// Ist die Google-Anmeldung abgelaufen, still neu anmelden (höchstens alle 10 Minuten, damit es keine Schleife gibt)
function stillAnmelden() {
  if (!G.konfiguriert() || G.angemeldet() || !G.warVerbunden() || !navigator.onLine) return false;
  let zuletzt = 0; try { zuletzt = +sessionStorage.getItem("tourenplaner-still") || 0; } catch (e) { /* egal */ }
  if (Date.now() - zuletzt < 10 * 60e3) return false;
  try { sessionStorage.setItem("tourenplaner-still", String(Date.now())); } catch (e) { /* egal */ }
  G.anmelden(true); return true;
}
(async () => {
  const rueck = G.rueckkehrVerarbeiten();
  DATA = Sp.laden();
  if (DATA) kundenNormalisieren(DATA.kunden); // ältere Stände (Umsatz 25/24 als feste Felder) umstellen
  fzLadenLokal();
  ORDNER = await Sp.ordnerVerfuegbar();
  if (DATA) persist(false);
  render();
  if (rueck && rueck.fehler && !/interaction_required|login_required|consent_required/.test(rueck.fehler)) toast("Google-Anmeldung nicht erfolgt (" + rueck.fehler + ")");
  if (G.konfiguriert()) {
    if (G.angemeldet()) { if (rueck && rueck.ok) { await G.kontoLaden().catch(() => {}); toast("Mit Google verbunden"); } abgleichen(); }
    else if (!rueck && stillAnmelden()) return;
  }
  if (DATA) fzBerechnen(false);
  vorlagenPruefen().then(vorlagenAusOrdner).then(() => { if (TAB === "set") render(); return vorlagenNachDrive(); }).catch(e => console.warn(e));
  setInterval(() => { if (document.visibilityState === "visible") abgleichen(); }, 5 * 60e3);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { if (!stillAnmelden()) abgleichen(); } });
  addEventListener("online", () => { statusZeigen(); abgleichen(); if (DATA) fzBerechnen(false); });
  addEventListener("offline", statusZeigen);
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
