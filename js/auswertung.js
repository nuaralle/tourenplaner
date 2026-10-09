// Auswertung der geschäftlichen Notizen über alle Kunden (2026-10-09).
// Private Notizen (pnotes) werden hier bewusst NIE ausgewertet.
import { iso, parseISO, addDays, today } from "./grundlagen.js";

export const ZEITRAEUME = [["4w", "letzte 4 Wochen"], ["3m", "letzte 3 Monate"], ["6m", "letzte 6 Monate"], ["12m", "letzte 12 Monate"], ["alle", "alle Notizen"], ["frei", "von … bis …"]];
// Zeitraum -> { von, bis } als "JJJJ-MM-TT" (von = "" heißt: ohne Anfang)
export function zeitraum(art, von, bis, heute = today()) {
  if (art === "frei") return { von: von || "", bis: bis || heute };
  if (art === "alle") return { von: "", bis: heute };
  if (art === "4w") return { von: iso(addDays(parseISO(heute), -28)), bis: heute };
  const m = { "3m": 3, "6m": 6, "12m": 12 }[art] || 3, d = parseISO(heute);
  d.setMonth(d.getMonth() - m);
  return { von: iso(d), bis: heute };
}
// Art einer Notiz: vom Programm eingetragene Formular-Notizen oder eigene Besuchsnotiz
export function art(t) {
  if (/^(Bestellung|Angebot) .+ erstellt/.test(t)) return "Bestellformular";
  if (/^Beanstandung erstellt/.test(t)) return "Beanstandung";
  return "Besuchsnotiz";
}
// Alle geschäftlichen Notizen im Zeitraum: [{ k (Kunde), d, t, art }], neueste zuerst. q: Suchtext (Notiz, Kunde, Ort)
export function notizen(kunden, { von, bis }, q = "") {
  const s = q.trim().toLowerCase(), L = [];
  for (const k of kunden) for (const n of k.notes || []) {
    if (!n.t || (von && (!n.d || n.d < von)) || (n.d && n.d > bis)) continue;
    if (s && !(n.t + " " + k.n1 + " " + (k.ort || "")).toLowerCase().includes(s)) continue;
    L.push({ k, d: n.d || "", t: n.t, art: art(n.t) });
  }
  return L.sort((a, b) => b.d.localeCompare(a.d) || a.k.n1.localeCompare(b.k.n1));
}
const FUELL = new Set(("aber alle allem allen aller alles also auch auf aus bei beim bereits bin bis bitte da dabei dafür damit dann das dass dem den denn der des die dies diese diesem diesen dieser dieses doch dort durch ein eine einem einen einer eines erst erstellt etwas für gibt hat hatte hier ihm ihn ihr ihre im in ins ist jetzt kann kein keine man mehr mit muss nach nicht noch nur ob oder ohne schon sehr sein seine sich sie sind so soll über um und uns unter vom von vor war waren was weil wenn werden wie wieder will wir wird wo zu zum zur zwei drei woche wochen heute morgen gestern herr frau kunde kunden").split(" "));
// Häufigste Stichworte (Wörter ab 4 Buchstaben ohne Füllwörter), gezählt einmal pro Notiz
export function stichworte(L, anzahl = 20) {
  const z = new Map();
  for (const n of L) {
    if (n.art !== "Besuchsnotiz") continue;
    const w = new Set((n.t.toLowerCase().match(/[a-zäöüß]{4,}/g) || []).filter(x => !FUELL.has(x)));
    for (const x of w) z.set(x, (z.get(x) || 0) + 1);
  }
  return [...z.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, anzahl);
}
// Nach Kunde gruppiert (Kunden mit den meisten Notizen zuerst)
export function nachKunde(L) {
  const g = new Map();
  for (const n of L) { if (!g.has(n.k)) g.set(n.k, []); g.get(n.k).push(n); }
  return [...g.entries()].sort((a, b) => b[1].length - a[1].length || a[0].n1.localeCompare(b[0].n1));
}
