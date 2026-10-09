// Anmeldung bei Google und Zugriff auf Google Drive und Google Kalender – direkt vom Gerät aus, ohne eigenen Server.
// Rechte: nur Dateien, die der Tourenplaner selbst angelegt hat (drive.file), und Kalendertermine (calendar.events).
import { GOOGLE_CLIENT_ID } from "./konfig.js";

const SCOPES = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/calendar.events";
const KEY = "tourenplaner-google";
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const KAL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
export const STAND_DATEI = "Tourenplaner_Stand.xlsx", FAHRZEIT_DATEI = "Tourenplaner_Fahrzeiten.json", ORDNER = "Tourenplaner";

export const konfiguriert = () => !!GOOGLE_CLIENT_ID;
function lesen() { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { return {}; } }
function schreiben(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* egal */ } }
export const angemeldet = () => { const g = lesen(); return !!g.token && g.bis > Date.now() + 60e3; };
export const warVerbunden = () => !!lesen().verbunden;
export const email = () => lesen().email || "";

/* ---------- Anmeldung (Weiterleitung zu Google und zurück) ---------- */
export function anmelden(still = false) {
  const g = lesen(); g.state = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join(""); schreiben(g);
  const p = new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, redirect_uri: location.origin + location.pathname, response_type: "token", scope: SCOPES, include_granted_scopes: "true", state: g.state });
  if (still) p.set("prompt", "none");
  if (g.email) p.set("login_hint", g.email);
  location.assign("https://accounts.google.com/o/oauth2/v2/auth?" + p);
}
// Nach der Rückkehr von Google: Zugangsschlüssel aus der Adresse übernehmen. Ergebnis: null (keine Rückkehr), {ok} oder {fehler}
export function rueckkehrVerarbeiten() {
  if (!/access_token|error=/.test(location.hash)) return null;
  const h = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, "", location.pathname + location.search);
  const g = lesen();
  if (!g.state || h.get("state") !== g.state) return { fehler: "Anmeldung nicht bestätigt" };
  delete g.state;
  if (h.get("error")) { schreiben(g); return { fehler: h.get("error") }; }
  g.token = h.get("access_token"); g.bis = Date.now() + (+h.get("expires_in") || 3600) * 1000; g.verbunden = true;
  schreiben(g); return { ok: true };
}
export function abmelden() {
  const g = lesen();
  if (g.token) fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(g.token), { method: "POST" }).catch(() => {});
  schreiben({});
}

async function api(url, opt = {}, erlaubt = []) {
  const g = lesen();
  if (!angemeldet()) throw Object.assign(new Error("Nicht mit Google verbunden"), { code: "anmelden" });
  const r = await fetch(url, { ...opt, headers: { ...(opt.headers || {}), Authorization: "Bearer " + g.token } });
  if (r.status === 401) { g.token = null; schreiben(g); throw Object.assign(new Error("Google-Anmeldung abgelaufen"), { code: "anmelden" }); }
  if (!r.ok && !erlaubt.includes(r.status)) throw Object.assign(new Error("Google meldet Fehler " + r.status), { code: "google", status: r.status, text: await r.text().catch(() => "") });
  return r;
}
export async function kontoLaden() {
  const r = await api("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)");
  const e = (await r.json()).user?.emailAddress || ""; const g = lesen(); g.email = e; schreiben(g); return e;
}

