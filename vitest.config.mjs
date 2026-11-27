import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.mjs'],
    exclude: ['node_modules/**', 'dist/**', '.acceptance/**', 'tests/official-rules.test.mjs'],
  },
});
