import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  resolve: { alias: [
    { find: /^@nx\/conformance$/, replacement: path.join(root, 'dist/src/index.js') },
    { find: /^@nx\/conformance\/testing$/, replacement: path.join(root, 'dist/testing/index.js') },
  ] },
  plugins: [{
    name: 'upstream-jest-framework-adapter', enforce: 'pre',
    transform(source, id) {
      if (!id.includes('/.acceptance/official-nx-rules/') || !id.endsWith('.spec.ts')) return;
      return { code: source.replace(/\bjest\.mock\(/g, 'vi.mock(').replace(/\bjest\.requireActual\(/g, 'globalThis.__upstreamRequireActual('), map: null };
    },
  }],
  test: {
    globals: true, setupFiles: ['tests/official-rules.setup.mjs'],
    include: ['.acceptance/official-nx-rules/tools/workspace-plugin/src/conformance-rules/**/*.spec.ts', 'tests/official-rules.test.mjs'],
    exclude: [], maxWorkers: 1, fileParallelism: false,
  },
});
