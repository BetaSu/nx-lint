import { afterEach, expect, test } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const devkit = require('@nx/devkit');
const { createReadOnlyTree } = require('@beta_su/nx-lint/testing');
const cleanups = [];
afterEach(() => { while (cleanups.length) cleanups.pop()(); });

test('Nx inference accepts JSONC configuration and package metadata', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nx-lint-jsonc-'));
  cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'nx.json'), '{\n// valid Nx config\n"conformance": {"rules": []},\n}\n');
  fs.writeFileSync(path.join(root, 'package.json'), '{\n// Nx readJsonFile semantics\n"name": "jsonc-workspace",\n}\n');
  const [, infer] = require('@beta_su/nx-lint/plugin').createNodesV2;
  const [[, result]] = await infer(['nx.json'], {}, { workspaceRoot: root });
  expect(result.projects['.']).toMatchObject({ name: 'jsonc-workspace', targets: { 'conformance-check': { cache: false }, 'conformance-fix': { cache: false } } });
});

test('failed test workspace initialization removes its directory and restores global state', async () => {
  const rootBefore = devkit.workspaceRoot;
  const cwdBefore = process.env.INIT_CWD;
  let temporaryRoot;
  const failure = new Error('fixture setup failed');
  await expect(createReadOnlyTree(async (tree) => { temporaryRoot = tree.root; throw failure; })).rejects.toBe(failure);
  expect(fs.existsSync(temporaryRoot)).toBe(false);
  expect(devkit.workspaceRoot).toBe(rootBefore);
  expect(process.env.INIT_CWD).toBe(cwdBefore);
});

test('successful nested test workspaces restore INIT_CWD and workspaceRoot in cleanup order', async () => {
  const originalRoot = devkit.workspaceRoot;
  const originalCwd = process.env.INIT_CWD;
  const outer = await createReadOnlyTree();
  cleanups.push(outer.cleanup);
  const outerCwd = process.env.INIT_CWD;
  const inner = await createReadOnlyTree();
  inner.cleanup();
  expect(devkit.workspaceRoot).toBe(outer.tree.root);
  expect(process.env.INIT_CWD).toBe(outerCwd);
  cleanups.pop()();
  expect(devkit.workspaceRoot).toBe(originalRoot);
  expect(process.env.INIT_CWD).toBe(originalCwd);
});

test('public CommonJS and native ESM exports preserve the contract through compiled entries', async () => {
  const api = require('@beta_su/nx-lint');
  const imported = await import('@beta_su/nx-lint');
  expect(Object.keys(api).sort()).toEqual(['ReadOnlyConformanceTree', 'WritableConformanceTree', 'createConformanceRule', 'yargsConformanceCheckCommand', 'yargsConformanceCommand'].sort());
  expect(imported.createConformanceRule).toBe(api.createConformanceRule);
  expect(require('@beta_su/nx-lint/ensure-owners').name).toBe('ensure-owners');
  expect(typeof require('@beta_su/nx-lint/src/generators/create-rule/create-rule')).toBe('function');
  expect(require.resolve('@beta_su/nx-lint')).toContain('/dist/src/');
});
