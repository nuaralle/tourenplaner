// „Neue Kunden finden“: passende Betriebe aus OpenStreetMap (kostenlos, ohne Anmeldung) und Abgleich mit der Kundenliste.
// An OpenStreetMap geht nur die Suche (Branchen + Gebiet bzw. Mittelpunkt/Umkreis) – nie Kundendaten. Der Abgleich läuft auf dem Gerät.
import { luftlinie } from "./grundlagen.js";

export const OVERPASS = "https://overpass-api.de/api/interpreter";
// Treffer nur über den Namen, die nicht passen: Reinigung, Buchhandlung „Sattler“ usw.
const NAME_NEIN = /reinigung|buchhandlung|friseur|bäckerei|apotheke|fahrschule/i;
const SHOP_NEIN = new Set(["books", "hairdresser", "bakery", "butcher", "supermarket", "convenience", "kiosk", "pharmacy", "chemist", "dry_cleaning", "laundry", "optician", "beauty", "florist", "tobacco", "alcohol", "beverages"]);

// Branchen: OSM-Merkmale und Namensteile. standard = beim ersten Öffnen angehakt
export const BRANCHEN = [
  { k: "raum", t: "Raumausstatter & Gardinen", standard: true, tags: [["craft", "interior_decorator"], ["shop", "curtain"]], name: "raumausstatt|gardine|raumgestalt|raumdesign|polsterer und dekorateur" },
  { k: "polster", t: "Polsterer & Sattler", standard: true, tags: [["craft", "upholsterer"], ["craft", "saddler"]], name: "polster|sattler" },
  { k: "sonne", t: "Sonnenschutz", standard: true, tags: [["craft", "sun_protection"], ["shop", "window_blind"]], name: "sonnenschutz|plissee|jalousie" },
  { k: "innen", t: "Innenarchitekten & Objekteinrichter", standard: true, tags: [["office", "interior_design"]], name: "innenarchitekt|objekteinricht|objektausstatt|interior" },
  { k: "deko", t: "Deko & Wohnaccessoires", standard: false, tags: [["shop", "interior_decoration"]], name: "" },
  { k: "moebel", t: "Möbelhäuser", standard: false, tags: [["shop", "furniture"]], name: "" },
];
// Bundesländer des Gebiets (Bremen, Hamburg, Schleswig-Holstein, Niedersachsen)
export const GEBIET = "^DE-(HB|HH|SH|NI)$";

// Rechteck um einen Umkreis (die genaue Entfernung prüft die App danach). ort: { lat, lng, km }
export function rechteckUm(ort) {
  const dLat = ort.km / 111.2, dLng = ort.km / (111.2 * Math.cos(ort.lat * Math.PI / 180));
  return { s: ort.lat - dLat, w: ort.lng - dLng, n: ort.lat + dLat, e: ort.lng + dLng };
}
// Ganzes Gebiet: in Kacheln (je ca. 110 × 90 km), eine Abfrage für alles wäre dem Dienst zu groß
export const KACHELN = [];
for (let s = 51.25; s < 55.1; s += 1) for (let w = 6.6; w < 11.7; w += 1.3) KACHELN.push({ s, w, n: Math.min(s + 1, 55.1), e: Math.min(w + 1.3, 11.7) });

// Overpass-Abfrage für ein Rechteck { s, w, n, e }: erst alle Geschäfte/Handwerker/Büros holen, dann nach Merkmal bzw. Namen filtern,
// zum Schluss nur Treffer in Bremen, Hamburg, Schleswig-Holstein und Niedersachsen
export function abfrage(branchen, r) {
  const B = BRANCHEN.filter(b => branchen.includes(b.k)), f = x => x.toFixed(4), wo = `(${f(r.s)},${f(r.w)},${f(r.n)},${f(r.e)})`;
  const teile = [];
  for (const k of ["shop", "craft", "office"]) {
    const werte = B.flatMap(b => b.tags.filter(t => t[0] === k).map(t => t[1]));
    if (werte.length) teile.push(`nwr.a["${k}"~"^(${werte.join("|")})$"];`);
  }
  const namen = B.map(b => b.name).filter(Boolean).join("|");
  if (namen) teile.push(`nwr.a["name"~"${namen}",i];`);
  return `[out:json][timeout:90];area["ISO3166-2"~"${GEBIET}"]["admin_level"="4"]->.g;(nwr["shop"]${wo};nwr["craft"]${wo};nwr["office"]${wo};)->.a;(${teile.join("")})->.r;nwr.r(area.g);out center tags;`;
}

