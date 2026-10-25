/**
 * Planted unsupported claims for testing the faithfulness judge (Sprint 9, S9-3, F-19). Each rule
 * changes or adds exactly one sentence in a faithful draft, by a fixed rule in code (not by a model),
 * so that the draft says something its cited entries do not. The marker is a word or phrase in the
 * planted sentence that appears in none of the sources, used to match the judge's verdict to the plant.
 * Planted errors written by rules may be easier to spot than real ones; the report says so.
 */
export interface Plant { text: string; marker: string }
export interface PlantRule { name: string; plant: (draft: string, sources: string[]) => Plant | null }

const REFS = /\n\n\[References:[^\]]*\]\s*$/;
const body = (d: string) => d.replace(REFS, '');
const refs = (d: string) => d.match(REFS)?.[0] ?? '';
const inSources = (sources: string[], s: string) => sources.some((x) => x.toLowerCase().includes(s.toLowerCase()));
/** Replace the first match in the body only, never in the reference list. */
const replaceFirst = (d: string, re: RegExp, to: (m: string) => string) => {
  const b = body(d);
  const m = b.match(re);
  return m ? { text: b.replace(re, to(m[0])) + refs(d), from: m[0] } : null;
};
const append = (d: string, sentence: string) => `${body(d).trimEnd()} ${sentence}${refs(d)}`;

const FREQUENCY: Record<string, string> = { daily: 'weekly', weekly: 'monthly', monthly: 'annually', quarterly: 'monthly', annually: 'quarterly', annual: 'quarterly' };

export const PLANT_RULES: PlantRule[] = [
  {
    name: 'changed frequency',
    plant: (d, sources) => {
      const re = new RegExp(`\\b(${Object.keys(FREQUENCY).join('|')})\\b`, 'i');
      const r = replaceFirst(d, re, (m) => FREQUENCY[m.toLowerCase()]);
      if (!r) return null;
      const marker = FREQUENCY[r.from.toLowerCase()];
      return inSources(sources, marker) ? null : { text: r.text, marker };
    },
  },
  {
    name: 'changed figure',
    plant: (d, sources) => {
      const re = /(?<![\w-])(\d+)(?=\s?(?:days?|hours?|months?|years?|minutes?|%|percent)\b)/i;
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

/** For each faithful draft: the draft itself as a control, and one planted copy per rule that applies. */
export function plantSet(drafts: { id: string; text: string; sources: string[] }[]): PlantItem[] {
  return drafts.flatMap((d) => [
    { id: d.id, rule: 'control', text: d.text, marker: null },
    ...PLANT_RULES.map((r) => ({ r, p: r.plant(d.text, d.sources) }))
      .filter((x): x is { r: PlantRule; p: Plant } => x.p !== null)
      .map(({ r, p }) => ({ id: d.id, rule: r.name, text: p.text, marker: p.marker })),
  ]);
}

/** Caught: the judge marked a claim holding the planted marker as unsupported. */
export function caught(claims: { claim: string; supported: boolean }[], marker: string): boolean {
  return claims.some((c) => !c.supported && c.claim.toLowerCase().includes(marker.toLowerCase()));
}
