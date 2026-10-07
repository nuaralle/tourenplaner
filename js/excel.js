// Excel-Stand lesen und schreiben (Blätter "Kundenliste", "Einstellungen", "Wochenplan", "Termine").
// Das Format entspricht der Datei Tourenplaner_Stand_*.xlsx aus dem Prototyp.
import { DEFAULTS, EINST_NAMEN, iso, fmtD, addDays, parseISO, hotelOrt } from "./grundlagen.js";
import { PLZ } from "./plz.js";

// Spalte in Excel -> Feld im Programm
const SPALTEN = [
  ["Kd Nr.", "id"], ["Name1", "n1"], ["Name2", "n2"], ["Name3", "n3"], ["Plz", "plz"], ["Ort", "ort"], ["Straße", "str"],
  ["Telefon", "tel"], ["Email", "mail"], ["Rabatt", "rab"], ["Preisgruppe", "pg"],
  ["Priorität (ABC)", "abc"], ["Ansprechpartner", "ap"], ["Position/Funktion", "pos"], ["Direktkontakt (Tel./Mobil)", "dk"],
  ["Öffnungszeiten", "oh"], ["Besuchsdauer (Min.)", "vm"], ["Besuchsrhythmus (Wochen)", "rh"], ["Letzter Besuch", "lv"],
  ["Aus Planung genommen", "hold"], ["Notizen", "notes"], ["Neu angelegt", "isNew"], ["Deaktiviert", "inactive"],
];
const BEKANNT = new Set(SPALTEN.map(s => s[0]));
// Eigene Spalten, die in der Kundenliste angelegt wurden (nicht vom Programm vorgegeben, keine Umsatz-Spalte)
export const eigeneSpalten = spalten => (spalten || []).filter(s => !BEKANNT.has(s) && !umsatzJahr(s));
export const spalteBekannt = s => BEKANNT.has(s);
// Umsatz-Spalten werden am Namen erkannt: "Umsatz 25", "Umsatz 26", "Umsatz 2027" … -> Jahr
export const umsatzJahr = name => { const m = String(name).trim().match(/^Umsatz\s*(\d{2}|\d{4})$/i); return m ? (m[1].length === 2 ? 2000 + +m[1] : +m[1]) : null; };
// Reihenfolge der Spalten, wenn die Datei keine vorgibt (wie im bisherigen Stand)
export const STANDARD_REIHENFOLGE = SPALTEN.slice(0, 11).map(s => s[0]).concat("Umsatz 25", "Umsatz 24", SPALTEN.slice(11).map(s => s[0]));

// Ältere gespeicherte Stände (Felder u25/u24) auf das neue Format bringen: ums = { Jahr: Betrag }, extra = { Spalte: Wert }
export function kundenNormalisieren(kunden) {
  for (const k of kunden) {
    if (!k.ums) { k.ums = {}; if ("u25" in k) k.ums[2025] = k.u25 || 0; if ("u24" in k) k.ums[2024] = k.u24 || 0; }
    delete k.u25; delete k.u24;
    if (!k.extra) k.extra = {};
  }
  return kunden;
}
// Alle Umsatz-Jahre, die bei mindestens einem Kunden vorkommen (neuestes zuerst)
export const umsatzJahre = kunden => [...new Set(kunden.flatMap(k => Object.keys(k.ums || {}).map(Number)))].sort((a, b) => b - a);
const ARTEN = { "Tagestour": "tour", "Übernachtung Tag 1": "ov1", "Übernachtung Tag 2": "ov2", "Home-Office": "home" };
const ARTEN_TEXT = Object.fromEntries(Object.entries(ARTEN).map(([k, v]) => [v, k]));

const txt = v => v == null ? "" : String(v).trim();
const ja = v => v === true || /^(ja|x|true|wahr|1)$/i.test(txt(v));
const zahl = v => { if (v === "" || v == null) return 0; if (typeof v === "number") return v; const n = parseFloat(String(v).replace(/\./g, "").replace(",", ".")); return isNaN(n) ? 0 : n; };

