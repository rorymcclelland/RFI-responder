/**
 * Sprint 21's agreed cases (docs/refinement/sprint-21.md), as browser tests.
 */
import { test, expect, PEOPLE, TARGET, signIn, caption, checks } from './support';

const { admin } = PEOPLE;

test('Ask it a question: the real pipeline on staging, the fallback locally', async ({ browser }) => {
  checks(TARGET === 'staging' ? 'S21-4 1' : 'S21-4 2');
  // The demo page names the step that used the real AI model (Sprint 20, Q2).
  if (TARGET === 'staging') test.info().annotations.push({ type: 'real-ai', description: 'Asks one question with the real models' });
  const page = await signIn(browser, admin);
  const ask = page.getByRole('region', { name: 'Ask it a question' });
  await caption(page, TARGET === 'staging'
    ? 'One question to the real models: matching, the checker and drafting'
    : 'The same question with every AI provider switched off: the fallback answer');
  await ask.getByRole('textbox', { name: 'Your question' }).fill('How do you encrypt data at rest?');
  await ask.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(ask.getByText('Answers it drew on')).toBeVisible({ timeout: 90_000 });
  await expect(ask.getByRole('button', { name: /^KB-\d{4,}$/ }).first()).toBeVisible();
  const confidence = ask.getByText(/^Confidence:/);
  if (TARGET === 'staging') {
    await expect(confidence).not.toContainText('Not calibrated');
    await expect(confidence).toContainText('Checker:');
  } else {
    await expect(confidence).toContainText('Not calibrated');
  }
});
