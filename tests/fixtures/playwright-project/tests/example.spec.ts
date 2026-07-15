import { test, expect } from '@playwright/test';

class BasePage {
  async waitForSpinnerToDisappear(pageReloadedEarlier: boolean, timeOut: number) {
    await test.step(`waitForSpinnerToDisappear: {pageReloadedEarlier}, {timeOut} - BasePage.waitForSpinnerToDisappear`, async () => {
      await test.step('check spinner visible', async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
      await test.step('poll until hidden', async () => {
        await new Promise((r) => setTimeout(r, 30));
        await test.step('inner poll tick', async () => {
          await new Promise((r) => setTimeout(r, 10));
        });
      });
    });
  }
}

test('login flow with noisy waits', async () => {
  const page = new BasePage();
  await test.step('open login page', async () => {
    await new Promise((r) => setTimeout(r, 15));
  });
  await page.waitForSpinnerToDisappear(true, 5000);
  await test.step('fill credentials', async () => {
    expect(1 + 1).toBe(2);
  });
  await page.waitForSpinnerToDisappear(false, 3000);
  await test.step('assert dashboard', async () => {
    expect(true).toBeTruthy();
  });
});