// Datum aus Excel (Datum, Zahl oder Text) -> "JJJJ-MM-TT"
export function datum(v) {
  if (v == null || v === "") return "";
  if (v instanceof Date) return iso(new Date(v.getTime() + 12 * 3600e3)); // Mittag, damit Zeitzonen nicht den Tag verschieben
  if (typeof v === "number") { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5); return d.toISOString().slice(0, 10); }
  const s = String(v).trim(); let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return m[1] + "-" + m[2] + "-" + m[3];
  if ((m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/))) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return y + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0"); }
  return "";
}
// Uhrzeit aus Excel (Text oder Tagesbruchteil) -> "HH:MM"
export function uhrzeit(v) {
  if (v == null || v === "") return "";
  if (v instanceof Date) return String(v.getHours()).padStart(2, "0") + ":" + String(v.getMinutes()).padStart(2, "0");
  if (typeof v === "number") { const m = Math.round((v % 1) * 1440); return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); }
  const m = String(v).trim().match(/^(\d{1,2})[:.](\d{2})/); return m ? m[1].padStart(2, "0") + ":" + m[2] : "";
}
// "TT.MM.JJJJ: Text" (eine Notiz pro Zeile) <-> [{d,t}]
export function notizenLesen(v) {
  const out = [];
  for (const zeile of txt(v).split(/\r?\n/)) {
    const m = zeile.match(/^(\d{1,2}\.\d{1,2}\.\d{2,4}):\s?(.*)$/);
    if (m) out.push({ d: datum(m[1]), t: m[2] });
    else if (zeile.trim() && out.length) out[out.length - 1].t += "\n" + zeile;
    else if (zeile.trim()) out.push({ d: "", t: zeile });
  }
  return out;
}
const notizenText = notes => (notes || []).map(n => (n.d ? fmtD(n.d) : "") + ": " + n.t).join("\n");

