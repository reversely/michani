import { test, expect } from '@playwright/test';

// Issue #21: the workspace shell, with no model calls. Sessions listed come from earlier runs
// stored on the server; the test reopens the first one and checks its transcript appears.
const shot = (name: string) =>
  `docs/progress/${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-workspace-${name}.png`;

for (const theme of ['light', 'dark'] as const) {
  test(`shell in ${theme}: sessions listed, one reopened, rail collapsed`, async ({
    page,
  }) => {
    await page.goto('engine');
    await page.getByRole('button', { name: theme, exact: true }).click();
    await expect(page.locator('.ws')).toHaveAttribute('data-theme', theme);
    await page
      .getByRole('navigation', { name: 'Workspace' })
      .evaluate((el) => el.scrollTo(0, 0));
    const list = page
      .getByRole('navigation', { name: 'Workspace' })
      .locator('ul button');
    await expect(list.first()).toBeVisible({ timeout: 15_000 });
    expect(await list.count()).toBeGreaterThanOrEqual(3);
    await page.waitForTimeout(400);
    await page.screenshot({
      path: shot(`${theme}-1-sessions`),
      fullPage: true,
    });
    await list.first().click();
    await expect(
      page.locator('section[aria-label="Conversation"] p.ws-enter').nth(1),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel('Details, in your words')).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({
      path: shot(`${theme}-2-reopened`),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Hide details' }).click();
    await expect(
      page.getByRole('button', { name: 'Show details' }),
    ).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({
      path: shot(`${theme}-3-rail-collapsed`),
      fullPage: true,
    });
  });
}

test('the sidebar is a drawer below 1024 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('engine');
  await expect(
    page.getByRole('button', { name: 'Open navigation' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('button', { name: 'New part' })).toBeVisible();
  await page.screenshot({ path: shot('phone-drawer'), fullPage: false });
});
