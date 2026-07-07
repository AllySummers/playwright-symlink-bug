import { defineConfig } from '@playwright/test';
import { env } from '@repro/env';

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  use: {
    baseURL: env.DATABASE_URL,
  },
});
