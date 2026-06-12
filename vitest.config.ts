import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname) },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Integration tests (multi-company isolation) share one database:
    // run files sequentially to avoid cross-test interference.
    fileParallelism: false,
    testTimeout: 30000,
  },
});
