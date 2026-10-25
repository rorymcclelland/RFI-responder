// Sprint 9, S9-3 (F-19). Test numbers refer to docs/refinement/sprint-9.md.
import { describe, expect, it } from 'vitest';
import { caught, plantSet, PLANT_RULES } from './plants';

const draft = 'We encrypt data at rest with AES-256. Keys rotate every 90 days and access is reviewed quarterly.\n\n[References: KB-0001]';
const sources = ['Data at rest is encrypted with AES-256. Keys are rotated every 90 days. Access to keys is reviewed quarterly.'];

describe('S9-3 test 1: each plant rule changes one claim', () => {
  it.each(PLANT_RULES.map((r) => [r.name, r]))('%s', (_n, rule) => {
    const p = rule.plant(draft, sources);
    expect(p).not.toBeNull();
    expect(p!.text).not.toBe(draft);
    // The planted marker is in the new draft and in none of the sources: the claim is unsupported.
    expect(p!.text.toLowerCase()).toContain(p!.marker.toLowerCase());
    for (const s of sources) expect(s.toLowerCase()).not.toContain(p!.marker.toLowerCase());
    // The reference list is untouched, and only one sentence changed or was added.
    expect(p!.text).toContain('[References: KB-0001]');
    const before = draft.split(/(?<=\.)\s+/);
    const after = p!.text.split(/(?<=\.)\s+/);
    expect(after.filter((s) => !before.includes(s))).toHaveLength(1);
  });

  it('skips a rule that cannot apply, rather than planting something supported', () => {
    const fig = PLANT_RULES.find((r) => r.name === 'changed figure')!;
    expect(fig.plant('We encrypt data at rest.\n\n[References: KB-0001]', sources)).toBeNull();
    const cert = PLANT_RULES.find((r) => r.name === 'added certification')!;
    expect(cert.plant(draft, ['We hold FedRAMP High authorisation.'])).toBeNull();
  });
});

describe('S9-3 test 2: unchanged drafts are included as controls', () => {
  it('every draft gives a control and its applicable plants', () => {
    const set = plantSet([{ id: 'd001', text: draft, sources }]);
    expect(set.filter((x) => x.rule === 'control')).toHaveLength(1);
    expect(set.filter((x) => x.rule !== 'control').length).toBe(PLANT_RULES.length);
    expect(set.find((x) => x.rule === 'control')!.text).toBe(draft);
  });
});

describe('scoring', () => {
  it('a plant is caught only when the judge marks a claim holding its marker as unsupported', () => {
    expect(caught([{ claim: 'We hold FedRAMP High authorisation.', supported: false }], 'FedRAMP')).toBe(true);
    expect(caught([{ claim: 'We hold FedRAMP High authorisation.', supported: true }], 'FedRAMP')).toBe(false);
    expect(caught([{ claim: 'Keys rotate every 90 days.', supported: false }], 'FedRAMP')).toBe(false);
  });
});
