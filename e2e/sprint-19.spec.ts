/**
 * Sprint 19's agreed cases (docs/testing/sprint-19-test-pack.md), as browser tests (Sprint 20, S20-1;
 * Rory, Q4: Sprint 19 is signed off from these). The admin assigns Bluefin questions to a member, who
 * answers them on "Questions for you"; the same on the local seed and on staging after a demo reset.
 * Each test uses its own question, so one failing does not change another's result.
 */
import { test, expect, PEOPLE, signIn, caption, nav, openResponse, card, expand, scrollsSideways, checks } from './support';
import type { Page } from '@playwright/test';

const BLUEFIN = 'Bluefin Freight (fictional): security questionnaire';
const SEND = 'Do you give staff paid volunteering days each year?';
const HAND_BACK = 'What compliance certifications does your organization hold?';
const STALE = 'What endpoint protection solutions are deployed?';
const APPROVE = 'フィッシング攻撃をどのように検知し、対応していますか？';

const { admin, member } = PEOPLE;

/** As the admin, in Bluefin, assigns a question to the member. */
async function assign(page: Page, question: string) {
  await caption(page, `${admin.name} assigns "${question}" to ${member.name}`);
  await openResponse(page, BLUEFIN);
  const c = await expand(page, question);
  await c.getByRole('button', { name: /^Assign (for review|another)/ }).click();
  const row = c.locator('div.flex.items-start', { has: page.getByText(member.name, { exact: true }) });
  await row.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(c.getByText(member.name).first()).toBeVisible();
}