/* ---------- Lesen ---------- */
export function leseStand(XLSX, daten) {
  const wb = XLSX.read(daten, { type: "array", cellDates: true });
  const blatt = wb.Sheets["Kundenliste"] || wb.Sheets[wb.SheetNames[0]];
  if (!blatt) throw new Error("Blatt „Kundenliste“ nicht gefunden");
  const zeilen = XLSX.utils.sheet_to_json(blatt, { defval: "" });
  if (!zeilen.length || !("Name1" in zeilen[0])) throw new Error("Die Datei sieht nicht wie eine Kundenliste aus (Spalte „Name1“ fehlt)");
  // Spalten in der Reihenfolge der Datei (auch eigene Spalten, die das Programm nicht kennt)
  const spalten = (XLSX.utils.sheet_to_json(blatt, { header: 1, range: 0 })[0] || []).map(s => txt(s)).filter(Boolean);
  const eigene = eigeneSpalten(spalten);
  const umsSpalten = spalten.filter(s => umsatzJahr(s));
  const wert = v => v instanceof Date ? datum(v) : v; // Datum als Text speichern

  const kunden = [], ids = new Set();
  zeilen.forEach((z, i) => {
    const k = {};
    for (const [sp, f] of SPALTEN) k[f] = z[sp];
    let id = txt(k.id); if (!id || ids.has(id)) id = "N" + (i + 1).toString(36) + Date.now().toString(36);
    ids.add(id);
    const ums = {}; for (const s of umsSpalten) ums[umsatzJahr(s)] = zahl(z[s]);
    const extra = {}; for (const s of eigene) if (z[s] !== "" && z[s] != null) extra[s] = wert(z[s]);
    const c = {
      id, n1: txt(k.n1), n2: txt(k.n2), n3: txt(k.n3), plz: txt(k.plz).replace(/\D/g, "").padStart(5, "0"), ort: txt(k.ort), str: txt(k.str),
      tel: txt(k.tel), mail: txt(k.mail), rab: txt(k.rab), pg: txt(k.pg), ums,
      abc: (txt(k.abc).toUpperCase().match(/[ABC]/) || ["C"])[0], ap: txt(k.ap), pos: txt(k.pos), dk: txt(k.dk), oh: txt(k.oh),
      vm: zahl(k.vm) || null, rh: zahl(k.rh) || null, lv: datum(k.lv), hold: ja(k.hold), notes: notizenLesen(k.notes),
      isNew: ja(k.isNew), inactive: ja(k.inactive), extra,
    };
    if (!c.n1 && !txt(k.id)) return; // leere Zeile
    kunden.push(c);
  });

  const einst = { ...DEFAULTS };
  if (wb.Sheets["Einstellungen"]) {
    for (const z of XLSX.utils.sheet_to_json(wb.Sheets["Einstellungen"], { defval: "" })) {
      const key = txt(z["Schlüssel"]); if (!(key in DEFAULTS) || z.Wert === "") continue;
      const def = DEFAULTS[key];
      if (typeof def === "number") einst[key] = zahl(z.Wert);
      else if (typeof def === "boolean") einst[key] = ja(z.Wert);
      else if (/^\d\d:\d\d$/.test(def)) einst[key] = uhrzeit(z.Wert) || def;
      else if (key === "umsatzStand") einst[key] = datum(z.Wert);
      else einst[key] = txt(z.Wert);
    }
  }

  // Wochenplan: eine oder mehrere Wochen untereinander; angezeigt wird die aktuelle bzw. nächste Woche
  const plaene = wb.Sheets["Wochenplan"] ? leseWochenplaene(XLSX.utils.sheet_to_json(wb.Sheets["Wochenplan"], { defval: "" }), kunden) : [];
  const dieseWoche = iso(addDays(new Date(), -((new Date().getDay() + 6) % 7)));
  const plan = plaene.find(p => p.week >= dieseWoche) || plaene[plaene.length - 1] || null;
  // Feste Termine: Blatt "Termine" (alle Wochen) und – für ältere Stände – die Spalte "Fixtermin" im Wochenplan
  const termine = {};
  if (wb.Sheets["Termine"]) for (const z of XLSX.utils.sheet_to_json(wb.Sheets["Termine"], { defval: "" })) {
    const id = txt(z["Kd Nr."]), d = datum(z.Datum), t = uhrzeit(z.Uhrzeit);
    if (!id || !d || !t || !kunden.some(k => k.id === id)) continue;
    termine[id] = { date: d, time: t }; if (txt(z["Kalender-Eintrag"])) { termine[id].ev = txt(z["Kalender-Eintrag"]); termine[id].cal = "ok"; }
  }
  for (const p of plaene) { for (const id in p.fixed) if (!termine[id]) termine[id] = p.fixed[id]; p.fixed = termine; }
  let kalLoeschen = [], spaltenArten = {}, sicherung = "";
  if (wb.Sheets["Intern"]) for (const z of XLSX.utils.sheet_to_json(wb.Sheets["Intern"], { defval: "" })) {
    if (z["Schlüssel"] === "sicherung") sicherung = datum(z.Wert);
    if (z["Schlüssel"] === "kalLoeschen") try { kalLoeschen = JSON.parse(z.Wert) || []; } catch (e) { /* egal */ }
    if (z["Schlüssel"] === "abgeschlossen") try { const tage = new Set(JSON.parse(z.Wert) || []); plaene.forEach(p => p.days.forEach(D => { if (tage.has(D.date)) D.abgeschlossen = true; })); } catch (e) { /* egal */ }
    if (z["Schlüssel"] === "spaltenArten") try { spaltenArten = JSON.parse(z.Wert) || {}; } catch (e) { /* egal */ }
    if (z["Schlüssel"] === "uebernachtung") { // je Woche { "JJJJ-MM-TT": "auto" | "0-1" … } (ältere Stände: ein Wert für alle)
      let w = String(z.Wert); try { w = JSON.parse(w); } catch (e) { /* einfacher Wert */ }
      for (const p of plaene) { const v = typeof w === "object" && w ? w[p.week] : w; if (/^(auto|0-1|1-2|2-3)$/.test(String(v))) p.uebernachtung = String(v); }
    }
  }
  return { kunden, einst, plan, plaene, kalLoeschen, spalten, termine, spaltenArten, sicherung };
}

