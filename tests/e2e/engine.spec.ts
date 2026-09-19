import { test, expect } from '@playwright/test';

// The engine screen (issue #17), live against the model: one run each, screenshots at each step.
const shot = (name: string) =>
  `docs/progress/${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-engine-screen-${name}.png`;

async function say(page: import('@playwright/test').Page, text: string) {
  await page.getByLabel('Message').fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Working')).toBeHidden({ timeout: 180_000 });
}

test('tweezers: one turn to a plan, confirm, verdicts, preview', async ({
  page,
}) => {
  test.setTimeout(400_000);
  await page.goto('engine');
  await page.screenshot({ path: shot('0-empty'), fullPage: true });
  await say(
    page,
    'Print tweezers 120 mm long with a 3 mm tip, 2 mm thick arms, a 12 mm gap at rest, 14 mm wide at the bridge, in PLA, for picking up small parts on a workbench indoors; hand pressure only, no hardware to fit.',
  );
  if (await page.getByText('Specification (gathering)').isVisible()) {
    await say(page, 'No hardware to fit. Skin contact only.');
  }
  await expect(page.getByText(/Shall I go ahead/).first()).toBeVisible();
  await page.screenshot({ path: shot('1-plan'), fullPage: true });
  await page.getByRole('button', { name: 'Confirm plan' }).click();
  await expect(page.getByText('Working')).toBeHidden({ timeout: 300_000 });
  await expect(page.getByText('Result', { exact: true })).toBeVisible();
  await expect(page.getByText(/geometry: /).first()).toBeVisible();
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: shot('2-result'), fullPage: true });
});

test('bench: the specification fills in turn by turn', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('engine');
  await say(page, 'bench');
  await expect(page.getByText('Specification (gathering)')).toBeVisible();
  await page.screenshot({ path: shot('bench-1-question'), fullPage: true });
  await say(
    page,
    'A garden bench for two adults to sit on, 1200 mm wide, 450 mm high, 400 mm deep.',
  );
  await expect(page.getByText(/1200/).first()).toBeVisible();
  await page.screenshot({ path: shot('bench-2-dimensions'), fullPage: true });
});
