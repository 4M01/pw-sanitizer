import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  use: { trace: 'on' },
  reporter: [['html', { open: 'never' }]],
});
