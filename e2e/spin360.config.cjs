const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './spin360', workers: 1, timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:4175', headless: true, screenshot: 'only-on-failure' },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:4175/urun',
    env: { PORT: '4175' }, reuseExistingServer: false, timeout: 60000 },
});
