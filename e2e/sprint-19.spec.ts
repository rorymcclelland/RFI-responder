/**
 * Sprint 19's agreed cases (docs/testing/sprint-19-test-pack.md), as browser tests (Sprint 20, S20-1;
 * Rory, Q4: Sprint 19 is signed off from these). The admin assigns Bluefin questions to a member, who
 * answers them on "Questions for you"; the same on the local seed and on staging after a demo reset.
 *
 * Each test assigns and checks its own question, so a failure in one does not decide another's result.
 * They do share one database, so a second run needs a fresh one (`npx supabase db reset` locally; CI
 * starts from a fresh seed, and staging is reset before each run).
 */
import { test, expect, PEOPLE, TARGET, signIn, caption, nav, openResponse, card, expand, checks } from './support';
import type { Page } from '@playwright/test';

const BLUEFIN = 'Bluefin Freight (fictional): security questionnaire';
// Bluefin's questions still to do in the demo data, one per test.
const SEND = 'Do you give staff paid volunteering days each year?'; // no draft: the member writes one
const HAND_BACK = 'What compliance certifications does your organization hold?'; // a draft, citing KB-0018 and KB-0017
const STALE = 'What endpoint protection solutions are deployed?'; // a draft, citing KB-0011
const APPROVE = 'フィッシング攻撃をどのように検知し、対応していますか？'; // no draft
const SENT = 'What is the annual subscription price for 250 users?'; // pricing: never drafted

const { admin, member } = PEOPLE;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const firstName = (name: string) => name.split(' ')[0];
const approvedBy = (name: string) => new RegExp(`^Approved.*by ${escape(name)}`);

/** As the admin, in Bluefin, assigns a question to the member, and checks it was assigned. */
async function assign(page: Page, question: string) {
  await caption(page, `${admin.name} assigns "${question}" to ${member.name}`);
  await openResponse(page, BLUEFIN);
  const c = await expand(page, question);
  await expect(c.getByText('Assigned', { exact: true })).toHaveCount(0);
  await c.getByRole('button', { name: /^Assign (for review|another)/ }).click();
  const row = c.locator('div.flex.items-start', { has: page.getByText(member.name, { exact: true }) });
  await row.getByRole('button', { name: 'Assign', exact: true }).click();
  // The card's header says so (it said nothing before).
  await expect(c.getByText('Assigned', { exact: true })).toBeVisible();
}

/** As the member, opens a question for them from Assignments. */
async function openForYou(page: Page, question: string) {
  await nav(page, 'Assignments');
  await forYouRow(page, question).click();
  const panel = page.getByRole('complementary', { name: 'The question' });
  await expect(panel.getByRole('heading', { name: question })).toBeVisible();
  return panel;
}

/** A question's row in the member's list, with its state in words. */
const forYouRow = (page: Page, question: string) =>
  page.getByRole('region', { name: 'Questions' }).getByRole('button', { name: new RegExp(escape(question)) });

