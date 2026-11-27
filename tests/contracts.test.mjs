import { afterEach, expect, test } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const api = require('nx-lint');
const testing = require('nx-lint/testing');
const { conformanceRulesRunner } = require('nx-lint/rules-runner');
const owners = require('nx-lint/ensure-owners');
const boundaries = require('nx-lint/enforce-project-boundaries');
const cleanups = [];
afterEach(() => { while (cleanups.length) cleanups.pop()(); });
async function fixture(nodes = []) {
  const fixture = await testing.createReadOnlyTree(async (tree) => { tree.write('workspace.txt', 'original'); });
  cleanups.push(fixture.cleanup);
  const data = await testing.createStubbedProjectGraphAndFileMapCache(fixture.tree, nodes);
  return { tree: fixture.tree, ...data, applyFixGenerators: false };
}
const node = (name, tags = [], deps = [], extra = {}) => ({
  projectNode: { name, type: 'lib', data: { name, root: 'libs/' + name, tags, ...extra } },
  projectFiles: [{ projectRootRelativeFile: 'index.ts', depsItCreates: deps }, { projectRootRelativeFile: 'project.json', depsItCreates: [] }],
});
const rule = (name, implementation, extra = {}) => ({ ruleSpecifier: name, ruleModule: api.createConformanceRule({ name, category: 'consistency', description: name, implementation, ...extra }) });
const result = (violations) => ({ severity: 'medium', details: { violations } });
async function runBuiltin(params, builtin, options = {}) {
  return (await conformanceRulesRunner({ ...params, loadedRules: [{ ruleSpecifier: builtin.name, ruleModule: builtin, ruleOptions: options }] })).ruleResults[0].details.violations;
}

test('evaluation trees reject each mutation while generators can edit staged files', async () => {
  const { tree } = await fixture();
  for (const operation of [() => tree.write('x', ''), () => tree.delete('workspace.txt'), () => tree.rename('workspace.txt', 'x'), () => tree.changePermissions('workspace.txt', 0o755)]) expect(operation).toThrow(/fixGenerator/);
  expect(tree.read('workspace.txt', 'utf8')).toBe('original');
  expect(tree.listChanges()).toEqual([]);
  expect(testing.convertToWritable(tree)).toBe(tree);
  tree.write('workspace.txt', 'fixed');
  expect(tree.listChanges().find((change) => change.path === 'workspace.txt').content.toString()).toBe('fixed');
  testing.convertToReadOnly(tree);
  expect(tree.listChanges()).toEqual([]);
});

test('rules evaluate concurrently and fix generators execute serially in configuration order', async () => {
  const params = await fixture();
  const events = [];
  let release;
  const bothStarted = new Promise((resolve) => { release = resolve; });
  const rules = ['first', 'second'].map((name) => rule(name, async ({ tree }) => {
    events.push('evaluate:' + name);
    if (events.length === 2) release();
    await bothStarted;
    expect(() => tree.write('illegal', '')).toThrow();
    return result([{ workspaceViolation: true, message: name }]);
  }, { fixGenerator: async (tree) => { events.push('fix:' + name); tree.write(name, name); } }));
  const output = await conformanceRulesRunner({ ...params, loadedRules: rules, applyFixGenerators: true });
  expect(events).toEqual(['evaluate:first', 'evaluate:second', 'fix:first', 'fix:second']);
  expect(output.ruleResults.map((item) => item.runnerData.fixGeneratorStatus)).toEqual(['applied', 'applied']);
});

test('the runner infers file ownership and keeps workspace violations when filtering projects', async () => {
  const params = await fixture([node('a', ['scope:ui']), node('b', ['scope:server'])]);
  const selected = rule('selection', async () => result([
    { message: 'a file', file: 'libs/a/index.ts' },
    { message: 'b file', file: 'libs/b/index.ts' },
    { message: 'workspace', workspaceViolation: true },
    { message: 'unowned file', file: 'README.md' },
  ]));
  selected.projects = [{ matcher: 'tag:scope:ui', explanation: 'UI only' }];
  const [output] = (await conformanceRulesRunner({ ...params, loadedRules: [selected] })).ruleResults;
  expect(output.details.violations.map((v) => v.message)).toEqual(['a file', 'workspace', 'unowned file']);
  expect(output.details.violations[0].sourceProject).toBe('a');
  expect(output.runnerData).toMatchObject({ status: 'enforced', scheduledStatus: null, scheduledStatusDate: null, countOfOriginalViolations: 3, countOfViolationsFilteredByProjects: 0, countOfViolationsFixedByGenerator: 0, fixGeneratorStatus: 'no-fix-generator' });
  expect(output.ruleData).toEqual({ name: 'selection', category: 'consistency', description: 'selection' });
});

