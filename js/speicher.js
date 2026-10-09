// Speichert den Stand auf diesem Gerät (im Browser). Später kommt Google Drive als gemeinsamer Speicher dazu.
const KEY = "tourenplaner-v2", KEY_VORHER = "tourenplaner-v2-vorher";

export function laden() {
  try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; }
}
export function speichern(daten) {
  try { localStorage.setItem(KEY, JSON.stringify(daten)); return true; } catch (e) { return false; }
}
// Vor dem Einlesen einer neuen Excel-Datei den alten Stand aufheben.
export function sichern() {
  try { const s = localStorage.getItem(KEY); if (s) localStorage.setItem(KEY_VORHER, s); } catch (e) { /* egal */ }
}

/* ---------- Ordner auf dem Rechner (nur wenn die App über werkzeuge/server.js läuft) ---------- */
const H = { "X-Tourenplaner": "1" };
export async function ordnerVerfuegbar() {
  try { const r = await fetch("lokal/info", { headers: H }); return r.ok ? await r.json() : null; } catch (e) { return null; }
}
export async function ausOrdnerLaden() {
  const r = await fetch("lokal/stand", { headers: H });
  if (!r.ok) throw new Error(await r.text());
  return { name: decodeURIComponent(r.headers.get("X-Dateiname") || ""), daten: await r.arrayBuffer() };
}
export async function inOrdnerSpeichern(daten) {
  const r = await fetch("lokal/stand", { method: "POST", headers: H, body: daten });
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()).datei;
}

/* ---------- Dateien auf dem Gerät (IndexedDB), z. B. die PDF-Vorlagen der Bestellformulare ---------- */
function db() {
  return new Promise((ok, fehler) => {
    const r = indexedDB.open("tourenplaner-dateien", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("dateien");
    r.onsuccess = () => ok(r.result); r.onerror = () => fehler(r.error);
  });
}
async function vorgang(modus, fn) {
  const d = await db();
  return new Promise((ok, fehler) => {
    const t = d.transaction("dateien", modus), r = fn(t.objectStore("dateien"));
    t.oncomplete = () => { d.close(); ok(r && r.result); }; t.onerror = t.onabort = () => { d.close(); fehler(t.error); };
  });
}
export async function dateiLesen(name) { try { return await vorgang("readonly", s => s.get(name)) || null; } catch (e) { return null; } }
export async function dateiAblegen(name, daten) { return vorgang("readwrite", s => s.put(daten, name)); }

// Formular-Vorlagen (PDF/Word) aus dem Ordner „Vorlagen“ (nur wenn die App über werkzeuge/server.js läuft)
export async function vorlagenImOrdner() {
  try { const r = await fetch("lokal/vorlagen", { headers: H }); return r.ok ? await r.json() : []; } catch (e) { return []; }
}
export async function vorlageAusOrdner(name) {
  const r = await fetch("lokal/vorlage?n=" + encodeURIComponent(name), { headers: H });
  if (!r.ok) throw new Error(await r.text());
  return r.arrayBuffer();
}
