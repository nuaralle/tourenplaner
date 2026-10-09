// Bestellformulare (Meterkonfektion, Flächenvorhang, Faltrollo): Eingabe in der App, Ausgabe als ausgefülltes Original-PDF.
// Die PDF-Vorlagen enthalten Firmenangaben und gehören deshalb NICHT in den öffentlichen Programmcode:
// Sie werden einmal ausgewählt (Einstellungen) und liegen dann auf dem Gerät und im eigenen Google Drive.
// Die Felder der Vorlagen werden über ihre Lage auf der Seite gefunden (Punkt in PDF-Koordinaten, Ursprung unten links).
import { esc, today, fmtD } from "./grundlagen.js";

// Kopf – bei allen drei Formularen an derselben Stelle
const KOPF = [
  { k: "kd", l: "Kunden-Nr.", p: [179, 505] }, { k: "bestellnr", l: "Bestell-Nr.", p: [445, 505] },
  { k: "firma", l: "Firmenname", p: [718, 505] }, { k: "ap", l: "Ansprechpartner", p: [193, 481] },
  { k: "datum", l: "Datum", p: [437, 481] }, { k: "str", l: "Straße", p: [704, 481] },
  { k: "kommission", l: "Kommission", p: [182, 458] }, { k: "plzort", l: "PLZ, Ort", p: [708, 458] },
];
const ART_P = { angebot: [307, 451], bestellung: [387, 451] };
const UNTERSCHRIFT = [569, 44, 239, 71]; // falls die Vorlage kein Unterschriftsfeld hat
const zusatz = y => ({ l: "Zusätzlicher Artikel", hinweis: "Bitte bei zusätzlichem Artikel angeben", felder: [
  { k: "z_art", l: "Artikel-Nr.", p: [708, y[0]] }, { k: "z_farb", l: "Farb-Nr.", p: [708, y[1]] },
  { k: "z_hoehe", l: "Höhe", p: [708, y[2]] }, { k: "z_breite", l: "Breite", p: [708, y[3]] }] });

