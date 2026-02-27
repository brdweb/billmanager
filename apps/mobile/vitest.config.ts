import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.test.ts'],
    clearMocks: true,
  },
});
