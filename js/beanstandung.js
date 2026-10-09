// Beanstandungsformular (Reklamationsbericht, Word-Vorlage): Eingabe in der App, Ausgabe als ausgefüllte Original-Word-Datei.
// Die Vorlage enthält Firmenangaben und gehört deshalb NICHT in den öffentlichen Programmcode (wie die PDF-Vorlagen).
// Aufbau der Vorlage: ein Bild des Formulars, darüber Textfelder („Textfeld 2“, „Textfeld 13“ …). Jedes Textfeld steht
// doppelt in der Datei (neues Word: wps, altes Word: VML) – beide werden gleich gefüllt. Entpacken mit XLSX.CFB.
import { esc, today, fmtD } from "./grundlagen.js";

export const TITEL = "Beanstandung";
export const DOCX_TYP = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Textfelder: Schlüssel -> Nummer(n) des Textfelds (zwei Nummern = zwei Zeilen)
const TEXT = [
  { k: "nr", l: "Reklamationsbericht Nr.", f: [59] }, { k: "datum", l: "Datum", f: [58] },
  { k: "kd", l: "Kunden-Nr.", f: [2] }, { k: "kunde", l: "Kunde", f: [13], breit: 1 }, { k: "anschrift", l: "Anschrift", f: [15], breit: 1 }, { k: "plzort", l: "PLZ & Ort", f: [17], breit: 1 },
  { k: "ev", l: "Endverbraucher", f: [18], breit: 1 }, { k: "ev_anschrift", l: "Anschrift", f: [22], breit: 1 }, { k: "ev_plzort", l: "PLZ & Ort", f: [24], breit: 1 },
  { k: "artikel", l: "Artikelname", f: [25], breit: 1 }, { k: "menge", l: "Menge", f: [26], m: "decimal" }, { k: "rechnung", l: "Rechnungs-Nr.", f: [27] },
  { k: "verwendung", l: "Verwendung", f: [28, 29], zeilen: 2 }, { k: "schaden", l: "Schadensbild", f: [33, 34], zeilen: 2 },
  { k: "loesung", l: "Lösungsvorschlag", f: [35, 36], zeilen: 2 },
];
// Kästchen (im Textfeld steht dann ein „x“). 61 gibt es in der Vorlage nicht – es wird bei Bedarf ergänzt (siehe NEU).
export const GRUPPEN = [
  { k: "zustand", l: "Zustand", eins: true, opt: [["gepflegt", 49], ["leicht angeschmutzt", 52], ["stark angeschmutzt", 55]] },
  { k: "gebrauch", l: "Gebrauchsspuren", eins: true, opt: [["normal", 50], ["mittel", 53], ["stark", 61]] },
  { k: "hinweis", l: "Allg. Hinweise", opt: [["Haustiere", 51], ["Jeansträger", 54], ["Kleinkinder", 56]] },
  { k: "schaden", l: "Beschädigungen", opt: [["Anfärbung (Textilfarbe)", 39], ["Druckstellen", 43], ["Durchgescheuert", 46], ["Polausfall", 40], ["Pilling", 44],
    ["Sitzspiegel", 48], ["Verblichen", 41], ["Verfärbt", 45], ["Verschleiß", 47], ["Webfehler", 42]] },
  { k: "beilage", l: "Beigefügt", opt: [["Polsterteil beigefügt", 37], ["Foto beigefügt", 38]] },
];
// fehlendes Kästchen „Gebrauchsspuren: stark“: Kopie von Textfeld 56 (Spalte rechts) in der Zeile von Textfeld 53
const NEU = { nr: 61, vorbild: 56, zeile: 53 };
const ALLE = [...TEXT.flatMap(t => t.f), ...GRUPPEN.flatMap(g => g.opt.map(o => o[1]))].filter(n => n !== NEU.nr);

