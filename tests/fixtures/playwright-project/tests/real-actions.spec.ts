import { test, expect } from '@playwright/test';

test('real actions without test step', async ({ page }) => {
  // Mock a simple route to generate network events
  await page.route('http://example.com/api/data', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ secret: 'super-sensitive-data-1234' }),
    });
  });

  // Perform some browser actions
  await page.goto('http://example.com');
  
  // Trigger the network request
  await page.evaluate(async () => {
    await fetch('http://example.com/api/data');
  });
});
