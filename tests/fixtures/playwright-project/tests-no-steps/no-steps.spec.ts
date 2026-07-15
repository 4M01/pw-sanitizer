import { test, expect } from '@playwright/test';
import * as http from 'node:http';

// A test that uses NO test.step at all — only pw:api calls (APIRequestContext)
// and expect(). This mirrors scripts that drive Playwright purely through
// page/locator/request APIs.
let server: http.Server;
let baseURL: string;

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url?.startsWith('/health')) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ status: 'ok', secret: 'Bearer eyJabc123' }));
    } else {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ page: req.url, authorization: 'token-xyz' }));
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as { port: number };
  baseURL = `http://127.0.0.1:${addr.port}`;
});

test.afterAll(async () => {
  await new Promise((r) => server.close(r));
});

test('api flow without test.step', async ({ request }) => {
  const login = await request.get(`${baseURL}/login`);
  expect(login.ok()).toBeTruthy();

  // Noisy polling — the kind of thing users want to remove
  for (let i = 0; i < 3; i++) {
    const health = await request.get(`${baseURL}/health/poll`);
    expect(health.ok()).toBeTruthy();
  }

  const dashboard = await request.get(`${baseURL}/dashboard`);
  expect(dashboard.ok()).toBeTruthy();
});