// Suche mit Wiederholung: der Dienst ist manchmal kurz überlastet (Antwort 429/504) – je Teil bis zu 3 Versuche.
// opt: { holen(url, body) → { status, json }, warten(ms), fortschritt(teil, von, anzahl), abbruch() → true }
// Ergebnis: { L (Betriebe), fehlend (Teile ohne Antwort), fehler (letzter Grund) }
export async function suchen(branchen, rechtecke, opt) {
  const roh = new Map(); let fehlend = 0, fehler = "";
  for (let i = 0; i < rechtecke.length; i++) {
    if (opt.abbruch && opt.abbruch()) break;
    opt.fortschritt && opt.fortschritt(i + 1, rechtecke.length, roh.size);
    let ok = false;
    for (let v = 0; v < 3 && !ok; v++) {
      if (v) await opt.warten(10000 * v);
      else if (i) await opt.warten(2000); // kleine Pause zwischen den Teilen (faire Nutzung)
      try {
        const { status, json } = await opt.holen(OVERPASS, "data=" + encodeURIComponent(abfrage(branchen, rechtecke[i])));
        if (status !== 200 || !json) { fehler = "Antwort " + status; if (status === 429 || status >= 500) continue; break; }
        if (json.remark && !(json.elements || []).length) { fehler = "Zeitüberschreitung beim Dienst"; continue; }
        for (const e of json.elements || []) roh.set(e.type + "/" + e.id, e);
        ok = true;
      } catch (e) { fehler = e.message || String(e); }
    }
    if (!ok) fehlend++;
  }
  return { L: betriebe({ elements: [...roh.values()] }, branchen), fehlend, fehler };
}

// Ergebnis der Abfrage → Betriebe { osm, n1, str, plz, ort, tel, mail, web, oh, lat, lng, branchen }
export function betriebe(json, branchen) {
  const B = BRANCHEN.filter(b => branchen.includes(b.k)), gesehen = new Set(), L = [];
  for (const e of (json && json.elements) || []) {
    const t = e.tags || {}, name = t.name || t.brand || "";
    const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon;
    if (!name || lat == null || t.disused === "yes" || t["disused:shop"] || t["disused:craft"]) continue;
    const osm = e.type + "/" + e.id; if (gesehen.has(osm)) continue; gesehen.add(osm);
    const nameOk = !NAME_NEIN.test(name) && !SHOP_NEIN.has(t.shop) && t.craft !== "cleaning";
    const br = B.filter(b => b.tags.some(([k, v]) => t[k] === v) || (nameOk && b.name && new RegExp(b.name, "i").test(name) && (t.shop || t.craft || t.office))).map(b => b.k);
    if (!br.length) continue;
    const str = [t["addr:street"] || t["addr:place"] || "", t["addr:housenumber"] || ""].join(" ").trim();
    L.push({ osm, n1: name, str, plz: t["addr:postcode"] || "", ort: t["addr:city"] || t["addr:suburb"] || "", tel: t.phone || t["contact:phone"] || "", mob: t["contact:mobile"] || "",
      mail: t.email || t["contact:email"] || "", web: t.website || t["contact:website"] || "", oh: t.opening_hours || "", lat, lng, branchen: br });
  }
  return L;
}

// Fehlt die PLZ in OpenStreetMap: PLZ mit dem nächsten Mittelpunkt (ungefähr). plz: Tabelle PLZ → [lat, lng]
export function plzSchaetzen(L, plz) {
  const E = Object.entries(plz);
  for (const b of L) {
    if (b.plz) continue;
    let best = null, d = Infinity;
    for (const [k, [la, ln]] of E) { const x = (la - b.lat) ** 2 + ((ln - b.lng) * 0.6) ** 2; if (x < d) { d = x; best = k; } }
    if (best) { b.plz = best; b.plzUngefaehr = true; }
  }
  return L;
}

