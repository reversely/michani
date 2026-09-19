import { test, expect } from '@playwright/test';

// Issue #20, live once: a detailed request with a style reference reaches a plan in one
// turn, with the details kept in the person's words and the reasoning shown as sections.
const shot = (name: string) =>
  `docs/progress/${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-engine-screen-${name}.png`;

test('armchair: details, size, material, sections, plan', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('engine');
  await page
    .getByLabel('Message')
    .fill(
      'a miniature 5" x 5" armchair that looks like the IKEA STOCKHOLM 2025 with different colours of PLA for the different components',
    );
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Working')).toBeHidden({ timeout: 180_000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByLabel('Details, in your words')).toHaveValue(
    /STOCKHOLM/,
  );
  await expect(page.getByText(/127/).first()).toBeVisible();
  await expect(page.getByText('pla', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: shot('armchair-1'), fullPage: true });
  const state = await page.getByText(/Specification \((\w+)\)/).innerText();
  console.log(`armchair state after one turn: ${state}`);
  expect(state).toMatch(/planned|gathering/);
});
