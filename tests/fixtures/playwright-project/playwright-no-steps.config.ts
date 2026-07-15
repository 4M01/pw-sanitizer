import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests2',
  use: { trace: 'on' },
  outputDir: './test-results2',
  reporter: [['html', { outputFolder: 'playwright-report2', open: 'never' }]],
});