/* ---------- Abgleich mit der Kundenliste (nur auf dem Gerät) ---------- */
const UML = { "ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss", "é": "e", "è": "e" };
const grund = s => String(s || "").toLowerCase().replace(/[äöüßéè]/g, c => UML[c]).replace(/&/g, " und ");
// Rechtsformen und Füllwörter zählen nicht, Branchenwörter nur, wenn sonst nichts übrig bleibt
const RECHT = new Set("gmbh mbh co kg gbr ohg ug ag ek e k inh inhaber inhaberin und the der die das am an im in fuer von vom zum zur haftungsbeschraenkt partner".split(" "));
const BRANCHE_WORT = /^(raumausstatt|raumausstattung|raumausstatter|raumausstatterei|raumausstattungen|polster|polsterei|polsterer|polsterwerkstatt|polstermoebel|sattler|sattlerei|gardinen|gardine|gardinenstudio|deko|dekoration|dekorationen|sonnenschutz|innenarchitektur|innenarchitekt|innenarchitektin|interior|design|wohnen|wohnideen|wohnkultur|einrichtung|einrichtungen|einrichtungshaus|moebel|moebelhaus|raum|raumdesign|werkstatt|studio|meisterbetrieb|fachgeschaeft|handwerk|haus)$/;
export function nameWoerter(s) {
  const w = grund(s).split(/[^a-z0-9]+/).filter(x => x.length >= 2 && !RECHT.has(x));
  const eigen = w.filter(x => !BRANCHE_WORT.test(x) && x.length >= 3);
  return eigen.length ? eigen : w;
}
// Gemeinsame Wörter: min = Anteil am kürzeren Namen (ähnlich), max = Anteil am längeren Namen (1 = gleich)
export function namenGleich(a, b) {
  const A = new Set(nameWoerter(a)), Bw = new Set(nameWoerter(b));
  if (!A.size || !Bw.size) return { min: 0, max: 0 };
  let n = 0; for (const x of A) if (Bw.has(x) || [...Bw].some(y => x.length >= 5 && y.length >= 5 && (x.startsWith(y) || y.startsWith(x)))) n++;
  return { min: n / Math.min(A.size, Bw.size), max: n / Math.max(A.size, Bw.size) };
}
export const strasseNorm = s => grund(s).replace(/strasse\b|str\b\.?/g, "str").replace(/[^a-z0-9]/g, "");
// Telefonnummer: nur Ziffern, +49/0049 → 0; verglichen werden die letzten 8 Ziffern (Vorwahl-Schreibweisen egal)
export const telNorm = s => { const d = String(s || "").replace(/^\s*(\+|00)49\s*(\(0\))?/, "0").replace(/\D/g, ""); return d.length >= 7 ? d.slice(-8) : ""; };

// kunden: alle Kunden (auch deaktivierte) mit lat/lng (Mitte PLZ). Ergebnis je Betrieb: { art: "neu" | "vielleicht" | "kunde", k (Kunde), grund }
export function abgleich(b, kunden) {
  const tb = [b.tel, b.mob].map(telNorm).filter(Boolean), sb = strasseNorm(b.str);
  let best = null;
  const merke = (art, k, grund, w) => { if (!best || w > best.w) best = { art, k, grund, w }; };
  for (const k of kunden) {
    const tk = [k.tel, k.mob, k.tel2, k.dk].map(telNorm).filter(Boolean);
    if (tb.length && tk.some(t => tb.includes(t))) { merke("kunde", k, "gleiche Telefonnummer", 100); continue; }
    // Name mit und ohne Zusatz (n2) vergleichen, das bessere zählt
    const g1 = namenGleich(b.n1, k.n1), g2 = k.n2 ? namenGleich(b.n1, k.n1 + " " + k.n2) : g1;
    const ng = Math.max(g1.min, g2.min), gleich = Math.max(g1.max, g2.max) >= 0.99, gleichePlz = b.plz && !b.plzUngefaehr && k.plz && String(k.plz) === String(b.plz);
    const gleicheStr = gleichePlz && sb.length > 3 && sb === strasseNorm(k.str);
    const km = k.lat != null ? luftlinie(b, k) : 999;
    if (gleicheStr && (ng > 0 || !nameWoerter(b.n1).length)) { merke("kunde", k, "gleiche Adresse", 90 + ng); continue; }
    if (gleicheStr) { merke("vielleicht", k, "gleiche Adresse, anderer Name", 50); continue; }
    if (gleich && (gleichePlz || km < 15)) { merke("kunde", k, "gleicher Name in der Nähe", 80); continue; }
    if (ng >= 0.5 && (gleichePlz || km < 15)) { merke("vielleicht", k, "ähnlicher Name in der Nähe", 40 + ng * 10 - km / 10); continue; }
    if (gleich && km < 40) merke("vielleicht", k, "gleicher Name, anderer Ort", 30 - km / 10);
  }
  return best ? { art: best.art, k: best.k, grund: best.grund } : { art: "neu" };
}

// Öffnungszeiten aus OpenStreetMap lesbar machen: „Mo-Fr 09:00-18:00; Sa 10:00-13:00“ → „Mo-Fr 09:00-18:00, Sa 10:00-13:00“
export const ohText = s => String(s || "").replace(/\s*;\s*/g, ", ").replace(/\boff\b/gi, "geschlossen").replace(/\bTh\b/g, "Do").replace(/\bWe\b/g, "Mi").replace(/\bTu\b/g, "Di").replace(/\bSu\b/g, "So");