test('Home, as an admin', async ({ browser }) => {
  checks('S19 1');
  const page = await signIn(browser, admin);
  await caption(page, 'Everyone lands on Home: what needs you, your responses, what we know');
  await expect(page.getByRole('heading', { name: `Hello, ${firstName(admin.name)}` })).toBeVisible();
  await expect(page.locator('header nav').getByRole('button').first()).toHaveAccessibleName('Home');
  await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your responses' })).toBeVisible();
  await expect(page.getByText('You own no response in progress.')).toBeVisible();
  const know = page.getByRole('complementary', { name: 'What we know' });
  await expect(know).toContainText(/\d+ answers, \d+ in English and \d+ in Japanese/);
  await expect(know.getByRole('button', { name: 'Open Knowledge' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Ask it a question' })).toBeVisible();

  await caption(page, 'For admins: the answers waiting for review, as one line');
  await expect(page.getByText('For admins (1)', { exact: true })).toBeVisible();
  const review = page.getByRole('button', { name: /Answers to review/ });
  await expect(review).toContainText(/\d+ translations? to check/);
  await expect(review).toContainText(/\d+ proposed changes?/);
  await review.click();
  await caption(page, 'It opens Knowledge, All answers, with those answers filtered');
  await expect(page.getByRole('heading', { name: 'All answers' })).toBeVisible();
  for (const label of ['Waiting for review', 'Translation to check', 'Overdue for review']) {
    await expect(page.getByRole('checkbox', { name: new RegExp(`^${label}`) })).toBeChecked();
  }
  await expect(page.getByRole('checkbox', { name: /^Reviewed and current/ })).not.toBeChecked();
});

test('A question for the member, sent to the owner, and the owner uses their answer', async ({ browser }) => {
  checks('S19 2', 'S19 3');
  const boss = await signIn(browser, admin);
  await assign(boss, SEND);

  const m = await signIn(browser, member);
  await caption(m, `${member.name} lands on Home: the question is waiting for them`);
  await expect(m.getByText('Questions for you (1)', { exact: true })).toBeVisible();
  await expect(m.getByText(/^For admins/)).toHaveCount(0);
  const item = m.getByRole('button', { name: new RegExp(escape(SEND)) });
  await expect(item).toContainText(`${admin.name} asked you · ${BLUEFIN} · due `);
  await item.click();

  await caption(m, 'Assignments opens on that question, with everything needed to answer it');
  const panel = m.getByRole('complementary', { name: 'The question' });
  await expect(panel.getByRole('heading', { name: SEND })).toBeVisible();
  await expect(panel).toContainText(`${BLUEFIN} · due `);
  await expect(panel).toContainText(`asked by ${admin.name}`);
  await expect(panel).toContainText('Working on it.');
  await expect(panel).toContainText('nothing was drafted: write the answer');
  await expect(panel.getByRole('button', { name: 'Open it in the response' })).toBeVisible();
  await expect(panel.getByLabel('Your answer')).toHaveValue('');
  await expect(panel.getByRole('button', { name: 'Send to the owner' })).toBeDisabled();

  await caption(m, 'Notes for the owner');
  await panel.getByRole('button', { name: 'Add Notes' }).click();
  await panel.getByLabel('Notes, for you and the owner').fill('Checked with HR.');
  await panel.getByRole('button', { name: 'Save notes' }).click();
  await expect(m.getByText('Notes saved.')).toBeVisible();
  await expect(panel.getByText('Notes: Checked with HR.')).toBeVisible();

  await caption(m, 'The answer, sent to the owner to decide');
  const answer = 'Yes. Every employee has two paid volunteering days a year (synthetic answer for the demo).';
  await panel.getByLabel('Your answer').fill(answer);
  await panel.getByRole('button', { name: 'Send to the owner' }).click();
  await expect(m.getByText('Sent to the owner, who decides.')).toBeVisible();
  await expect(forYouRow(m, SEND)).toContainText('You sent your answer to the owner');

  await caption(boss, `${admin.name} sees it on Home, under Answered by colleagues`);
  await nav(boss, 'Home');
  const answered = boss.getByRole('button', { name: new RegExp(escape(SEND)) });
  await expect(answered).toContainText(`${member.name} answered · ${BLUEFIN}`);
  await answered.click();

  await caption(boss, 'It opens the response at that question, still to do, with their answer and Use their answer');
  const c = card(boss, SEND);
  await expect(c.getByText(`${member.name} marked it answered, with this answer:`)).toBeVisible();
  await expect(c.getByText(answer)).toBeVisible();
  await expect(c.getByText('Checked with HR.')).toBeVisible();
  await expect(c.getByRole('button', { name: 'Leave unanswered' })).toBeVisible();
  await c.getByRole('button', { name: 'Use their answer' }).click();
  await expect(c.locator('textarea')).toHaveValue(answer);
  await c.getByRole('button', { name: 'Save & approve' }).click();
  await expect(c.getByText(approvedBy(admin.name))).toBeVisible();
});

test('Hand back, with a note', async ({ browser }) => {
  checks('S19 4');
  const boss = await signIn(browser, admin);
  await assign(boss, HAND_BACK);

  const m = await signIn(browser, member);
  const panel = await openForYou(m, HAND_BACK);
  await caption(m, 'The question has a draft, its confidence and checker, and the answers it was drawn from');
  await expect(panel.getByLabel('Your answer')).not.toHaveValue('');
  await expect(panel).toContainText(/Confidence: .+ · Checker: /);
  await expect(panel.getByRole('button', { name: 'KB-0018' })).toBeVisible();

  await caption(m, `${member.name} is not the right person: Hand back, with a reason of at least 5 characters`);
  await panel.getByRole('button', { name: 'Hand back' }).click();
  const why = panel.getByLabel('Why is this not for you?');
  const send = panel.getByRole('button', { name: 'Hand it back' });
  for (const short of ['no', 'abcd', '   ab   ']) {
    await why.fill(short);
    await expect(send).toBeDisabled();
  }
  await why.fill('abcde');
  await expect(send).toBeEnabled();
  await why.fill('Ask the legal team.');
  await send.click();
  await expect(m.getByText('Handed back to the owner, with your note.')).toBeVisible();
  await expect(forYouRow(m, HAND_BACK)).toContainText('You handed this back');

  await caption(boss, `${admin.name} sees it handed back, on Home and on the question`);
  await nav(boss, 'Home');
  const item = boss.getByRole('button', { name: new RegExp(escape(HAND_BACK)) });
  await expect(item).toContainText(`${member.name} handed this back: Handed back: Ask the legal team. · ${BLUEFIN}`);
  await item.click();
  const c = card(boss, HAND_BACK);
  await expect(c.getByText(`${member.name} handed this back:`)).toBeVisible();
  await expect(c.getByText(/Ask the legal team\./)).toBeVisible();

  await caption(m, 'The answers it was drawn from open on their own page under Knowledge');
  await m.getByRole('complementary', { name: 'The question' }).getByRole('button', { name: 'KB-0018' }).click();
  await expect(m.getByRole('complementary', { name: 'Selected answer' })).toContainText('KB-0018');
});

test('Approve, and when the owner was quicker', async ({ browser }) => {
  checks('S19 5');
  const boss = await signIn(browser, admin);
  await assign(boss, STALE);
  const m = await signIn(browser, member);
  const panel = await openForYou(m, STALE);

  await caption(boss, `Meanwhile ${admin.name} approves the same question`);
  const c = card(boss, STALE);
  await c.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(c.getByText(approvedBy(admin.name))).toBeVisible();

  await caption(m, `${member.name}, on the screen opened before, presses Approve: nothing is overwritten`);
  const other = 'A different answer, written on a screen opened before the owner decided.';
  await panel.getByLabel('Your answer').fill(other);
  await panel.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(m.getByText('The owner has already decided this question since you opened it, so nothing was changed. The list now shows their decision.')).toBeVisible();
  await expect(forYouRow(m, STALE)).toContainText('Approved; nothing more is needed from you');

  await boss.reload();
  await openResponse(boss, BLUEFIN);
  const after = await expand(boss, STALE);
  await expect(after.getByText(approvedBy(admin.name))).toBeVisible();
  await expect(after.getByText(other)).toHaveCount(0);

  await caption(boss, `A question nobody else is deciding: ${member.name} writes the answer and approves it`);
  await assign(boss, APPROVE);
  await m.reload();
  const p2 = await openForYou(m, APPROVE);
  await p2.getByLabel('Your answer').fill('We detect phishing with mail filtering and user reports, and respond under the incident process (synthetic answer).');
  await p2.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(m.getByText('Approved. The owner will see it as decided.')).toBeVisible();
  await expect(forYouRow(m, APPROVE)).toContainText('Approved; nothing more is needed from you');
  await boss.reload();
  await openResponse(boss, BLUEFIN);
  const c2 = await expand(boss, APPROVE);
  await expect(c2.getByText(approvedBy(member.name))).toBeVisible();
});

test('On a phone, and the Sent list', async ({ browser }) => {
  checks('S19 6');
  const boss = await signIn(browser, admin);
  await assign(boss, SENT);

  const phone = await signIn(browser, member, { width: 390, height: 844 });
  await caption(phone, 'At phone width Home stacks and nothing scrolls sideways');
  expect(await overflow(phone)).toEqual([]);
  const needs = await phone.getByRole('heading', { name: 'Needs you' }).boundingBox();
  const know = await phone.getByRole('complementary', { name: 'What we know' }).boundingBox();
  expect(know!.y).toBeGreaterThan(needs!.y);
  await nav(phone, 'Assignments');
  await caption(phone, 'Assignments stacks too: the list, then the question');
  await forYouRow(phone, SENT).click();
  const list = await phone.getByRole('region', { name: 'Questions' }).boundingBox();
  const q = await phone.getByRole('complementary', { name: 'The question' }).boundingBox();
  expect(q!.y).toBeGreaterThan(list!.y);
  expect(await overflow(phone)).toEqual([]);

  await caption(boss, 'Sent lists the questions you assigned, with their stages, and no buttons to move them on by hand');
  await nav(boss, 'Assignments');
  await boss.getByRole('button', { name: 'Sent', exact: true }).click();
  const row = boss.locator('div.rounded-2xl.border', { has: boss.getByText(SENT, { exact: true }) });
  await expect(row.locator('.status-pill')).toHaveText('Working on it');
  await row.getByText(SENT, { exact: true }).click();
  await expect(row.getByRole('button', { name: /Add Notes|Edit Notes/ })).toBeVisible();
  for (const old of ['Start working on it', 'Mark as answered', 'Mark as approved']) {
    await expect(row.getByRole('button', { name: old })).toHaveCount(0);
  }
});

test('A member who was not assigned cannot see or decide the question', async ({ browser }) => {
  test.skip(TARGET === 'staging', 'Needs a third person: the seed has one, staging has two test people');
  checks('S19 8');
  const maya = await signIn(browser, { email: 'maya.patel@example.com', name: 'Maya Patel' });
  await caption(maya, 'Maya was assigned nothing on Bluefin: Home does not list it, and the card has no decision buttons');
  await expect(maya.getByRole('button', { name: new RegExp(escape(STALE)) })).toHaveCount(0);
  await openResponse(maya, BLUEFIN);
  const c = card(maya, SENT);
  await c.getByText(SENT, { exact: true }).click();
  await expect(c.getByText('Only the response owner, an admin, or someone this question is assigned to can decide it.')).toBeVisible();
  await expect(c.getByRole('button', { name: /^(Approve|Write an answer)$/ })).toHaveCount(0);
});

/** Elements wider than the window at its current width: the page, or any section, aside or form. */
async function overflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const out: string[] = [];
    if (document.documentElement.scrollWidth > w) out.push(`page ${document.documentElement.scrollWidth} > ${w}`);
    for (const el of Array.from(document.querySelectorAll('section, aside, form'))) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > w + 1 || r.left < -1)) out.push(`${el.tagName.toLowerCase()} ${el.getAttribute('aria-label') ?? ''} ${Math.round(r.left)}..${Math.round(r.right)}`);
    }
    return out;
  });
}