/* ---------- Word-Datei ---------- */
const xml = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const bloecke = doc => [...doc.matchAll(/<mc:AlternateContent>[\s\S]*?<\/mc:AlternateContent>/g)].map(m => ({ start: m.index, ende: m.index + m[0].length, xml: m[0] }));
const block = (B, n) => B.find(b => b.xml.includes(`name="Textfeld ${n}"`));
function dokument(XLSX, bytes) {
  const cfb = XLSX.CFB.read(new Uint8Array(bytes), { type: "array" });
  const e = XLSX.CFB.find(cfb, "/word/document.xml"); if (!e) throw new Error("Keine Word-Datei");
  return { cfb, e, text: new TextDecoder().decode(e.content) };
}
// Ist das die Beanstandungs-Vorlage?
export function erkennen(XLSX, bytes) {
  try { const B = bloecke(dokument(XLSX, bytes).text); return ALLE.every(n => block(B, n)); } catch (e) { return false; }
}
// Inhalt eines Textfelds ersetzen (Schrift und Farbe aus dem ersten Absatz des Textfelds)
function fuellen(b, text) {
  const alt = b.match(/<w:txbxContent>[\s\S]*?<\/w:txbxContent>/)[0];
  const pPr = (alt.match(/<w:pPr>[\s\S]*?<\/w:pPr>/) || [""])[0], rPr = (pPr.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [""])[0];
  const neu = `<w:txbxContent><w:p>${pPr}${text ? `<w:r>${rPr}<w:t xml:space="preserve">${xml(text)}</w:t></w:r>` : ""}</w:p></w:txbxContent>`;
  return b.replace(/<w:txbxContent>[\s\S]*?<\/w:txbxContent>/g, () => neu);
}
// Text auf zwei Zeilen verteilen (Zeilenumbruch des Nutzers, sonst am Wortende nach höchstens ~78 Zeichen)
export function zweiZeilen(t, max = 78) {
  t = String(t || "").trim();
  const nl = t.indexOf("\n");
  if (nl >= 0) return [t.slice(0, nl).trim(), t.slice(nl + 1).replace(/\s*\n\s*/g, " ").trim()];
  if (t.length <= max) return [t, ""];
  let i = t.lastIndexOf(" ", max); if (i < max / 2) i = max;
  return [t.slice(0, i).trim(), t.slice(i).trim()];
}
// fehlendes Kästchen anlegen: Kopie des Vorbilds mit neuer Nummer, Position aus der Zeile des anderen Kästchens
function neuesKaestchen(B, alleIds) {
  const v = block(B, NEU.vorbild).xml, z = block(B, NEU.zeile).xml;
  const vPos = z.match(/<wp:positionV[\s\S]*?<\/wp:positionV>/)[0], vTop = z.match(/margin-top:[^;]+;/)[0];
  const id = Math.max(...alleIds) + 1, hex = (parseInt(v.match(/wp14:anchorId="([0-9A-F]+)"/)[1], 16) + 7919).toString(16).toUpperCase().padStart(8, "0").slice(-8);
  return v.replace(/<wp:positionV[\s\S]*?<\/wp:positionV>/, vPos).replace(/margin-top:[^;]+;/, vTop)
    .replace(/<wp:docPr id="\d+" name="Textfeld \d+"/, `<wp:docPr id="${id}" name="Textfeld ${NEU.nr}"`).replace(/id="Textfeld \d+"/, `id="Textfeld ${NEU.nr}"`)
    .replace(/o:spid="_x0000_s\d+"/, `o:spid="_x0000_s${2000 + id}"`).replace(/wp14:anchorId="[0-9A-F]+"/g, `wp14:anchorId="${hex}"`)
    .replace(/ o:gfxdata="[^"]*"/, "");
}
// Füllt die Vorlage aus (w: { schlüssel: text, "gruppe:option": true, zustand/gebrauch: option }). Rückgabe: Uint8Array der .docx
export function ausfuellen(XLSX, bytes, w) {
  const { cfb, e, text } = dokument(XLSX, bytes);
  const B = bloecke(text), werte = new Map(); // Textfeld-Nr. -> Text
  for (const t of TEXT) {
    const z = t.zeilen ? zweiZeilen(w[t.k]) : [String(w[t.k] || "").replace(/\s*\n\s*/g, ", ")];
    t.f.forEach((n, i) => werte.set(n, z[i] || ""));
  }
  for (const g of GRUPPEN) for (const [o, n] of g.opt) werte.set(n, (g.eins ? w[g.k] === o : w[g.k + ":" + o]) ? "x" : "");
  const ids = [...text.matchAll(/<wp:docPr id="(\d+)"/g)].map(m => +m[1]);
  const teile = [];
  for (const [n, t] of werte) {
    if (n === NEU.nr) continue;
    const b = block(B, n); if (!b) throw new Error("Vorlage passt nicht (Textfeld " + n + ")");
    let x = fuellen(b.xml, t);
    if (n === NEU.vorbild && werte.get(NEU.nr) && !block(B, NEU.nr)) x += `</w:r><w:r><w:rPr><w:noProof/></w:rPr>` + fuellen(neuesKaestchen(B, ids), "x");
    teile.push({ b, x });
  }
  let doc = text;
  teile.sort((a, b) => b.b.start - a.b.start).forEach(({ b, x }) => { doc = doc.slice(0, b.start) + x + doc.slice(b.ende); });
  e.content = new TextEncoder().encode(doc);
  const dateien = cfb.FileIndex.map((f, i) => ({ f, pfad: cfb.FullPaths[i].replace(/^Root Entry\//, "") }))
    .filter(({ f, pfad }) => f.type === 2 && f.content && !/Sh33tJ5$/.test(pfad)).map(({ f, pfad }) => ({ name: pfad, daten: new Uint8Array(f.content) }));
  return zip(dateien);
}

/* ---------- Zip ohne Komprimierung („stored“), Reihenfolge wie im Original ---------- */
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = b => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(dateien) {
  const enc = new TextEncoder(), teile = [], zentral = [], DATUM = (1 << 5) | 1; // 01.01.1980 wie in Word-Dateien
  const kopf = (sig, n) => { const b = new DataView(new ArrayBuffer(n)); b.setUint32(0, sig, true); return b; };
  let pos = 0;
  for (const { name, daten } of dateien) {
    const nm = enc.encode(name), crc = crc32(daten);
    const l = kopf(0x04034b50, 30);
    l.setUint16(4, 20, true); l.setUint16(6, 0x0800, true); l.setUint16(12, DATUM, true);
    l.setUint32(14, crc, true); l.setUint32(18, daten.length, true); l.setUint32(22, daten.length, true); l.setUint16(26, nm.length, true);
    const z = kopf(0x02014b50, 46);
    z.setUint16(4, 20, true); z.setUint16(6, 20, true); z.setUint16(8, 0x0800, true); z.setUint16(14, DATUM, true);
    z.setUint32(16, crc, true); z.setUint32(20, daten.length, true); z.setUint32(24, daten.length, true); z.setUint16(28, nm.length, true); z.setUint32(42, pos, true);
    teile.push(new Uint8Array(l.buffer), nm, daten); zentral.push(new Uint8Array(z.buffer), nm);
    pos += 30 + nm.length + daten.length;
  }
  const e = kopf(0x06054b50, 22);
  e.setUint16(8, dateien.length, true); e.setUint16(10, dateien.length, true); e.setUint32(12, zentral.reduce((s, b) => s + b.length, 0), true); e.setUint32(16, pos, true);
  const alle = [...teile, ...zentral, new Uint8Array(e.buffer)], out = new Uint8Array(alle.reduce((s, b) => s + b.length, 0));
  let o = 0; for (const b of alle) { out.set(b, o); o += b.length; }
  return out;
}

/* ---------- Eingabe in der App ---------- */
const vorlaeufig = id => /^N/.test(String(id));
// Kunden-Nr., Kunde, Anschrift, PLZ & Ort und Datum aus den Kundendaten
export function vorbelegen(c) {
  return { kd: vorlaeufig(c.id) ? "" : c.id, kunde: c.n1 || "", anschrift: c.str || "", plzort: [c.plz, c.ort].filter(Boolean).join(" "), datum: fmtD(today()) };
}
const feld = k => TEXT.find(t => t.k === k);
const inp = (k, w) => { const f = feld(k); return f.zeilen
  ? `<label class="bbreit">${esc(f.l)}<textarea data-r="${k}" rows="2">${esc(w[k] || "")}</textarea></label>`
  : `<label${f.breit ? ' class="bbreit"' : ""}>${esc(f.l)}<input data-r="${k}" value="${esc(w[k] || "")}" autocomplete="off" ${f.m ? `inputmode="${f.m}"` : ""}></label>`; };
const fs = (titel, inhalt) => `<fieldset class="bgr"><legend>${esc(titel)}</legend><div class="bgrid">${inhalt}</div></fieldset>`;
const gruppe = (g, w) => g.eins
  ? `<label>${esc(g.l)}<select data-r="${g.k}"><option value="">–</option>${g.opt.map(([o]) => `<option ${w[g.k] === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label>`
  : `<div class="bopt bbreit"><span>${esc(g.l)}</span>${g.opt.map(([o]) => `<label class="chk"><input type="checkbox" data-r="${esc(g.k + ":" + o)}" ${w[g.k + ":" + o] ? "checked" : ""}> ${esc(o)}</label>`).join("")}</div>`;
const G = k => GRUPPEN.find(g => g.k === k);

export function formularHTML(w) {
  return fs("Bericht", inp("nr", w) + inp("datum", w))
    + fs("Kunde", inp("kd", w) + inp("kunde", w) + inp("anschrift", w) + inp("plzort", w))
    + fs("Endverbraucher", inp("ev", w) + inp("ev_anschrift", w) + inp("ev_plzort", w))
    + fs("Artikel", inp("artikel", w) + inp("menge", w) + inp("rechnung", w) + inp("verwendung", w))
    + fs("Zustand", gruppe(G("zustand"), w) + gruppe(G("gebrauch"), w) + gruppe(G("hinweis"), w))
    + fs("Schaden", inp("schaden", w) + gruppe(G("schaden"), w))
    + fs("Lösung", inp("loesung", w) + gruppe(G("beilage"), w))
    + `<fieldset class="bgr"><legend>Fotos</legend>
       <label class="fotoknopf">Foto aufnehmen oder auswählen<input type="file" id="bffotos" accept="image/*" multiple></label>
       <div id="bffotoliste" class="fotos"></div>
       <p class="hint">Fotos werden beim Teilen zusammen mit der Word-Datei verschickt und in Google Drive abgelegt; „Foto beigefügt“ wird dann automatisch angekreuzt.</p></fieldset>`
    + `<p class="hint">Zweizeilige Felder: Ein Zeilenumbruch beginnt die zweite Zeile, sonst wird nach etwa 78 Zeichen umbrochen.</p>`;
}
// Foto für die Mail verkleinern (längste Seite höchstens 2048 Pixel, JPEG). Klappt das nicht, bleibt das Original.
export async function fotoVerkleinern(datei, max = 2048) {
  try {
    const url = URL.createObjectURL(datei);
    const img = await new Promise((ok, fehler) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fehler; i.src = url; });
    URL.revokeObjectURL(url);
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = document.createElement("canvas"); cv.width = Math.round(img.naturalWidth * s); cv.height = Math.round(img.naturalHeight * s);
    cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
    const blob = await new Promise(ok => cv.toBlob(ok, "image/jpeg", 0.85));
    return blob && blob.size ? blob : datei;
  } catch (e) { return datei; }
}
export function werteLesen(root) {
  const w = {};
  root.querySelectorAll("[data-r]").forEach(el => { const v = el.type === "checkbox" ? el.checked : el.value.trim(); if (v) w[el.dataset.r] = v; });
  return w;
}
export function dateiname(w) {
  const d = new Date(), z = n => String(n).padStart(2, "0");
  const teil = s => String(s || "").replace(/[\\/:*?"<>|]+/g, " ").trim().replace(/\s+/g, "_").slice(0, 40);
  return ["Beanstandung", teil(w.kunde), `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}`].filter(Boolean).join("_") + ".docx";
}
