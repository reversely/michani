import { test, expect } from '@playwright/test';

// Suite S7, server-side cases: the chat route needs a session, the engine route validates its body, and the library route
// does not. Needs the dev server and the local Supabase stack.
test('chat route returns 401 without a session', async ({ request }) => {
  const response = await request.post('api/parametric-chat', {
    data: {
      conversationId: '00000000-0000-0000-0000-000000000000',
      model: 'anthropic/claude-sonnet-5',
    },
  });
  expect(response.status()).toBe(401);
});

test('engine turn route rejects a malformed body', async ({ request }) => {
  const response = await request.post('api/engine/turn', {
    data: { sessionId: 'not-a-uuid', message: '' },
  });
  expect(response.status()).toBe(400);
});

test('library route is readable without a session', async ({ request }) => {
  const response = await request.get('api/library');
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.designs.map((d: { id: string }) => d.id)).toContain('tweezers');
  expect(JSON.stringify(body)).not.toContain('module ');
});