// Zeilen nach Wochen (Montag) aufteilen
function leseWochenplaene(zeilen, kunden) {
  const wochen = new Map();
  for (const z of zeilen) { const d = datum(z.Datum); if (!d) continue; const d0 = parseISO(d); const mon = iso(addDays(d0, -((d0.getDay() + 6) % 7)));
    if (!wochen.has(mon)) wochen.set(mon, []); wochen.get(mon).push(z); }
  return [...wochen.keys()].sort().map(mon => leseWoche(wochen.get(mon), kunden, parseISO(mon)));
}
function leseWoche(zeilen, kunden, mon) {
  const days = [0, 1, 2, 3, 4].map(i => ({ date: iso(addDays(mon, i)), day: i, type: i === 4 ? "home" : "tour", stops: [], hotel: null }));
  const fixed = {}; const hotelAusExcel = {};
  const kd = new Map(kunden.map(k => [k.id, k]));
  const sortiert = zeilen.slice().sort((a, b) => (datum(a.Datum) + String(a.Reihenfolge).padStart(3, "0")).localeCompare(datum(b.Datum) + String(b.Reihenfolge).padStart(3, "0")));
  for (const z of sortiert) {
    const di = Math.round((parseISO(datum(z.Datum)) - mon) / 864e5); if (di < 0 || di > 4) continue;
    const D = days[di]; const art = ARTEN[txt(z.Art)]; if (art && di < 4) D.type = art;
    const id = txt(z["Kd Nr."]);
    if (id && kd.has(id) && di < 4) {
      D.stops.push(id);
      const t = uhrzeit(z.Fixtermin); if (t) { fixed[id] = { date: D.date, time: t }; if (txt(z["Kalender-Eintrag"])) { fixed[id].ev = txt(z["Kalender-Eintrag"]); fixed[id].cal = "ok"; } }
    }
    if (txt(z.Hotel)) hotelAusExcel[di] = txt(z.Hotel);
  }
  // Hotel: Ort des letzten Besuchs von Tag 1 (Lage über diesen Kunden)
  const t1 = days.find(D => D.type === "ov1");
  if (t1) {
    const t2 = days.find(D => D.type === "ov2");
    const ort = hotelAusExcel[t1.day] || (t2 && hotelAusExcel[t2.day]) || "";
    const cand = t1.stops.map(id => kd.get(id)).reverse();
    const h = cand.find(k => k.ort === ort) || cand[0] || (t2 && kd.get(t2.stops[0]));
    if (h) { const p = PLZ[h.plz] || [null, null];
      const ho = hotelOrt({ ort: h.ort, plz: h.plz, lat: p[0], lng: p[1] }); // Insel -> Hotel auf dem Festland
      t1.hotel = ho.insel ? ho : { ort: ort || h.ort, plz: h.plz, lat: p[0], lng: p[1] }; if (t2) t2.hotel = t1.hotel; }
  }
  return { week: iso(mon), days, excluded: [], fixed, created: new Date().toISOString(), ausExcel: true };
}

