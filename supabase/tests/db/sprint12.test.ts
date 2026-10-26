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