// Spalten: typ "text" (Standard), "haken" (mehrere Kästchen, z. B. links/mitte/rechts) oder "wahl" (eins von mehreren, im PDF ein „X“)
export const FORMULARE = {
  meterkonfektion: {
    titel: "Meterkonfektion", zeilen: [358, 335, 313, 290, 267, 245],
    spalten: [
      { k: "anzahl", l: "Anzahl", x: 81, m: "numeric" },
      { k: "seite", l: "Seite", typ: "haken", opt: [["links", 107], ["mitte", 130], ["rechts", 153]] },
      { k: "artikel", l: "Artikel-Nr. / Farb-Nr.", x: 227, breit: 1 },
      { k: "schnitt", l: "Schnittbreite und/oder Anzahl der Stoffbahnen", x: 321, breit: 1 },
      { k: "dekbreite", l: "Dekorierte Breite (cm)", x: 383, m: "decimal" },
      { k: "hoehe", l: "Fertige Höhe (cm)", x: 431, m: "decimal" },
      { k: "koepfchen", l: "Köpfchen (cm) *", x: 467, m: "decimal" },
      { k: "band", l: "Gardinenband Artikel-Nr.", x: 512 },
      { k: "zugabe", l: "Zugabe 1:", x: 577, m: "decimal" },
      { k: "saumd", l: "Saum doppelt (cm) *", x: 616, m: "decimal" },
      { k: "saume", l: "Saum einfach (cm) *", x: 652, m: "decimal" },
      { k: "anm", l: "Anmerkungen (z. B. Schnittmaß, Rapport)", x: 738, breit: 1 },
    ],
    gruppen: [
      { l: "Zusätzliche Konfektionsleistung – Abfütterung", felder: [
        { k: "abf_std", l: "Standard", typ: "haken", p: [38, 182] }, { k: "abf_sack", l: "Sack", typ: "haken", p: [38, 166] },
        { k: "abf_frei", l: "Freihängend", typ: "haken", p: [38, 149] },
        { k: "abf_art", l: "Artikel-Nr.", p: [101, 135] }, { k: "abf_farb", l: "Farb-Nr.", p: [98, 119] }] },
      { l: "Oberer Abschluss", felder: [
        { k: "ob_universal", l: "Universalband", typ: "haken", p: [265, 199] }, { k: "ob_falten", l: "Faltenband", typ: "haken", p: [265, 182] },
        { k: "ob_doppelstab", l: "Doppelstabfalte", typ: "haken", p: [265, 166] }, { k: "ob_stab", l: "Stabfalte", typ: "haken", p: [265, 149] },
        { k: "ob_wellen", l: "Wellenband", typ: "haken", p: [265, 132] }, { k: "ob_flaemisch", l: "Flämische Falte", typ: "haken", p: [265, 116] }] },
      { l: "Sonstiges", felder: [
        { k: "oesen", l: "Ösen", typ: "haken", p: [374, 199] }, { k: "oesen_d", l: "Ösen ø", p: [445, 202] },
        { k: "oesen_farb", l: "Ösen Farb-Nr.", p: [456, 185] },
        { k: "nicht_rapport", l: "nicht rapportgerechte Verarbeitung", typ: "haken", p: [374, 149] }] },
      zusatz([190, 171, 154, 135]),
    ],
    fussnote: "* Ohne Angabe: Köpfchenhöhe 0,5 cm und Saum in Standardhöhe.",
  },
  flaechenvorhang: {
    titel: "Flächenvorhang", zeilen: [369, 346, 323, 300, 277, 255],
    spalten: [
      { k: "anzahl", l: "Anzahl der Flächen", x: 94, m: "numeric" },
      { k: "artikel", l: "Artikel-Nr. / Farb-Nr.", x: 196, breit: 1 },
      { k: "breite", l: "Breite der Flächen (cm)", x: 298, m: "decimal" },
      { k: "hoehe", l: "Höhe der Flächen (cm)", x: 355, m: "decimal" },
      { k: "anm", l: "Anmerkungen", x: 595, breit: 1 },
    ],
    gruppen: [],
  },
  faltrollo: {
    titel: "Faltrollo", zeilen: [369, 346, 323, 300, 278, 255],
    spalten: [
      { k: "anzahl", l: "Anzahl", x: 81, m: "numeric" },
      { k: "artikel", l: "Artikel-Nr. / Farb-Nr.", x: 153, breit: 1 },
      { k: "breite", l: "Fertige Breite (cm)", x: 238, m: "decimal" },
      { k: "hoehe", l: "Fertige Höhe (cm)", x: 295, m: "decimal" },
      { k: "bedienung", l: "Bedienung", typ: "wahl", opt: [["links", 349], ["rechts", 400]] },
      { k: "kette", l: "Ketten-/Zuglänge (cm) *", x: 451, m: "decimal" },
      { k: "anm", l: "Anmerkungen (z. B. Reihenmontage links, mitte, rechts)", x: 559, breit: 1 },
      { k: "zubehoer", l: "Zubehör (z. B. Klemmträger)", x: 726, breit: 1 },
    ],
    gruppen: [
      { l: "Varianten", felder: [
        { k: "v_vertikal", l: "Vertikalbänder", typ: "haken", p: [38, 199] }, { k: "v_quer", l: "Querbänder", typ: "haken", p: [38, 182] },
        { k: "v_biesen", l: "Biesen hinten", typ: "haken", p: [38, 166] }] },
      { l: "Typ", felder: [
        { k: "t_ohne", l: "ohne Abschluss", typ: "haken", p: [143, 199] },
        { k: "t_gerade", l: "gerader Abschluss mit Höhe 15 cm", typ: "haken", p: [143, 182] }] },
      { l: "Technik", felder: [
        { k: "te_silent", l: "Silent Gliss 2210", typ: "haken", p: [282, 199] },
        { k: "te_eigen", l: "Technik des Lieferanten (laut Formular)", typ: "haken", p: [282, 182] },
        { k: "te_ohne", l: "ohne Technik", typ: "haken", p: [282, 166] }] },
      { l: "Sonstiges", felder: [
        { k: "einfaedeln", l: "einfädeln (bei Bestellung ohne Technik bitte verwendete Technik angeben)", typ: "haken", p: [282, 132] },
        { k: "nicht_rapport", l: "nicht rapportgerechte Verarbeitung", typ: "haken", p: [282, 83] }] },
      zusatz([191, 171, 154, 135]),
    ],
    fussnote: "* Ohne Angabe wird nach EU-Norm 13120 konfektioniert.",
  },
};
export const ARTEN = Object.keys(FORMULARE);