/* ---------- Schreiben ---------- */
export function schreibeStand(XLSX, { kunden, einst, plan, plaene, kalLoeschen, spalten, termine, spaltenArten, sicherung }) {
  termine = termine || (plan && plan.fixed) || {};
  const wochen = (plaene && plaene.length ? plaene : plan ? [plan] : []).slice().sort((a, b) => a.week.localeCompare(b.week));
  const wb = XLSX.utils.book_new();
  kundenNormalisieren(kunden);
  // Spalten: Reihenfolge wie in der Datei; fehlende bekannte, Umsatz- und eigene Spalten hinten anhängen
  const kopf = (spalten && spalten.length ? spalten : STANDARD_REIHENFOLGE).slice();
  const dazu = s => { if (!kopf.includes(s)) kopf.push(s); };
  SPALTEN.forEach(s => dazu(s[0]));
  const jahreImKopf = new Set(kopf.map(umsatzJahr).filter(Boolean));
  umsatzJahre(kunden).filter(j => !jahreImKopf.has(j)).forEach(j => dazu("Umsatz " + String(j).slice(2)));
  kunden.forEach(c => Object.keys(c.extra).forEach(dazu));
  const feld = Object.fromEntries(SPALTEN);
  const rows = kunden.map(c => {
    const r = {};
    for (const sp of kopf) {
      const f = feld[sp], j = umsatzJahr(sp);
      let v;
      if (f) {
        v = c[f];
        if (f === "notes") v = notizenText(c.notes);
        else if (f === "hold" || f === "isNew" || f === "inactive") v = v ? "ja" : "";
        else if (v == null) v = "";
      } else if (j) v = c.ums[j] ?? "";
      else v = c.extra[sp] ?? "";
      r[sp] = v;
    }
    return r;
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows, { header: kopf }), "Kundenliste");

  const es = Object.keys(DEFAULTS).map(k => ({ "Einstellung": EINST_NAMEN[k] || k, "Wert": einst[k] ?? DEFAULTS[k], "Schlüssel": k }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(es, { header: ["Einstellung", "Wert", "Schlüssel"] }), "Einstellungen");

  const wp = [];
  const kd = new Map(kunden.map(k => [k.id, k]));
  for (const woche of wochen) {
    for (const D of woche.days) {
      const art = ARTEN_TEXT[D.type] || "Tagestour";
      if (!D.stops.length) { wp.push({ "Datum": D.date, "Art": art, "Reihenfolge": "", "Kd Nr.": "", "Kunde": "", "Fixtermin": "", "Hotel": D.type === "ov1" && D.hotel ? D.hotel.ort : "", "Kalender-Eintrag": "" }); continue; }
      D.stops.forEach((id, i) => {
        const k = kd.get(id) || {};
        const f = termine[id];
        wp.push({ "Datum": D.date, "Art": art, "Reihenfolge": i + 1, "Kd Nr.": id, "Kunde": (k.n1 || "?") + " (" + (k.ort || "") + ")",
          "Fixtermin": f && f.date === D.date ? f.time : "", "Hotel": D.type === "ov1" && D.hotel ? D.hotel.ort : "", "Kalender-Eintrag": f && f.date === D.date && f.ev ? f.ev : "" });
      });
    }
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(wp, { header: ["Datum", "Art", "Reihenfolge", "Kd Nr.", "Kunde", "Fixtermin", "Hotel", "Kalender-Eintrag"] }), "Wochenplan");
  const kdN = new Map(kunden.map(k => [k.id, k]));
  const tr = Object.entries(termine).sort((a, b) => (a[1].date + a[1].time).localeCompare(b[1].date + b[1].time))
    .map(([id, f]) => { const k = kdN.get(id) || {}; return { "Datum": f.date, "Uhrzeit": f.time, "Kd Nr.": id, "Kunde": (k.n1 || "?") + " (" + (k.ort || "") + ")", "Kalender-Eintrag": f.ev || "" }; });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tr, { header: ["Datum", "Uhrzeit", "Kd Nr.", "Kunde", "Kalender-Eintrag"] }), "Termine");
  // Internes Blatt: noch zu löschende Kalendertermine (z. B. wenn ein Termin offline gelöst wurde)
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ "Schlüssel": "kalLoeschen", "Wert": JSON.stringify(kalLoeschen || []) }, { "Schlüssel": "uebernachtung", "Wert": JSON.stringify(Object.fromEntries(wochen.map(p => [p.week, p.uebernachtung || "auto"]))) }, { "Schlüssel": "spaltenArten", "Wert": JSON.stringify(spaltenArten || {}) },
    { "Schlüssel": "sicherung", "Wert": sicherung || "" },
    { "Schlüssel": "abgeschlossen", "Wert": JSON.stringify(wochen.flatMap(p => p.days.filter(D => D.abgeschlossen).map(D => D.date))) }], { header: ["Schlüssel", "Wert"] }), "Intern");
  return XLSX.write(wb, { type: "array", bookType: "xlsx", compression: true });
}

