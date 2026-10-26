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