// Alle Felder eines Formulars mit ihrem Punkt auf der Seite: [{ k, p, typ }]
export function zuordnung(art) {
  const F = FORMULARE[art], L = [];
  KOPF.forEach(f => L.push({ k: f.k, p: f.p, typ: "text" }));
  Object.entries(ART_P).forEach(([k, p]) => L.push({ k: "art_" + k, p, typ: "haken" }));
  F.zeilen.forEach((y, i) => F.spalten.forEach(s => {
    const k = `p${i + 1}_${s.k}`;
    if (s.typ === "haken") s.opt.forEach(([o, x]) => L.push({ k: k + "_" + o, p: [x, y], typ: "haken" }));
    else if (s.typ === "wahl") s.opt.forEach(([o, x]) => L.push({ k, wert: o, p: [x, y], typ: "text" }));
    else L.push({ k, p: [s.x, y], typ: "text" });
  }));
  F.gruppen.forEach(g => g.felder.forEach(f => L.push({ k: f.k, p: f.p, typ: f.typ || "text" })));
  return L;
}

/* ---------- PDF (PDFLib = die Bibliothek pdf-lib, im Browser window.PDFLib) ---------- */
const typVon = (PDFLib, f) => f instanceof PDFLib.PDFCheckBox ? "haken" : f instanceof PDFLib.PDFTextField ? "text" : f instanceof PDFLib.PDFSignature ? "unterschrift" : "anderes";
function felderMitLage(PDFLib, form) {
  const L = [];
  for (const f of form.getFields()) for (const w of f.acroField.getWidgets()) L.push({ f, r: w.getRectangle(), typ: typVon(PDFLib, f) });
  return L;
}
const finde = (L, [x, y], typ) => L.find(e => e.typ === typ && x >= e.r.x && x <= e.r.x + e.r.width && y >= e.r.y && y <= e.r.y + e.r.height);

// Welche Vorlage ist das? Rückgabe: "meterkonfektion" | "flaechenvorhang" | "faltrollo" | null
// Es gewinnt das Formular, dessen Felder alle gefunden werden und das die meisten Felder der Vorlage abdeckt.
export async function erkennen(PDFLib, bytes) {
  let pdf; try { pdf = await PDFLib.PDFDocument.load(bytes); } catch (e) { return null; }
  const L = felderMitLage(PDFLib, pdf.getForm());
  let best = null, n = 0;
  for (const art of ARTEN) {
    const Z = zuordnung(art), treffer = new Set();
    if (!Z.every(z => { const e = finde(L, z.p, z.typ); if (e) treffer.add(e.f); return !!e; })) continue;
    if (treffer.size > n) { best = art; n = treffer.size; }
  }
  return best;
}