/* ---------- Kundenliste abgleichen (neue Kundenliste aus der Firma mit Spalte „Kd Nr.“) ---------- */
// Stammdaten-Felder, die aus der Liste übernommen werden können
const STAMM = [["n1", "Name1"], ["n2", "Name2"], ["n3", "Name3"], ["plz", "Plz"], ["ort", "Ort"], ["str", "Straße"], ["tel", "Telefon"], ["mail", "Email"], ["rab", "Rabatt"], ["pg", "Preisgruppe"]];
const STAMM_NAMEN = { n1: "Name", n2: "Name 2", n3: "Name 3", plz: "PLZ", ort: "Ort", str: "Straße", tel: "Telefon", mail: "E-Mail", rab: "Rabatt", pg: "Preisgruppe" };
export const stammName = f => STAMM_NAMEN[f] || f;
// Liste einlesen: das erste Blatt mit einer Spalte „Kd Nr.“; Umsatz-Spalten werden am Namen erkannt
export function kundenlisteLesen(XLSX, daten) {
  const wb = XLSX.read(daten, { type: "array" });
  for (const n of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: "" });
    if (!rows.length || !Object.keys(rows[0]).some(k => txt(k) === "Kd Nr.")) continue;
    const spalten = Object.keys(rows[0]), umsSp = spalten.filter(s => umsatzJahr(s));
    const kd = spalten.find(k => txt(k) === "Kd Nr.");
    const zeilen = rows.map(r => {
      const z = { id: txt(r[kd]), ums: {} };
      for (const [f, sp] of STAMM) if (sp in r) z[f] = f === "plz" ? txt(r[sp]).replace(/\D/g, "").padStart(5, "0") : txt(r[sp]);
      for (const s of umsSp) z.ums[umsatzJahr(s)] = zahl(r[s]);
      return z;
    }).filter(z => z.id);
    return { blatt: n, zeilen, jahre: umsSp.map(umsatzJahr).sort((a, b) => b - a), felder: STAMM.filter(([, sp]) => spalten.includes(sp)).map(([f]) => f) };
  }
  throw new Error("In der Datei gibt es keine Spalte „Kd Nr.“");
}
const nameSchluessel = (n, plz) => String(n || "").toLowerCase().replace(/[^a-z0-9äöüß]/g, "") + "|" + plz;
// Vorschlag, was sich ändern würde (noch nichts wird geändert)
export function abgleichVorschlag(liste, kunden) {
  const L = new Map(liste.zeilen.map(z => [z.id, z])), K = new Map(kunden.map(k => [k.id, k]));
  const vorschlag = { jahre: liste.jahre, umsatz: [], neu: [], fehlen: [], vorlaeufig: [], reaktiv: [], stamm: [] };
  // selbst angelegte Kunden (vorläufige Nummer „N…“) über Name und PLZ finden
  const vorl = new Map(kunden.filter(k => /^N/.test(k.id)).map(k => [nameSchluessel(k.n1, k.plz), k]));
  const vergeben = new Set();
  for (const z of liste.zeilen) {
    const k = K.get(z.id);
    if (!k) { const v = vorl.get(nameSchluessel(z.n1, z.plz)); if (v && !vergeben.has(v.id)) { vergeben.add(v.id); vorschlag.vorlaeufig.push({ id: v.id, neu: z.id, name: v.n1, ort: v.ort }); } else vorschlag.neu.push(z); continue; }
    if (liste.jahre.some(j => Math.abs((k.ums[j] || 0) - (z.ums[j] || 0)) > 0.5)) vorschlag.umsatz.push({ id: k.id, name: k.n1, alt: { ...k.ums }, neu: z.ums });
    if (k.inactive) vorschlag.reaktiv.push({ id: k.id, name: k.n1, ort: k.ort, ums: z.ums });
    const felder = liste.felder.filter(f => f !== "n1" && txt(z[f]) && txt(z[f]) !== txt(k[f])).map(f => ({ f, alt: txt(k[f]), neu: txt(z[f]) }));
    if (felder.length) vorschlag.stamm.push({ id: k.id, name: k.n1, felder });
  }
  for (const k of kunden) if (!k.inactive && !/^N/.test(k.id) && !L.has(k.id)) vorschlag.fehlen.push({ id: k.id, name: k.n1, ort: k.ort });
  return vorschlag;
}
// Ausgewählte Änderungen übernehmen. auswahl: { umsatz: bool, stamm: bool, neu: Set, fehlen: Set, vorlaeufig: Set, reaktiv: Set }
// Rückgabe: umbenennen = [[alt, neu]] (vorläufige Nummern – Termine/Wochenplan passt die App an), gezählte Änderungen
export function abgleichAnwenden(kunden, liste, vorschlag, auswahl) {
  const L = new Map(liste.zeilen.map(z => [z.id, z])), K = new Map(kunden.map(k => [k.id, k]));
  const umsatzSetzen = (k, z) => { k.ums = { ...k.ums }; for (const j of liste.jahre) k.ums[j] = z.ums[j] || 0; };
  const erg = { umbenennen: [], umsatz: 0, neu: 0, deaktiviert: 0, reaktiviert: 0, stamm: 0 };
  if (auswahl.umsatz) for (const u of vorschlag.umsatz) { umsatzSetzen(K.get(u.id), L.get(u.id)); erg.umsatz++; }
  if (auswahl.stamm) for (const s of vorschlag.stamm) { const k = K.get(s.id); for (const x of s.felder) k[x.f] = x.neu; erg.stamm++; }
  for (const r of vorschlag.reaktiv) if (auswahl.reaktiv.has(r.id)) { K.get(r.id).inactive = false; erg.reaktiviert++; }
  for (const f of vorschlag.fehlen) if (auswahl.fehlen.has(f.id)) { K.get(f.id).inactive = true; erg.deaktiviert++; }
  for (const v of vorschlag.vorlaeufig) if (auswahl.vorlaeufig.has(v.id)) {
    const k = K.get(v.id), z = L.get(v.neu); umsatzSetzen(k, z);
    for (const f of liste.felder) if (!txt(k[f]) && txt(z[f])) k[f] = z[f]; // leere Felder ergänzen
    k.isNew = false; erg.umbenennen.push([v.id, v.neu]);
  }
  for (const z of vorschlag.neu) if (auswahl.neu.has(z.id)) {
    kunden.push({ id: z.id, n1: z.n1 || "", n2: z.n2 || "", n3: z.n3 || "", plz: z.plz || "", ort: z.ort || "", str: z.str || "", tel: z.tel || "", mail: z.mail || "",
      rab: z.rab || "", pg: z.pg || "", ums: { ...z.ums }, abc: "C", ap: "", pos: "", dk: "", oh: "", vm: null, rh: null, lv: "", hold: false, notes: [],
      isNew: false, inactive: false, extra: {} });
    erg.neu++;
  }
  return erg;
}
