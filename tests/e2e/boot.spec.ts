import { test, expect } from '@playwright/test';

// S1: the dev server answers, the WASM asset is served, and Supabase is reachable.
test('dev server serves the app shell', async ({ page }) => {
  const response = await page.goto('');
  expect(response?.status()).toBe(200);
  await expect(page.locator('body')).toBeVisible();
});

test('OpenSCAD WASM asset is served', async ({ request }) => {
  const response = await request.get('src/vendor/openscad-wasm/openscad.wasm');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('wasm');
});

test('local Supabase API answers', async ({ request }) => {
  const url = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
  const response = await request.get(`${url}/auth/v1/health`);
  expect(response.status()).toBe(200);
});
