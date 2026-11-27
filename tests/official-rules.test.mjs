import { afterAll, beforeAll, expect, test } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const testing = require('@beta_su/nx-lint/testing');
const { conformanceRulesRunner } = require('@beta_su/nx-lint/rules-runner');
const { flushChanges } = require('nx/src/generators/tree');
const sources = import.meta.glob('../.acceptance/official-nx-rules/tools/workspace-plugin/src/conformance-rules/*/index.ts');
let fixture;
let params;
beforeAll(async () => {
  fixture = await testing.createReadOnlyTree();
  const nodes = ['a', 'angular', 'nx', 'astro-docs'].map((name) => ({
    projectNode: { name, type: 'lib', data: { name, root: name === 'astro-docs' ? name : 'packages/' + name } },
    projectFiles: [],
  }));
  const data = await testing.createStubbedProjectGraphAndFileMapCache(fixture.tree, nodes);
  const tree = testing.convertToWritable(fixture.tree);
  const files = {
    'packages/nx/package.json': { name: 'nx', private: true, 'nx-migrations': { packageGroup: [] } },
    'packages/a/package.json': { name: '@nx/a', exports: { './feature': { types: './feature.d.ts' } }, typesVersions: { '*': {} } },
    'packages/a/index.ts': 'console.log(process.env.NX_UNDOCUMENTED_COMPATIBILITY_SAMPLE);',
    'packages/angular/package.json': { name: '@nx/angular', private: true },
    'packages/angular/tsconfig.lib.json': { compilerOptions: { rootDir: 'src', outDir: 'dist' } },
    'packages/angular/assets.json': { outDir: 'packages/angular/dist', assets: [] },
    'packages/angular/migrations.json': { generators: { example: { implementation: './dist/migrations/example', documentation: './dist/migrations/missing.md' } }, packageJsonUpdates: { '1.0.0': { version: '1.0.0', packages: { '@acme/foo': { version: '1.0.0' } } } } },
    'packages/angular/src/generators/app/files/template.txt': 'template',
    'astro-docs/src/content/docs/reference/environment-variables.mdoc': '| Variable | Description |\n| --- | --- |\n',
    'astro-docs/example.mdoc': '{% tabs %}\n{% tabitem label="sample" %}\n# Heading inside tabs\n{% /tabitem %}\n{% /tabs %}\n\n```\nmissing language\n```\n\n![missing](./missing.png)\n',
  };
  for (const [file, value] of Object.entries(files)) {
    tree.write(file, typeof value === 'string' ? value : JSON.stringify(value));
    const owner = nodes.find(({ projectNode }) => file.startsWith(projectNode.data.root + '/')).projectNode.name;
    (data.fileMapCache.fileMap.projectFileMap[owner] ??= []).push({ file, hash: '', deps: [] });
  }
  flushChanges(tree.root, tree.listChanges());
  params = { tree: testing.convertToReadOnly(tree), ...data, applyFixGenerators: false };
});
afterAll(() => fixture?.cleanup());

test('the full pinned Nx-authored public rule inventory is included', () => {
  expect(Object.keys(sources)).toHaveLength(11);
  const specNames = fs.readdirSync(path.resolve('.acceptance/official-nx-rules/tools/workspace-plugin/src/conformance-rules')).filter((name) => fs.existsSync(path.resolve('.acceptance/official-nx-rules/tools/workspace-plugin/src/conformance-rules', name, 'index.spec.ts')));
  expect(specNames).toHaveLength(8);
});
test.each(Object.entries(sources))('%s runs unchanged on the local SDK and runner', async (filename, load) => {
  const rule = (await load()).default;
  const options = rule.name === 'migration-groups' ? { groups: [['@acme/foo', '@acme/bar']] } : {};
  const { ruleResults: [result] } = await conformanceRulesRunner({ ...params, loadedRules: [{ ruleSpecifier: filename, ruleModule: rule, ruleOptions: options }] });
  expect(result.ruleData.name).toBe(rule.name);
  expect(result.resolvedStatus).toBe('enforced');
  expect(['high', 'medium', 'low']).toContain(result.severity);
  expect(Array.isArray(result.details.violations)).toBe(true);
  if (rule.name === 'no-ignored-tracked-files') expect(result.details.violations).toHaveLength(0);
  else expect(result.details.violations.length).toBeGreaterThan(0);
});
