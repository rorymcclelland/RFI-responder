// Sprint 12. Test numbers refer to docs/refinement/sprint-12.md. Role matrix: decision 0003.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, buildDatabase, closePool, createUser, refused, type TestUser } from './harness';
import { one } from './fixtures';

let member: TestUser;
let admin: TestUser;

beforeAll(async () => {
  await buildDatabase();
  member = await createUser();
  admin = await createUser({ admin: true });
});
afterAll(closePool);

const entry = async (question: string, answer: string) =>
  one<{ id: string; language: string }>(`INSERT INTO kb_entries (question, answer, tags, origin) VALUES ($1, $2, '{}', 'seed') RETURNING id, language`, [question, answer]);

describe('S12-1 every entry knows its language', () => {
  it('1. is detected from the text', async () => {
    expect((await entry('How is data encrypted at rest (S12)?', 'With AES-256.')).language).toBe('en');
    expect((await entry('保存データはどのように暗号化されていますか（S12）？', 'AES-256で暗号化しています。')).language).toBe('ja');
    expect((await entry('Describe your data residency (S12).', 'データは東京リージョンに保存され、国外には転送されません。')).language).toBe('ja');
    expect((await entry('Where is your head office (S12)?', 'Our head office is in London, with a sales office in 東京 serving customers across Asia and the Pacific region.')).language).toBe('en');
  });

  it('2. follows a correction through review', async () => {
    const e = await entry('Which regions do you host in (S12)?', 'EU and UK.');
    await as(admin, async (q) => {
      await q(`SELECT review_entry($1, $2, $3)`, [e.id, 'どの地域でホストしていますか（S12）？', 'EUと英国です。']);
      expect((await q(`SELECT language FROM kb_entries WHERE id = $1`, [e.id])).rows[0].language).toBe('ja');
    });
  });

  it('3. nobody sets it directly, not even an admin, and an insert cannot choose it', async () => {
    const e = await entry('Do you support SSO (S12)?', 'Yes, SAML 2.0.');
    for (const u of [member, admin]) await refused(as(u, (q) => q(`UPDATE kb_entries SET language = 'ja' WHERE id = $1`, [e.id])));
    await refused(as(member, (q) => q(`INSERT INTO kb_entries (question, answer, tags, origin, language) VALUES ('Forged (S12)?', 'x', '{}', 'manual', 'ja')`)));
  });
});

// ── S12-3 ────────────────────────────────────────────────────────────────────
import { question, response, session } from './fixtures';

async function exportedWith(o: { approver: TestUser; text: string; final: string; cited?: string[]; draftKind?: string; generated?: string; gate?: string | null }) {
  const opp = await response(o.approver.id);
  const s = await session(opp);
  const id = await question(s, { text: o.text, generated: o.generated ?? o.final, sources: o.cited ?? [], cited: o.cited ?? [], draftKind: o.draftKind, gate: o.gate ?? null });
  // The question's language as processing records it (the shared fixture writes 'en').
  await one(`UPDATE rfi_questions SET language = public.text_language(question, '') WHERE id = $1 RETURNING id`, [id]);
  return { s, id };
}

