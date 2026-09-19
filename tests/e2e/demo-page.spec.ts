import { test, expect } from '@playwright/test';

// The demo page with no account and no database: the stool request (no library match) and
// the tweezers request (D1) end to end, with a screenshot at each step.
const shot = (name: string) =>
  `docs/progress/${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-demo-${name}.png`;

test('a stool request reaches a no-match and a generation plan', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.goto('demo');
  await page.getByLabel('Request').fill('A stool');
  await page.getByRole('button', { name: 'Run requirements step' }).click();
  await expect(page.getByText('Specification', { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await page.screenshot({ path: shot('stool-1-requirements'), fullPage: true });
  await page.getByRole('button', { name: 'Select a library design' }).click();
  await expect(page.getByText(/No library design matches/).first()).toBeVisible(
    { timeout: 60_000 },
  );
  await expect(page.getByText(/Generate a new design:/).first()).toBeVisible();
  await page.screenshot({ path: shot('stool-2-no-match'), fullPage: true });
  await page.getByRole('button', { name: 'Confirm plan' }).click();
  await expect(page.getByText('Plan confirmed')).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Generate a new design' }).click();
  await expect(page.getByText('Check report', { exact: true })).toBeVisible({
    timeout: 180_000,
  });
  await page.screenshot({ path: shot('stool-3-generated'), fullPage: true });
  await expect(page.getByText(/Evidence level/).first()).toBeVisible();
  await expect(page.getByText('untested').first()).toBeVisible();
});

test('D1: tweezers request runs to the check report and download', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.goto('demo');
  await page
    .getByLabel('Request')
    .fill(
      'Print tweezers 120 mm long with a 3 mm tip, 2 mm thick arms, a 12 mm gap at rest, and 14 mm wide at the bridge, for general workshop use.',
    );
  await page.getByRole('button', { name: 'Run requirements step' }).click();
  await expect(page.getByText('Specification', { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole('button', { name: 'Select a library design' }).click();
  await expect(page.getByText(/1\. Tweezers/)).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: shot('d1-1-library'), fullPage: true });
  await page.getByRole('button', { name: 'Confirm plan' }).click();
  await expect(page.getByText('Plan confirmed')).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Run the loop' }).click();
  await expect(page.getByText('Check report', { exact: true })).toBeVisible({
    timeout: 180_000,
  });
  await expect(page.getByText(/Download package/)).toBeVisible({
    timeout: 60_000,
  });
  await page.screenshot({ path: shot('d1-2-report'), fullPage: true });
});