/* ---------- Google Drive ---------- */
const q = s => encodeURIComponent(s);
async function suchen(bedingung) {
  const r = await api(`${DRIVE}?q=${q(bedingung + " and trashed=false")}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&spaces=drive`);
  return (await r.json()).files || [];
}
async function ordnerId() {
  const g = lesen(); if (g.ordner) return g.ordner;
  const f = await suchen(`name='${ORDNER}' and mimeType='application/vnd.google-apps.folder' and 'root' in parents`);
  let id = f[0]?.id;
  if (!id) {
    const r = await api(DRIVE + "?fields=id", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: ORDNER, mimeType: "application/vnd.google-apps.folder" }) });
    id = (await r.json()).id;
  }
  const g2 = lesen(); g2.ordner = id; schreiben(g2); return id;
}
// Infos zur Datei im Ordner "Tourenplaner": { id, modifiedTime } oder null
export async function dateiInfo(name) {
  const o = await ordnerId();
  return (await suchen(`name='${name}' and '${o}' in parents`))[0] || null;
}
export async function dateiLaden(id) { return (await api(`${DRIVE}/${id}?alt=media`)).arrayBuffer(); }
export async function dateiSpeichern(name, inhalt, typ, id) {
  if (id) {
    const r = await api(`${UPLOAD}/${id}?uploadType=media&fields=id,modifiedTime`, { method: "PATCH", headers: { "Content-Type": typ }, body: inhalt }, [404]);
    if (r.ok) return r.json();
  }
  return anlegen(name, inhalt, typ, await ordnerId());
}
// Neue Datei in einem Ordner anlegen
async function anlegen(name, inhalt, typ, ordner) {
  const grenze = "tourenplaner" + Date.now();
  const kopf = `--${grenze}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [ordner] })}\r\n--${grenze}\r\nContent-Type: ${typ}\r\n\r\n`;
  const body = new Blob([kopf, inhalt, `\r\n--${grenze}--`]);
  const r = await api(`${UPLOAD}?uploadType=multipart&fields=id,modifiedTime`, { method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + grenze }, body });
  return r.json();
}

/* ---------- Unterordner im Ordner „Tourenplaner“ („Sicherungen“, „Bestellungen“) ---------- */
export const SICHERUNG_ORDNER = "Sicherungen", BESTELL_ORDNER = "Bestellungen";
const ORDNER_KEY = { [SICHERUNG_ORDNER]: "sicherungen", [BESTELL_ORDNER]: "bestellungen" };
async function unterordner(name, neuSuchen) {
  const key = ORDNER_KEY[name];
  const g = lesen(); if (g[key] && !neuSuchen) return g[key];
  const o = await ordnerId();
  const f = await suchen(`name='${name}' and mimeType='application/vnd.google-apps.folder' and '${o}' in parents`);
  let id = f[0]?.id;
  if (!id) {
    const r = await api(DRIVE + "?fields=id", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [o] }) });
    id = (await r.json()).id;
  }
  const g2 = lesen(); g2[key] = id; schreiben(g2); return id;
}
const sicherungsOrdner = neu => unterordner(SICHERUNG_ORDNER, neu);
// Ausgefülltes Bestellformular in „Tourenplaner › Bestellungen“ ablegen
export async function bestellungSpeichern(name, inhalt) {
  for (const neu of [false, true]) {
    try { return await anlegen(name, inhalt, "application/pdf", await unterordner(BESTELL_ORDNER, neu)); }
    catch (e) { if (neu || e.code === "anmelden") throw e; }
  }
}
// Sicherungskopie ablegen; eine vorhandene Datei mit gleichem Namen bleibt unangetastet (Rückgabe dann null)
export async function sicherungSpeichern(name, inhalt, typ) {
  for (const neu of [false, true]) { // falls der Ordner inzwischen gelöscht wurde: einmal neu suchen/anlegen
    try {
      const o = await sicherungsOrdner(neu);
      if ((await suchen(`name='${name}' and '${o}' in parents`)).length) return null;
      return await anlegen(name, inhalt, typ, o);
    } catch (e) { if (neu || e.code === "anmelden") throw e; }
  }
}

/* ---------- Google Kalender ---------- */
// Legt einen Termin an oder ändert ihn; es werden keine Einladungen verschickt. Rückgabe: Termin-ID
export async function terminEintragen(body, evId) {
  if (evId) {
    const r = await api(`${KAL}/${encodeURIComponent(evId)}?sendUpdates=none`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, [404, 410]);
    if (r.ok) return (await r.json()).id;
  }
  const r = await api(`${KAL}?sendUpdates=none`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return (await r.json()).id;
}
export async function terminLoeschen(evId) {
  await api(`${KAL}/${encodeURIComponent(evId)}?sendUpdates=none`, { method: "DELETE" }, [404, 410]);
}
