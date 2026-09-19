import { test, expect } from '@playwright/test';

// Issue #19, live once: a ladder is not a printed part, and "normal sized" must not get the
// same question back.
const shot = (name: string) =>
  `docs/progress/${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-engine-screen-${name}.png`;

test('ladder: scoping reply, no repeated question, input row visible', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.goto('engine');
  await page.getByLabel('Message').fill('ladder');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Working')).toBeHidden({ timeout: 120_000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  const first = await page
    .locator('section[aria-label="Conversation"] p.self-start')
    .last()
    .innerText({ timeout: 10_000 });
  await page.screenshot({ path: shot('ladder-1'), fullPage: true });
  await page.getByLabel('Message').fill('just a normal sized ladder');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Working')).toBeHidden({ timeout: 120_000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  const second = await page
    .locator('section[aria-label="Conversation"] p.self-start')
    .last()
    .innerText({ timeout: 10_000 });
  await page.screenshot({ path: shot('ladder-2'), fullPage: true });
  console.log(`ladder turn 1: ${first}\nladder turn 2: ${second}`);
  expect(second).not.toBe(first);
  expect(second.length).toBeGreaterThan(20);
  await expect(
    page.getByRole('button', { name: 'Send', exact: true }),
  ).toBeInViewport();
});