// Nur Zeichen, die die Standardschrift kann (sonst bricht pdf-lib ab)
function sauber(font, t) {
  const ok = new Set(font.getCharacterSet());
  return Array.from(String(t).replace(/[\r\n\t]+/g, " ").replace(/[„“”]/g, '"').replace(/[‚‘’]/g, "'"), ch => ok.has(ch.codePointAt(0)) ? ch : "?").join("");
}
// Füllt die Vorlage aus. werte: { schlüssel: text | true }. unterschrift: PNG-Bytes oder null. Rückgabe: PDF-Bytes
export async function ausfuellen(PDFLib, bytes, art, werte, unterschrift) {
  const pdf = await PDFLib.PDFDocument.load(bytes);
  const form = pdf.getForm(), page = pdf.getPage(0);
  const font = await pdf.embedFont(PDFLib.StandardFonts.Helvetica);
  const L = felderMitLage(PDFLib, form);
  const fehlt = [];
  for (const z of zuordnung(art)) {
    const v = werte[z.k];
    if (!v || (z.wert && v !== z.wert)) continue;
    const e = finde(L, z.p, z.typ); if (!e) { fehlt.push(z.k); continue; }
    if (z.typ === "haken") { e.f.check(); continue; }
    const text = sauber(font, z.wert ? "X" : v), breite = e.r.width - 4;
    const gr = Math.max(5, Math.min(9, Math.floor(9 * breite / Math.max(1, font.widthOfTextAtSize(text, 9)) * 10) / 10));
    e.f.setText(text); e.f.setFontSize(gr);
  }
  if (fehlt.length) throw new Error("Die Vorlage passt nicht (Felder fehlen: " + fehlt.slice(0, 3).join(", ") + ")");
  form.updateFieldAppearances(font);
  if (unterschrift) {
    const sig = L.find(e => e.typ === "unterschrift");
    const [x, y, w, h] = sig ? [sig.r.x, sig.r.y, sig.r.width, sig.r.height] : UNTERSCHRIFT;
    const bild = await pdf.embedPng(unterschrift);
    const s = Math.min((w - 4) / bild.width, (h - 6) / bild.height);
    page.drawImage(bild, { x: x + 2, y: y + 3, width: bild.width * s, height: bild.height * s });
  }
  return pdf.save();
}

/* ---------- Eingabe in der App ---------- */
const vorlaeufig = id => /^N/.test(String(id));
// Kopf aus den Kundendaten vorbelegen
export function vorbelegen(c) {
  return { kd: vorlaeufig(c.id) ? "" : c.id, firma: c.n1 || "", ap: c.ap || "", str: c.str || "",
    plzort: [c.plz, c.ort].filter(Boolean).join(" "), datum: fmtD(today()), art: "bestellung" };
}
const inp = (k, l, w, extra = "") => `<label>${l}<input data-b="${k}" value="${esc(w[k] || "")}" autocomplete="off" ${extra}></label>`;
const chk = (k, l, w) => `<label class="chk"><input type="checkbox" data-b="${k}" ${w[k] ? "checked" : ""}> ${esc(l)}</label>`;
const zeileBelegt = (F, i, w) => Object.keys(w).some(k => k.startsWith(`p${i}_`) && w[k]);

