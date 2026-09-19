import { test, expect } from '@playwright/test';

// Checkpoint 1 closing check: a stock CADAM prompt returns a rendered model in the local browser.
// Needs the local Supabase stack, the dev server, and a provider key in .env.local. The demo user
// is created once against the local auth admin API (see docs/log.md, 2026-09-19).
const EMAIL = process.env.E2E_EMAIL ?? 'demo@michani.local';
const PASSWORD = process.env.E2E_PASSWORD ?? 'michani-demo-pass-2026';

test('stock prompt renders a model', async ({ page }) => {
  test.setTimeout(6 * 60_000);
  await page.goto('signin');
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.endsWith('/signin'), {
    timeout: 30_000,
  });

  await page.goto('');
  const prompt = page.locator('textarea').first();
  await prompt.fill(
    'A 20 mm cube with a 5 mm hole through the centre of the top face.',
  );
  await prompt.press('Enter');

  await page.waitForURL(/\/editor\//, { timeout: 60_000 });
  const started = Date.now();
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  // CADAM hides the Radix slider thumb by design, so the proof of a compiled mesh is the
  // parameter panel with its numeric inputs and the STL download button.
  await expect(page.getByRole('button', { name: /STL/ })).toBeVisible({
    timeout: 5 * 60_000,
  });
  await expect(page.getByText('Parameters', { exact: true })).toBeVisible();
  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(`render with parameters visible after ${seconds}s`);
  await page.screenshot({
    path: 'docs/progress/20260919-issue-01-editor-stock-render.png',
    fullPage: false,
  });
});