describe('S12-3 Japanese answers are learned; translated ones wait for review', () => {
  it('1. a Japanese answer written by a person is learned as a Japanese entry by the usual rules', async () => {
    const { s, id } = await exportedWith({ approver: admin, text: '監査ログを保管していますか（S12-3 t1）？', final: '', draftKind: 'insufficient_evidence', generated: '該当なし。' });
    await as(admin, async (q) => {
      await q(`UPDATE rfi_questions SET final_answer = '監査ログは1年間保管しています。', status = 'accepted' WHERE id = $1`, [id]);
      const r = (await q(`SELECT record_export($1) AS r`, [s])).rows[0].r as Record<string, number>;
      expect(r.added).toBe(1);
      const e = (await q(`SELECT k.language, k.reviewed_at, k.translated_from FROM kb_entries k JOIN rfi_questions x ON x.learned_entry_id = k.id WHERE x.id = $1`, [id])).rows[0];
      expect(e.language).toBe('ja');
      expect(e.reviewed_at).not.toBeNull();
      expect(e.translated_from).toBeNull();
    });
  });

  it('2. a translated draft, unedited or edited, is learned unreviewed with what it was translated from, even when an admin approved it', async () => {
    const src = await one<{ ref: string }>(`INSERT INTO kb_entries (question, answer, tags, origin) VALUES ('Do you rotate keys (S12-3 t2)?', 'Keys are rotated every 90 days.', '{}', 'seed') RETURNING ref`);
    for (const edited of [false, true]) {
      const draft = '鍵は90日ごとに更新しています。\n\n[References: ' + src.ref + ']\n\n[Translated from English knowledge-base entries. A Japanese speaker should review it before it is sent.]';
      const { s, id } = await exportedWith({ approver: admin, text: `鍵を更新していますか（S12-3 t2 ${edited}）？`, final: draft, generated: draft, cited: [src.ref], gate: 'translation' });
      await as(admin, async (q) => {
        await q(`UPDATE rfi_questions SET final_answer = $2, status = 'accepted' WHERE id = $1`, [id, edited ? '鍵は90日ごとに自動で更新しています。' : draft]);
        const r = (await q(`SELECT record_export($1) AS r`, [s])).rows[0].r as Record<string, number>;
        expect(r.translated).toBe(1);
        const e = (await q(`SELECT k.answer, k.language, k.reviewed_at, k.translated_from FROM kb_entries k JOIN rfi_questions x ON x.learned_entry_id = k.id WHERE x.id = $1`, [id])).rows[0];
        expect(e.language).toBe('ja');
        expect(e.reviewed_at).toBeNull();
        expect(e.translated_from).toEqual([src.ref]);
        expect(e.answer).not.toMatch(/References|Translated from/);
      });
    }
  });

  it('3. a learned answer never replaces an entry in another language, however close', async () => {
    const en = await one<{ id: string; ref: string }>(`INSERT INTO kb_entries (question, answer, tags, origin) VALUES ('データは暗号化されていますか（S12-3 t3）？', 'Yes, with AES-256.', '{}', 'seed') RETURNING id, ref`);
    // Same question text, so the question rule would match; the existing entry is Japanese (its question), the new answer too.
    const sameLang = await exportedWith({ approver: admin, text: 'データは暗号化されていますか（S12-3 t3）？', final: 'はい、AES-256で暗号化しています。', draftKind: 'insufficient_evidence', generated: '該当なし。' });
    await as(admin, async (q) => {
      await q(`UPDATE rfi_questions SET final_answer = 'はい、AES-256で暗号化しています。', status = 'accepted' WHERE id = $1`, [sameLang.id]);
      const r = (await q(`SELECT record_export($1) AS r`, [sameLang.s])).rows[0].r as Record<string, number>;
      expect(r.superseded).toBe(1);
    });
    const enEntry = await one<{ id: string; ref: string }>(`INSERT INTO kb_entries (question, answer, tags, origin) VALUES ('Is data encrypted (S12-3 t3b)?', 'Yes, with AES-256.', '{}', 'seed') RETURNING id, ref`);
    const cross = await exportedWith({ approver: admin, text: 'Is data encrypted (S12-3 t3b)?', final: 'はい、すべてのデータをAES-256で暗号化しています。', draftKind: 'insufficient_evidence', generated: 'None.' });
    await as(admin, async (q) => {
      await q(`UPDATE rfi_questions SET final_answer = 'はい、すべてのデータをAES-256で暗号化しています。', status = 'accepted' WHERE id = $1`, [cross.id]);
      await q(`SELECT record_export($1)`, [cross.s]);
      expect((await q(`SELECT superseded_by FROM kb_entries WHERE id = $1`, [enEntry.id])).rows[0].superseded_by).toBeNull();
    });
    expect(en.ref).toBeTruthy();
  });

  it('4. a Japanese pricing answer is not learned', async () => {
    const { s, id } = await exportedWith({ approver: admin, text: '価格はいくらですか（S12-3 t4）？', final: '', draftKind: 'person_required', generated: 'Pricing question.', gate: 'pricing' });
    await as(admin, async (q) => {
      await q(`UPDATE rfi_questions SET final_answer = '1席あたり10ポンドです。', status = 'accepted' WHERE id = $1`, [id]);
      const r = (await q(`SELECT record_export($1) AS r`, [s])).rows[0].r as Record<string, number>;
      expect(r.not_learned_pricing).toBe(1);
    });
  });

  it('5. approving a translated entry makes it a reviewed Japanese entry', async () => {
    const src = await one<{ ref: string }>(`INSERT INTO kb_entries (question, answer, tags, origin) VALUES ('Is MFA enforced (S12-3 t5)?', 'MFA is enforced for all staff.', '{}', 'seed') RETURNING ref`);
    const draft = '全従業員に多要素認証を義務付けています。';
    const { s, id } = await exportedWith({ approver: admin, text: '多要素認証を義務付けていますか（S12-3 t5）？', final: draft, cited: [src.ref], gate: 'translation' });
    await as(admin, async (q) => {
      await q(`UPDATE rfi_questions SET status = 'accepted' WHERE id = $1`, [id]);
      await q(`SELECT record_export($1)`, [s]);
      const e = (await q(`SELECT k.id FROM kb_entries k JOIN rfi_questions x ON x.learned_entry_id = k.id WHERE x.id = $1`, [id])).rows[0];
      await q(`SELECT review_entry($1, NULL, NULL)`, [e.id]);
      const after = (await q(`SELECT reviewed_at, language, translated_from FROM kb_entries WHERE id = $1`, [e.id])).rows[0];
      expect(after.reviewed_at).not.toBeNull();
      expect(after.language).toBe('ja');
      expect(after.translated_from).toEqual([src.ref]);
    });
  });

  it('nobody can claim an entry is a translation, or hide that it is one', async () => {
    await refused(as(admin, (q) => q(`INSERT INTO kb_entries (question, answer, tags, origin, translated_from) VALUES ('Forged (S12)?', 'x', '{}', 'manual', '{KB-0001}')`)));
    await refused(as(admin, (q) => q(`UPDATE kb_entries SET translated_from = NULL WHERE translated_from IS NOT NULL`)));
  });

  it('text_language agrees with the generated column', async () => {
    for (const [qn, a] of [['How (S12)?', 'Plain English.'], ['どう（S12）？', 'x'], ['How (S12 b)?', '日本語の回答です。日本語の回答です。']]) {
      const e = await one<{ language: string; f: string }>(`INSERT INTO kb_entries (question, answer, tags, origin) VALUES ($1, $2, '{}', 'seed') RETURNING language, public.text_language($1, $2) AS f`, [qn, a]);
      expect(e.language).toBe(e.f);
    }
  });

  it('S12-5: a seeded translation waits for review; other seed entries count as reviewed', async () => {
    const t = await one<{ reviewed_at: string | null }>(`INSERT INTO kb_entries (question, answer, tags, origin, translated_from) VALUES ('種（S12-5）？', '回答です。', '{}', 'seed', '{KB-0001}') RETURNING reviewed_at`);
    expect(t.reviewed_at).toBeNull();
    const e = await one<{ reviewed_at: string | null }>(`INSERT INTO kb_entries (question, answer, tags, origin) VALUES ('Seed (S12-5)?', 'Yes.', '{}', 'seed') RETURNING reviewed_at`);
    expect(e.reviewed_at).not.toBeNull();
  });

  it('text_language is for record_export only', async () => {
    for (const u of [member, admin]) await refused(as(u, (q) => q(`SELECT public.text_language('a', 'b')`)));
  });
});