export function formularHTML(art, w) {
  const F = FORMULARE[art];
  const sichtbar = Math.max(1, ...F.zeilen.map((_, i) => zeileBelegt(F, i + 1, w) ? i + 1 : 0));
  const pos = F.zeilen.map((_, i) => {
    const n = i + 1;
    const felder = F.spalten.map(s => {
      const k = `p${n}_${s.k}`;
      if (s.typ === "haken") return `<div class="bopt"><span>${esc(s.l)}</span>${s.opt.map(([o]) => chk(k + "_" + o, o, w)).join("")}</div>`;
      if (s.typ === "wahl") return `<label>${esc(s.l)}<select data-b="${k}"><option value="">–</option>${s.opt.map(([o]) => `<option ${w[k] === o ? "selected" : ""}>${o}</option>`).join("")}</select></label>`;
      return `<div class="${s.breit ? "bbreit" : ""}">${inp(k, esc(s.l), w, s.m ? `inputmode="${s.m}"` : "")}</div>`;
    }).join("");
    return `<fieldset class="bpos" data-n="${n}" ${n > sichtbar ? "hidden" : ""}><legend>Position ${n}</legend><div class="bgrid">${felder}</div></fieldset>`;
  }).join("");
  const gruppen = F.gruppen.map(g => `<fieldset class="bgr"><legend>${esc(g.l)}</legend>${g.hinweis ? `<p class="muted">${esc(g.hinweis)}</p>` : ""}<div class="bgrid">${g.felder.map(f => f.typ === "haken" ? chk(f.k, f.l, w) : inp(f.k, esc(f.l), w)).join("")}</div></fieldset>`).join("");
  return `<div class="grid2">${KOPF.map(f => inp(f.k, f.l, w)).join("")}</div>
   <div class="row"><label class="chk"><input type="radio" name="bart" value="angebot" ${w.art === "angebot" ? "checked" : ""}> Angebot</label>
   <label class="chk"><input type="radio" name="bart" value="bestellung" ${w.art !== "angebot" ? "checked" : ""}> Bestellung</label></div>
   ${pos}<button type="button" id="bposplus" ${sichtbar >= F.zeilen.length ? "hidden" : ""}>+ weitere Position</button>
   ${gruppen}
   ${F.fussnote ? `<p class="hint">${esc(F.fussnote)}</p>` : ""}
   <fieldset class="bgr"><legend>Unterschrift</legend><canvas id="bsig" class="bsig" width="600" height="180" aria-label="Feld zum Unterschreiben mit dem Finger oder der Maus"></canvas>
   <div class="row"><button type="button" id="bsigweg" class="ghost">Unterschrift löschen</button><span class="hint">Mit dem Finger oder der Maus unterschreiben (freiwillig).</span></div></fieldset>`;
}
// Eingaben aus dem Dialog lesen
export function werteLesen(root) {
  const w = {};
  root.querySelectorAll("[data-b]").forEach(el => { const v = el.type === "checkbox" ? el.checked : el.value.trim(); if (v) w[el.dataset.b] = v; });
  const a = root.querySelector('input[name="bart"]:checked'); w.art = a ? a.value : "bestellung";
  w["art_" + w.art] = true;
  return w;
}
// Hat der Nutzer etwas über den vorbelegten Kopf hinaus eingetragen?
export const positionenLeer = w => !Object.keys(w).some(k => /^p\d+_/.test(k));

// Unterschriftsfeld (Finger/Maus). Rückgabe: { leer(), png() → Uint8Array | null }
export function unterschriftFeld(canvas, loeschen) {
  const ctx = canvas.getContext("2d"); let leer = true, zieht = false;
  const pos = e => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * canvas.width / r.width, (e.clientY - r.top) * canvas.height / r.height]; };
  ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#0d2a5c";
  canvas.addEventListener("pointerdown", e => { zieht = true; canvas.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...pos(e)); e.preventDefault(); });
  canvas.addEventListener("pointermove", e => { if (!zieht) return; ctx.lineTo(...pos(e)); ctx.stroke(); leer = false; e.preventDefault(); });
  const ende = () => { zieht = false; };
  canvas.addEventListener("pointerup", ende); canvas.addEventListener("pointercancel", ende);
  loeschen.addEventListener("click", () => { ctx.clearRect(0, 0, canvas.width, canvas.height); leer = true; });
  return {
    leer: () => leer,
    png: () => { if (leer) return null; const b = atob(canvas.toDataURL("image/png").split(",")[1]); return Uint8Array.from(b, c => c.charCodeAt(0)); },
  };
}
// Dateiname für das fertige PDF (ohne Zeichen, die Dateisysteme nicht mögen)
export function dateiname(art, w) {
  const d = new Date(), z = n => String(n).padStart(2, "0");
  const teil = s => String(s || "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, "_").slice(0, 40);
  return [FORMULARE[art].titel.replace("ä", "ae"), w.art === "angebot" ? "Angebot" : "Bestellung", teil(w.kd), teil(w.firma),
    `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}`].filter(Boolean).join("_") + ".pdf";
}
