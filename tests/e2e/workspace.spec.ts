import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';

// Issues #21 and #22: the workspace shell and its spaces, with no model calls. Parts listed
// come from earlier runs stored on the server; the test files one, reopens it, and checks
// the transcript appears.
const shot = (name: string) =>
  `docs/progress/${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-workspace-${name}.png`;

// Three fixture parts written straight into the store the dev server reads, so the test
// never depends on a live model run: one gathering, one that passed, one that failed. Their
// titles say fixture and their geometry is a bare cube; no agent ever inspected them.
const STORE = path.resolve(
  process.env.MICHANI_SESSION_DIR ?? '.michani/sessions',
);
const at = (minutesAgo: number) =>
  new Date(Date.now() - minutesAgo * 60_000).toISOString();
const fixture = (id: string, summary: string, state: string, ok?: boolean) => ({
  id,
  state,
  transcript: [
    { role: 'user', text: `I need ${summary.toLowerCase()}`, at: at(30) },
    {
      role: 'assistant',
      text: 'How big should it be, and which filament will it be printed in?',
      at: at(29),
    },
    { role: 'user', text: '120 by 80 by 40 mm, PLA', at: at(28) },
  ],
  specification: {
    id: `spec-${id}`,
    summary,
    sizeMm: { width: 120, depth: 80, height: 40 },
    material: 'pla',
    sections: [
      {
        heading: 'Use',
        content: 'Sits on a desk and holds pens',
        status: 'stated',
      },
    ],
  },
  ...(ok === undefined
    ? {}
    : {
        plan: {
          id: `plan-${id}`,
          function: 'generation',
          generationBrief: summary,
          measurementsNeeded: [],
          checkIds: [],
          riskLabel: 'general',
          reason: 'No library design matches',
          confirmed: true,
        },
        execution: {
          ok,
          function: 'generation',
          designId: `generated-${id.slice(0, 8)}-1`,
          designName: summary,
          source: 'generated',
          evidenceLevel: 'untested',
          riskLabel: 'needs expert review',
          values: { width: 120, depth: 80, height: 40 },
          scad: 'cube([120, 80, 40]);',
          attempts: [
            { attempt: 1, designId: 'x', values: {}, violations: [], ms: 1 },
          ],
          verification: {
            verdicts: [
              {
                agentId: 'geometry',
                result: ok ? 'pass' : 'fail',
                finding: ok ? 'The mesh is closed' : 'The mesh has open edges',
                evidence: [
                  { tool: 'check_mesh_validity', input: {}, output: { ok } },
                ],
                steps: 2,
                ms: 900,
              },
            ],
            didNotRun: [],
            failed: [],
            warned: [],
          },
          message: ok ? 'Every agent passed.' : 'Stopped after 3 attempts.',
        },
      }),
});

test.beforeAll(() => {
  mkdirSync(STORE, { recursive: true });
  const rows = [
    fixture(
      '11111111-1111-4111-8111-111111111111',
      'Fixture: pen tray',
      'gathering',
    ),
    fixture(
      '22222222-2222-4222-8222-222222222222',
      'Fixture: cable clip',
      'executed',
      true,
    ),
    fixture(
      '33333333-3333-4333-8333-333333333333',
      'Fixture: shelf bracket',
      'executed',
      false,
    ),
  ];
  for (const row of rows)
    writeFileSync(path.join(STORE, `${row.id}.json`), JSON.stringify(row));
});

const nav = (page: import('@playwright/test').Page) =>
  page.getByRole('navigation', { name: 'Workspace' });
const parts = (page: import('@playwright/test').Page) =>
  nav(page).locator('li.ws-enter > button');

for (const theme of ['light', 'dark'] as const) {
  test(`shell in ${theme}: home, spaces, one part reopened, rail collapsed`, async ({
    page,
  }) => {
    await page.goto('engine');
    await page.getByRole('button', { name: theme, exact: true }).click();
    await expect(page.locator('.ws')).toHaveAttribute('data-theme', theme);
    await nav(page).evaluate((el) => el.scrollTo(0, 0));
    await expect(
      page.getByRole('heading', { name: 'Workspace' }),
    ).toBeVisible();
    await expect(parts(page).first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: shot(`${theme}-1-home`), fullPage: true });

    await parts(page).first().click();
    await expect(
      page.locator('section[aria-label="Conversation"] p.ws-enter').nth(1),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel('Details, in your words')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Rename', exact: true }),
    ).toBeVisible();
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

test('pin and rename persist through the PATCH route', async ({ page }) => {
  await page.goto('engine');
  await expect(parts(page).first()).toBeVisible({ timeout: 15_000 });
  await parts(page).first().click();
  const pin = page.getByRole('button', { name: /^(Pin|Unpin)$/ });
  const wasPinned = (await pin.textContent()) === 'Unpin';
  await pin.click();
  await expect(
    page.getByRole('button', { name: wasPinned ? 'Pin' : 'Unpin' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  const input = page.getByLabel('Part name');
  const original = await input.inputValue();
  await input.fill(`${original.slice(0, 60)} (renamed)`);
  await input.press('Enter');
  await expect(parts(page).first()).toContainText('(renamed)');
  await page.reload();
  await expect(parts(page).first()).toContainText('(renamed)', {
    timeout: 15_000,
  });
  // Put the name back so repeated runs do not grow it.
  await parts(page).first().click();
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByLabel('Part name').fill(original);
  await page.getByLabel('Part name').press('Enter');
  await page.getByRole('button', { name: wasPinned ? 'Pin' : 'Unpin' }).click();
});

test('a bad PATCH body is refused', async ({ request }) => {
  const r = await request.patch('api/engine/session', {
    data: { id: 'not-a-uuid', workspace: { pinned: true, extra: 1 } },
  });
  expect(r.status()).toBe(400);
});

test('the sidebar is a drawer below 1024 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('engine');
  await expect(
    page.getByRole('button', { name: 'Open navigation' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(
    page.getByRole('button', { name: 'New part' }).first(),
  ).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot('phone-drawer'), fullPage: false });
});

for (const theme of ['light', 'dark'] as const) {
  test(`library space in ${theme} lists designs and opens one`, async ({
    page,
  }) => {
    await page.goto('engine');
    await page.getByRole('button', { name: theme, exact: true }).click();
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    const designs = page.getByRole('region', { name: 'Designs' }).locator('li');
    await expect(designs.first()).toBeVisible({ timeout: 15_000 });
    expect(await designs.count()).toBeGreaterThanOrEqual(5);
    await designs.first().locator('button').click();
    await expect(page.getByRole('table')).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({ path: shot(`${theme}-4-library`), fullPage: true });
  });
}
