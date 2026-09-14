import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/e2e', outputDir: 'test-results/snippet', fullyParallel: true, workers: 3, timeout: 30_000,
  reporter: [['list'], ['json', { outputFile: 'test-results/report.json' }]],
  use: { baseURL: 'http://localhost:4174', trace: 'retain-on-failure' },
  projects: ['chromium', 'firefox', 'webkit'].flatMap(browserName =>
    [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 }, { name: 'narrow', width: 320, height: 568 }].map(size => ({
      name: `${browserName}-${size.name}`,
      use: { browserName: browserName as 'chromium' | 'firefox' | 'webkit', viewport: { width: size.width, height: size.height } },
    }))),
  webServer: [
    { command: 'npm run start -w @support-hub/api', url: 'http://localhost:3000/api/health', reuseExistingServer: process.env.E2E_REUSE_SERVER === '1', env: { PORT: '3000', NODE_ENV: 'test' } },
    { command: 'npm run start -w @support-hub/demo-host', url: 'http://localhost:4174', reuseExistingServer: process.env.E2E_REUSE_SERVER === '1' },
  ],
})