test('project selectors filter check units and keep workspace measurements', async () => {
  const params = await fixture([node('a', ['scope:ui']), node('b', ['scope:server'])]);
  const ui = { project: 'a', value: 0 };
  const server = { project: 'b', value: 1, files: ['libs/b/index.ts'] };
  const workspace = { project: '', value: 42 };
  const checks = [
    { rule: 'project-count', durationMs: 1, units: [ui, server, workspace] },
    { rule: 'server-count', durationMs: 2, units: [server] },
  ];
  const loaded = rule('aggregate', async () => ({ severity: 'low', details: { violations: [], checks } }));
  const scoped = { ...loaded, projects: [{ matcher: 'tag:scope:ui', explanation: 'UI only' }] };
  const { ruleResults: [filtered, unfiltered] } = await conformanceRulesRunner({ ...params, loadedRules: [scoped, loaded] });
  expect(filtered.details.checks).toEqual([
    { rule: 'project-count', durationMs: 1, units: [ui, workspace] },
    { rule: 'server-count', durationMs: 2, units: [] },
  ]);
  expect(unfiltered.details.checks).toEqual([
    { rule: 'project-count', durationMs: 1, units: [ui, server, workspace] },
    { rule: 'server-count', durationMs: 2, units: [server] },
  ]);
});

test('project selectors preserve Nx inclusion and exclusion order', async () => {
  const params = await fixture([node('a'), node('b')]);
  const loaded = rule('selection-order', async () => ({
    severity: 'low',
    details: {
      violations: ['a', 'b'].map((sourceProject) => ({ sourceProject, message: 'finding' })),
      checks: [{ rule: 'check', durationMs: 1, units: ['', 'a', 'b'].map((project) => ({ project, value: 1 })) }],
    },
  }));
  const loadedRules = [['*', '!b'], ['!b', '*']].map((projects) => ({ ...loaded, projects }));
  const { ruleResults } = await conformanceRulesRunner({ ...params, loadedRules });
  expect(ruleResults.map(({ details }) => details.violations.map(({ sourceProject }) => sourceProject))).toEqual([['a'], ['a', 'b']]);
  expect(ruleResults.map(({ details }) => details.checks[0].units.map(({ project }) => project))).toEqual([['', 'a'], ['', 'a', 'b']]);
});

test.each([
  ['enforced', undefined, undefined, 'enforced', 1],
  ['evaluated', undefined, undefined, 'evaluated', 1],
  ['disabled', undefined, undefined, 'disabled', 0],
  ['disabled', 'enforced', 1, 'enforced', 1],
  ['enforced', 'disabled', 1, 'disabled', 0],
  ['enforced', 'disabled', 4102444800000, 'enforced', 1],
])('status %s scheduled %s resolves to %s without executing disabled rules', async (status, scheduledStatus, scheduledStatusDate, resolvedStatus, callsExpected) => {
  const params = await fixture();
  let calls = 0;
  const loaded = { ...rule('status', async () => { calls++; return result([]); }), status, scheduledStatus, scheduledStatusDate };
  const [output] = (await conformanceRulesRunner({ ...params, loadedRules: [loaded] })).ruleResults;
  expect(output.resolvedStatus).toBe(resolvedStatus);
  expect(calls).toBe(callsExpected);
  expect(output.severity).toBe(callsExpected ? 'medium' : null);
});

test('fix-only data reaches generators but never reaches reports, including evaluated rules', async () => {
  const params = await fixture([node('a')]);
  let received;
  const loaded = { ...rule('fix-data', async () => ({
    severity: 'high', details: { violations: [{ file: 'libs/a/index.ts', message: 'repair', fixGeneratorData: { replacement: 'fixed' } }], fixGeneratorData: { private: 'token' } },
  }), { fixGenerator: async (tree, schema) => { received = structuredClone(schema); tree.write(schema.violations[0].file, schema.violations[0].fixGeneratorData.replacement); } }), status: 'evaluated' };
  const output = await conformanceRulesRunner({ ...params, loadedRules: [loaded], applyFixGenerators: true });
  expect(received.fixGeneratorData).toEqual({ private: 'token' });
  expect(received.violations[0].sourceProject).toBe('a');
  expect(params.tree.read('libs/a/index.ts', 'utf8')).toBe('fixed');
  expect(JSON.stringify(output)).not.toContain('fixGeneratorData');
});

