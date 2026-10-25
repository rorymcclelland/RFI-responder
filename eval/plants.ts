/**
 * Planted unsupported claims for testing the faithfulness judge (Sprint 9, S9-3, F-19). Each rule
 * changes or adds exactly one sentence in a faithful English draft, by a fixed rule in code (not by a
 * model), so that the draft says something its cited entries do not. The marker is a word or number
 * in the planted sentence that appears in none of the sources, used to match the judge's verdict to
 * the plant. Planted errors written by rules may be easier to spot than real ones; the report says so.
 *
 * Security review, Sprint 9: everything from the reference list on (including a translation note)
 * is kept as it is and plants go into the body only; Japanese drafts are not planted in; a figure
 * after "within", "up to" and similar is left alone (a larger bound would still be true), and a
 * frequency is only made more frequent (a less frequent one could still be true).
 */
export interface Plant { text: string; marker: string }
export interface PlantRule { name: string; plant: (draft: string, sources: string[]) => Plant | null }

/** The draft's body, and its tail: the reference list and anything after it (a translation note). */
function split(d: string): { body: string; tail: string } {
  const i = d.indexOf('\n\n[References:');
  return i < 0 ? { body: d, tail: '' } : { body: d.slice(0, i), tail: d.slice(i) };
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A marker as a whole word or number, so "9" does not match "90" and "monthly" not "bimonthly". */
const markerRe = (m: string) => new RegExp(`(?<![\\w-])${escape(m)}(?![\\w-])`, 'i');
const inSources = (sources: string[], m: string) => sources.some((x) => markerRe(m).test(x));
const isJapanese = (d: string) => /[぀-ヿ一-鿿]/.test(d);

/** Replace the first match in the body only, never in the tail. */
function replaceFirst(d: string, re: RegExp, to: (m: string) => string) {
  const { body, tail } = split(d);
  const m = body.match(re);
  return m ? { text: body.replace(re, to(m[0])) + tail, from: m[0] } : null;
}
const append = (d: string, sentence: string) => {
  const { body, tail } = split(d);
  return `${body.trimEnd()} ${sentence}${tail}`;
};
const sameCase = (from: string, to: string) => (from[0] === from[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to);

/** Only ever more frequent than the source says. */
const MORE_FREQUENT: Record<string, string> = { weekly: 'daily', monthly: 'weekly', quarterly: 'monthly', annually: 'quarterly', annual: 'quarterly', yearly: 'quarterly' };

export const PLANT_RULES: PlantRule[] = [
  {
    name: 'changed frequency',
    plant: (d, sources) => {
      const re = new RegExp(`(?<![\\w-])(${Object.keys(MORE_FREQUENT).join('|')})(?![\\w-])`, 'i');
      const r = replaceFirst(d, re, (m) => sameCase(m, MORE_FREQUENT[m.toLowerCase()]));
      if (!r) return null;
      const marker = MORE_FREQUENT[r.from.toLowerCase()];
      return inSources(sources, marker) ? null : { text: r.text, marker };
    },
  },
  {
    name: 'changed figure',
    plant: (d, sources) => {
      // An exact figure (every 90 days, 30% of), not a bound ("within 4 hours" would stay true at 9),
      // not either end of a range (24–72 hours), and not 1 ("3 year" would give itself away).
      const re = /(?<!(?:within|up to|at least|at most|less than|more than|under|over|no more than|no later than|after|before)\s)(?<![\w.\-–])(?!1\b)(\d+)(?![–-]\d)(?=\s?(?:%|percent\b|days?\b|hours?\b|months?\b|years?\b|minutes?\b))/i;
      const r = replaceFirst(d, re, (m) => String(Number(m) * 2 + 1));
      if (!r) return null;
      const marker = String(Number(r.from) * 2 + 1);
      return inSources(sources, marker) ? null : { text: r.text, marker };
    },
  },
  {
    name: 'added certification',
    plant: (d, sources) => (inSources(sources, 'FedRAMP') ? null : { text: append(d, 'We also hold FedRAMP High authorisation.'), marker: 'FedRAMP' }),
  },
  {
    name: 'absolute claim',
    plant: (d, sources) => (inSources(sources, 'never experienced') ? null : { text: append(d, 'We have never experienced a data breach.'), marker: 'never experienced' }),
  },
];

export interface PlantItem { id: string; rule: string; text: string; marker: string | null }

/** For each faithful English draft: the draft itself as a control, and one planted copy per rule that applies. */
export function plantSet(drafts: { id: string; text: string; sources: string[] }[]): PlantItem[] {
  return drafts.filter((d) => !isJapanese(d.text)).flatMap((d) => [
    { id: d.id, rule: 'control', text: d.text, marker: null },
    ...PLANT_RULES.map((r) => ({ r, p: r.plant(d.text, d.sources) }))
      .filter((x): x is { r: PlantRule; p: Plant } => x.p !== null)
      .map(({ r, p }) => ({ id: d.id, rule: r.name, text: p.text, marker: p.marker })),
  ]);
}

/** Caught: the judge marked a claim holding the planted marker (as a whole word or number) as unsupported. */
export function caught(claims: { claim: string; supported: boolean }[], marker: string): boolean {
  return claims.some((c) => !c.supported && markerRe(marker).test(c.claim));
}