/** As the member, opens a question for them from Assignments. */
async function openForYou(page: Page, question: string) {
  await nav(page, 'Assignments');
  await page.getByRole('region', { name: 'Questions' }).getByRole('button', { name: new RegExp(escape(question)) }).click();
  await expect(page.getByRole('complementary', { name: 'The question' }).getByRole('heading', { name: question })).toBeVisible();
  return page.getByRole('complementary', { name: 'The question' });
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('Home, as an admin', async ({ browser }) => {
  checks('S19 1');
  const page = await signIn(browser, admin);
  await caption(page, 'Everyone lands on Home: what needs you, your responses, what we know');
  await expect(page.getByRole('heading', { name: `Hello, ${admin.name.split(' ')[0]}` })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your responses' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What we know' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Ask it a question' })).toBeVisible();

  await caption(page, 'For admins: the answers waiting for review, as one line');
  const review = page.getByRole('button', { name: /Answers to review/ });
  await expect(review).toContainText(/translations? to check/);
  await review.click();
  await caption(page, 'It opens Knowledge with those answers filtered');
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
  const item = m.getByRole('button', { name: new RegExp(escape(SEND)) });
  await expect(m.getByText(/^Questions for you \(\d+\)$/)).toBeVisible();
  await expect(item).toContainText(`${admin.name} asked you`);
  await expect(item).toContainText(BLUEFIN);
  await item.click();

  await caption(m, 'Assignments opens on that question, with everything needed to answer it');
  const panel = m.getByRole('complementary', { name: 'The question' });
  await expect(panel.getByRole('heading', { name: SEND })).toBeVisible();
  await expect(panel).toContainText('Working on it.');
  await expect(panel).toContainText('nothing was drafted: write the answer');
  await expect(panel.getByRole('button', { name: 'Open it in the response' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Send to the owner' })).toBeDisabled();

  await caption(m, 'Notes for the owner');
  await panel.getByRole('button', { name: 'Add Notes' }).click();
  await panel.getByLabel('Notes, for you and the owner').fill('Checked with HR.');
  await panel.getByRole('button', { name: 'Save notes' }).click();
  await expect(m.getByText('Notes saved.')).toBeVisible();

  await caption(m, 'The answer, sent to the owner to decide');
  const answer = 'Yes. Every employee has two paid volunteering days a year (synthetic answer for the demo).';
  await panel.getByLabel('Your answer').fill(answer);
  await panel.getByRole('button', { name: 'Send to the owner' }).click();
  await expect(m.getByText('Sent to the owner, who decides.')).toBeVisible();

  await caption(boss, `${admin.name} sees it on Home, under Answered by colleagues`);
  await nav(boss, 'Home');
  const answered = boss.getByRole('button', { name: new RegExp(escape(SEND)) });
  await expect(answered).toContainText(`${member.name} answered`);
  await answered.click();

  await caption(boss, 'It opens the response at that question, with their answer and Use their answer');
  const c = card(boss, SEND);
  await expect(c.getByText(`${member.name} marked it answered, with this answer:`)).toBeVisible();
  await expect(c.getByText(answer)).toBeVisible();
  await expect(c.getByText('Checked with HR.')).toBeVisible();
  await c.getByRole('button', { name: 'Use their answer' }).click();
  await expect(c.locator('textarea')).toHaveValue(answer);
  await c.getByRole('button', { name: 'Save & approve' }).click();
  await expect(c.getByText(/^Approved/).first()).toBeVisible();
  await expect(c.getByText(new RegExp(`by ${admin.name}`))).toBeVisible();
});

test('Hand back, with a note', async ({ browser }) => {
  checks('S19 4');
  const boss = await signIn(browser, admin);
  await assign(boss, HAND_BACK);

  const m = await signIn(browser, member);
  const panel = await openForYou(m, HAND_BACK);
  await caption(m, `${member.name} is not the right person: Hand back, with a reason`);
  await panel.getByRole('button', { name: 'Hand back' }).click();
  const why = panel.getByLabel('Why is this not for you?');
  await why.fill('no');
  await expect(panel.getByRole('button', { name: 'Hand it back' })).toBeDisabled();
  await why.fill('Ask the legal team.');
  await panel.getByRole('button', { name: 'Hand it back' }).click();
  await expect(m.getByText('Handed back to the owner, with your note.')).toBeVisible();

  await caption(boss, `${admin.name} sees it handed back, on Home and on the question`);
  await nav(boss, 'Home');
  const item = boss.getByRole('button', { name: new RegExp(escape(HAND_BACK)) });
  await expect(item).toContainText(`${member.name} handed this back: Handed back: Ask the legal team.`);
  await item.click();
  const c = card(boss, HAND_BACK);
  await expect(c.getByText(`${member.name} handed this back:`)).toBeVisible();
  await expect(c.getByText(/Ask the legal team\./)).toBeVisible();
});

test('Approve, and when the owner was quicker', async ({ browser }) => {
  checks('S19 5');
  const boss = await signIn(browser, admin);
  await assign(boss, STALE);
  const m = await signIn(browser, member);
  const panel = await openForYou(m, STALE);

  await caption(boss, `Meanwhile ${admin.name} approves the same question`);
  const c = card(boss, STALE);
  const draft = (await c.locator('.whitespace-pre-wrap').first().innerText()).trim();
  await c.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(c.getByText(/^Approved/).first()).toBeVisible();

  await caption(m, `${member.name}, on the screen opened before, presses Approve: nothing is overwritten`);
  await panel.getByLabel('Your answer').fill('A different answer, written on a screen opened before the owner decided.');
  await panel.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(m.getByText('The owner has already decided this question since you opened it, so nothing was changed. The list now shows their decision.')).toBeVisible();
  await expect(m.getByText('Decided', { exact: true })).toBeVisible();

  await boss.reload();
  await expect(card(boss, STALE).getByText(draft.slice(0, 60), { exact: false })).toBeVisible();

  await caption(boss, `A question nobody else is deciding: ${member.name} writes the answer and approves it`);
  await assign(boss, APPROVE);
  await m.reload();
  const p2 = await openForYou(m, APPROVE);
  await p2.getByLabel('Your answer').fill('We detect phishing with mail filtering and user reports, and respond under the incident process (synthetic answer).');
  await p2.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(m.getByText('Approved. The owner will see it as decided.')).toBeVisible();
  await boss.reload();
  const c2 = await expand(boss, APPROVE);
  await expect(c2.getByText(/^Approved/).first()).toBeVisible();
  await expect(c2.getByText(new RegExp(`by ${member.name}`))).toBeVisible();
});

test('On a phone, and the Sent list', async ({ browser }) => {
  checks('S19 6');
  const phone = await signIn(browser, member, { width: 390, height: 844 });
  await caption(phone, 'At phone width, Home and Assignments stack and never scroll sideways');
  expect(await scrollsSideways(phone)).toBe(false);
  await nav(phone, 'Assignments');
  await expect(phone.getByRole('heading', { name: 'Assignments' })).toBeVisible();
  expect(await scrollsSideways(phone)).toBe(false);

  const boss = await signIn(browser, admin);
  await caption(boss, 'Sent lists the questions you assigned, with their stages, and no buttons to move them on by hand');
  await nav(boss, 'Assignments');
  await boss.getByRole('button', { name: 'Sent', exact: true }).or(boss.getByRole('tab', { name: 'Sent' })).first().click();
  await expect(boss.getByText(new RegExp([SEND, HAND_BACK, STALE].map(escape).join('|'))).first()).toBeVisible();
  for (const old of ['Start working on it', 'Mark as answered', 'Mark as approved']) {
    await expect(boss.getByRole('button', { name: old })).toHaveCount(0);
  }
});