describe('Sprint 12 security review: learning across languages', () => {
  type Q = (sql: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  const learned = async (q: Q, id: string) =>
    (await q(`SELECT k.answer, k.language, k.reviewed_at, k.translated_from, k.proposed_replacement_of FROM kb_entries k JOIN rfi_questions x ON x.learned_entry_id = k.id WHERE x.id = $1`, [id])).rows[0];
  const supersededBy = async (q: Q, entryId: string) => (await q(`SELECT superseded_by FROM kb_entries WHERE id = $1`, [entryId])).rows[0].superseded_by;
  /** Accept (with an optional new answer) and record the export as `u`, then check inside the same transaction (each `as` block rolls back). */
  const exportAs = (u: TestUser, s: string, id: string, final: string | undefined, check: (r: Record<string, number>, q: Q) => Promise<void>) => as(u, async (q) => {
    if (final !== undefined) await q(`UPDATE rfi_questions SET final_answer = $2 WHERE id = $1`, [id, final]);
    await q(`UPDATE rfi_questions SET status = 'accepted' WHERE id = $1`, [id]);
    const r = (await q(`SELECT record_export($1) AS r`, [s])).rows[0].r as Record<string, number>;
    await check(r, q as unknown as Q);
  });

  it('M2: an answer citing an unreviewed machine translation is itself a translation, and never replaces it', async () => {
    const y = await one<{ id: string; ref: string }>(`INSERT INTO kb_entries (question, answer, tags, origin, translated_from) VALUES ('鍵を管理していますか（M2）？', '鍵はKMSで管理しています。', '{}', 'seed', '{KB-0004}') RETURNING id, ref`);
    for (const approver of [admin, member]) {
      const { s, id } = await exportedWith({ approver, text: '鍵を管理していますか（M2）？', final: `鍵はKMSで管理しています。\n\n[References: ${y.ref}]`, cited: [y.ref], gate: 'japanese' });
      await exportAs(approver, s, id, '鍵は専用のKMSで管理しています。', async (r, q) => {
        expect(r.superseded).toBeUndefined();
        expect(r.proposed).toBe(1);
        const e = await learned(q, id);
        expect(e.reviewed_at).toBeNull();
        expect(e.translated_from).toEqual(['KB-0004']);
        expect(await supersededBy(q, y.id)).toBeNull();
      });
    }
  });

  it('M3: a draft gated as translated is learned as one, even when the accepted answer is in the source language', async () => {
    const src = await one<{ id: string; ref: string }>(`INSERT INTO kb_entries (question, answer, tags, origin) VALUES ('バックアップは暗号化していますか（M3）？', 'バックアップはAES-256で暗号化しています。', '{}', 'seed') RETURNING id, ref`);
    const { s, id } = await exportedWith({ approver: admin, text: 'Are backups encrypted (M3)?', final: 'Yes. バックアップはAES-256で暗号化しています。', cited: [src.ref], gate: 'translation' });
    await exportAs(admin, s, id, 'バックアップはすべてAES-256で暗号化しています。 Backups are encrypted.', async (r, q) => {
      expect(r.superseded).toBeUndefined();
      const e = await learned(q, id);
      expect(e.reviewed_at).toBeNull();
      expect(e.translated_from).toEqual([src.ref]);
      expect(await supersededBy(q, src.id)).toBeNull();
    });
  });

  it('a translated answer with an entry to replace is a proposal, never a direct replacement (S12-3)', async () => {
    const src = await one<{ ref: string }>(`INSERT INTO kb_entries (question, answer, tags, origin) VALUES ('Is there a WAF (S12 p)?', 'A WAF protects every public endpoint.', '{}', 'seed') RETURNING ref`);
    const old = await one<{ id: string }>(`INSERT INTO kb_entries (question, answer, tags, origin) VALUES ('WAFはありますか（S12 p）？', '古い回答です。', '{}', 'seed') RETURNING id`);
    const { s, id } = await exportedWith({ approver: admin, text: 'WAFはありますか（S12 p）？', final: 'すべての公開エンドポイントをWAFで保護しています。', cited: [src.ref], gate: 'translation' });
    await exportAs(admin, s, id, undefined, async (r, q) => {
      expect(r.proposed).toBe(1);
      const e = await learned(q, id);
      expect(e.proposed_replacement_of).toBe(old.id);
      expect(e.reviewed_at).toBeNull();
    });
  });

  it('a near duplicate in the other language is never replaced, in either direction', async () => {
    for (const [entryQ, entryA, text, answer] of [
      ['Do you log access (S12 nd)?', 'All access is logged.', 'アクセスを記録していますか（S12 nd）？', 'すべてのアクセスを記録し、1年間保管しています。'],
      ['アクセスを監視していますか（S12 nd2）？', 'すべてのアクセスを監視しています。', 'Do you monitor access (S12 nd2)?', 'All access is monitored around the clock.'],
    ]) {
      const near = await one<{ id: string; ref: string }>(`INSERT INTO kb_entries (question, answer, tags, origin) VALUES ($1, $2, '{}', 'seed') RETURNING id, ref`, [entryQ, entryA]);
      // A person's answer (no draft), so nothing is translated; the judge confirmed the entry above the threshold.
      const { s, id } = await exportedWith({ approver: admin, text, final: '', cited: [near.ref], draftKind: 'insufficient_evidence', generated: 'None.' });
      await exportAs(admin, s, id, answer, async (r, q) => {
        expect(r.superseded).toBeUndefined();
        expect(r.added).toBe(1);
        expect(await supersededBy(q, near.id)).toBeNull();
      });
    }
  });

  it('L4: a translation names only the entries in the other language', async () => {
    const en = await one<{ ref: string }>(`INSERT INTO kb_entries (question, answer, tags, origin) VALUES ('Is SSO supported (L4)?', 'SAML SSO is supported.', '{}', 'seed') RETURNING ref`);
    const ja = await one<{ ref: string }>(`INSERT INTO kb_entries (question, answer, tags, origin) VALUES ('SCIMに対応していますか（L4）？', 'SCIMに対応しています。', '{}', 'seed') RETURNING ref`);
    const { s, id } = await exportedWith({ approver: admin, text: 'Do you support SSO and SCIM (L4)?', final: 'SAML SSO and SCIM are supported.', cited: [en.ref, ja.ref], gate: 'translation' });
    await exportAs(admin, s, id, undefined, async (_r, q) => {
      expect((await learned(q, id)).translated_from).toEqual([ja.ref]);
    });
  });

  it('L1 and L2: only the notes the app adds are removed, at the end, and line breaks are trimmed', async () => {
    const { s, id } = await exportedWith({ approver: admin, text: 'Do you share data (L1)?', final: '', draftKind: 'insufficient_evidence', generated: 'None.' });
    await exportAs(admin, s, id, 'Customer data is [References: never] shared with third parties.\n\n', async (_r, q) => {
      expect((await learned(q, id)).answer).toBe('Customer data is [References: never] shared with third parties.');
    });
    const strip = await one<{ t: string }>(`SELECT private.learnable_text(E'Text.\\n\\n[References: KB-0001, KB-0002]\\n\\n[Translated from English knowledge-base entries. A Japanese speaker should review it before it is sent.]\\n') AS t`);
    expect(strip.t).toBe('Text.');
  });

  it('L1: adding bracketed text to an unedited draft is an edit, so nothing is confirmed', async () => {
    const src = await one<{ ref: string }>(`INSERT INTO kb_entries (question, answer, tags, origin) VALUES ('Is there a SOC (L1b)?', 'A SOC runs 24/7.', '{}', 'seed') RETURNING ref`);
    const draft = `A SOC runs 24/7.\n\n[References: ${src.ref}]`;
    const { s, id } = await exportedWith({ approver: admin, text: 'Is there a SOC (L1b)?', final: draft, cited: [src.ref] });
    await exportAs(admin, s, id, `A SOC runs 24/7. [References: and it is outsourced]\n\n[References: ${src.ref}]`, async (r) => {
      expect(r.confirmed).toBeUndefined();
    });
  });

  it('S12-3 test 6: a corrected Japanese answer is learned again on a re-export, by the same rules', async () => {
    const { s, id } = await exportedWith({ approver: admin, text: '侵入テストは年に何回ですか（t6）？', final: '', draftKind: 'insufficient_evidence', generated: '該当なし。' });
    await exportAs(admin, s, id, '侵入テストは年1回実施しています。', async (_r, q) => {
      expect((await learned(q, id)).language).toBe('ja');
      await q(`UPDATE rfi_questions SET final_answer = '侵入テストは年2回実施しています。' WHERE id = $1`, [id]);
      await q(`UPDATE rfi_questions SET status = 'accepted' WHERE id = $1`, [id]);
      const r = (await q(`SELECT record_export($1) AS r`, [s])).rows[0].r as Record<string, number>;
      expect(r.superseded).toBe(1);
      const again = await learned(q, id);
      expect(again.answer).toBe('侵入テストは年2回実施しています。');
      expect(again.language).toBe('ja');
    });
  });
});

describe('Sprint 13 (S13-2): import duplicates are judged per language', () => {
  type R = { inserted: number; duplicates: number; invalid: number };
  const imp = (u: TestUser, entries: object[]) => as(u, async (q) =>
    (await q(`SELECT import_kb_entries($1::jsonb, 'import'::kb_origin, 'f.csv') AS r`, [JSON.stringify(entries)])).rows[0].r as R);

  it('1. the same question twice in one file, both English: one imported, one duplicate', async () => {
    expect(await imp(member, [{ question: 'Dup (S13-2 t1)?', answer: 'One.' }, { question: 'Dup (S13-2 t1)?', answer: 'Two.' }]))
      .toEqual({ inserted: 1, duplicates: 1, invalid: 0 });
  });

  it('2. a question already held in English, imported with a Japanese answer, is imported as a Japanese entry', async () => {
    await one(`INSERT INTO kb_entries (question, answer, tags, origin) VALUES ('Is there a DPO (S13-2 t2)?', 'Yes, a DPO is appointed.', '{}', 'seed') RETURNING id`);
    const r = await as(member, async (q) => {
      const res = (await q(`SELECT import_kb_entries($1::jsonb, 'import'::kb_origin, 'f.csv') AS r`, [JSON.stringify([{ question: 'Is there a DPO (S13-2 t2)?', answer: 'はい、データ保護責任者を任命しています。' }])])).rows[0].r as R;
      const langs = (await q(`SELECT language FROM kb_entries WHERE question = 'Is there a DPO (S13-2 t2)?' ORDER BY language`)).rows.map((x) => x.language);
      return { res, langs };
    });
    expect(r.res).toEqual({ inserted: 1, duplicates: 0, invalid: 0 });
    expect(r.langs).toEqual(['en', 'ja']);
  });

  it('3 and 4. the same Japanese question as an existing Japanese entry, even with other case and spacing, is a duplicate', async () => {
    await one(`INSERT INTO kb_entries (question, answer, tags, origin) VALUES ('SOC2 レポートはありますか（S13-2 t3）？', 'あります。', '{}', 'seed') RETURNING id`);
    expect(await imp(member, [{ question: '  soc2   レポートはありますか（S13-2 t3）？ ', answer: 'あります。最新版を提供できます。' }]))
      .toEqual({ inserted: 0, duplicates: 1, invalid: 0 });
  });

  it('5. anonymous callers still cannot import', async () => {
    await refused(as(null, (q) => q(`SELECT import_kb_entries('[]'::jsonb, 'import'::kb_origin, 'f.csv')`)));
  });
});