test('a violation with no attribution fails instead of silently disappearing', async () => {
  const params = await fixture();
  await expect(conformanceRulesRunner({ ...params, loadedRules: [rule('invalid', async () => result([{ message: 'unattributed' }]))] })).rejects.toMatchObject({ isValidationError: true });
  expect(await conformanceRulesRunner({ ...params, loadedRules: [] })).toEqual({ ruleResults: [] });
});

test('ensure-owners reads project ownership metadata', async () => {
  const params = await fixture([node('owned', [], [], { metadata: { owners: { '@team': [] } } }), node('missing'), node('empty', [], [], { metadata: { owners: {} } })]);
  expect((await runBuiltin(params, owners)).map((v) => v.sourceProject)).toEqual(['missing', 'empty']);
});

test('boundaries attribute static and implicit dependencies to their declaring files', async () => {
  const a = node('a', ['scope:ui'], ['b']);
  const b = node('b', ['scope:server']);
  const params = await fixture([a, b]);
  const violations = await runBuiltin(params, boundaries, { depConstraints: [{ sourceTag: 'scope:ui', onlyDependOnProjectsWithTags: ['scope:ui'] }] });
  expect(violations).toHaveLength(1);
  expect(violations[0]).toMatchObject({ sourceProject: 'a', file: 'libs/a/index.ts' });
  params.projectGraph.dependencies.a = [{ source: 'a', target: 'b', type: 'implicit' }];
  expect((await runBuiltin(params, boundaries, { depConstraints: [{ sourceTag: 'scope:ui', notDependOnProjectsWithTags: ['scope:server'] }] }))[0].file).toBe('libs/a/project.json');
});

test('boundaries cover app/e2e dependencies, buildability and external node exclusion', async () => {
  const a = node('a', [], ['app', 'e2e', 'lib', 'npm:react'], { targets: { compile: {} } });
  const app = node('app'); app.projectNode.type = 'app';
  const e2e = node('e2e'); e2e.projectNode.type = 'e2e';
  const params = await fixture([a, app, e2e, node('lib')]);
  const violations = await runBuiltin(params, boundaries, { requireBuildableDependenciesForBuildableProjects: { buildTargetNames: ['compile'] } });
  expect(violations).toHaveLength(3);
  expect(violations.map((v) => v.message).join('\n')).toMatch(/app.*e2e.*non-buildable/s);
  params.projectGraph.dependencies.a = [{ source: 'a', target: 'app', type: 'implicit' }];
  expect(await runBuiltin(params, boundaries)).toEqual([]);
});

test('boundaries detect cycles with symmetric matcher-based exemptions and ignore self cycles', async () => {
  const params = await fixture([node('a', [], ['b']), node('b', [], ['a'])]);
  expect((await runBuiltin(params, boundaries)).filter((v) => v.message.includes('Circular'))).toHaveLength(2);
  expect(await runBuiltin(params, boundaries, { ignoredCircularDependencies: [['a', 'b']] })).toEqual([]);
  const self = await fixture([node('self', [], ['self'])]);
  expect(await runBuiltin(self, boundaries)).toEqual([]);
});

test.each([
  [{ sourceTag: 'scope:*', onlyDependOnProjectsWithTags: ['/server$/'] }, 0],
  [{ sourceTag: '*', notDependOnProjectsWithTags: ['scope:server'] }, 1],
  [{ sourceTag: 'missing', onlyDependOnProjectsWithTags: ['*'] }, 1],
  [{ allSourceTags: ['scope:ui', 'type:feature'], onlyDependOnProjectsWithTags: [] }, 1],
])('boundary tag matching supports wildcards, regex, allSourceTags and empty allow lists', async (constraint, expected) => {
  const params = await fixture([node('a', ['scope:ui', 'type:feature'], ['b']), node('b', ['scope:server'])]);
  expect(await runBuiltin(params, boundaries, { depConstraints: [constraint] })).toHaveLength(expected);
});
