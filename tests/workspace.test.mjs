import { afterEach, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function put(root, name, value) {
  const filename = path.join(root, name);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}
function workspace() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nx-lint-workspace-')));
  roots.push(root);
  put(root, 'package.json', { name: 'fixture', private: true, devDependencies: { '@beta_su/nx-lint': 'file:' + packageRoot, nx: '23.3.0', '@nx/js': '23.3.0' } });
  put(root, 'project.json', { name: 'fixture', root: '.', targets: {} });
  put(root, 'tsconfig.base.json', { compilerOptions: { target: 'ES2022', module: 'commonjs', moduleResolution: 'node', esModuleInterop: true, skipLibCheck: true, ignoreDeprecations: '6.0' } });
  put(root, 'nx.json', { neverConnectToCloud: true, plugins: ['@beta_su/nx-lint/plugin'], conformance: { rules: [{ rule: '@beta_su/nx-lint/ensure-owners' }] } });
  fs.mkdirSync(path.join(root, 'node_modules/@beta_su'), { recursive: true });
  fs.symlinkSync(packageRoot, path.join(root, 'node_modules/@beta_su/nx-lint'), 'dir');
  for (const name of ['nx', 'typescript']) fs.symlinkSync(path.join(packageRoot, 'node_modules', name), path.join(root, 'node_modules', name), 'dir');
  fs.mkdirSync(path.join(root, 'node_modules/@nx'), { recursive: true });
  for (const name of ['devkit', 'js']) fs.symlinkSync(path.join(packageRoot, 'node_modules/@nx', name), path.join(root, 'node_modules/@nx', name), 'dir');
  return root;
}
function aliasConformance(root) {
  fs.symlinkSync(packageRoot, path.join(root, 'node_modules/@nx/conformance'), 'dir');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  pkg.devDependencies['@nx/conformance'] = pkg.devDependencies['@beta_su/nx-lint'];
  put(root, 'package.json', pkg);
}
function child(root, executable, args) {
  // Node 22.12-22.17 provides native TS stripping behind a flag; later supported versions enable it by default.
  const nativeTypeScriptFlags = process.features.typescript === false ? ['--experimental-strip-types'] : [];
  const result = spawnSync(process.execPath, [...nativeTypeScriptFlags, executable, ...args], { cwd: root, encoding: 'utf8', timeout: 60000, env: { ...process.env, CI: 'true', NODE_PATH: path.join(root, 'node_modules'), NX_DAEMON: 'false', NX_ISOLATE_PLUGINS: 'false', NX_TUI: 'false', NX_WORKSPACE_DATA_DIRECTORY: path.join(root, '.nx/workspace-data'), NX_CACHE_DIRECTORY: path.join(root, '.nx/cache'), NX_VERBOSE_LOGGING: 'false' } });
  if (result.error) throw result.error;
  return { code: result.status, output: result.stdout + result.stderr };
}
const nx = (root, ...args) => child(root, require.resolve('nx/bin/nx'), args[0] === 'generate' ? args : [...args, '--output-style=static']);
const cli = (root, ...args) => child(root, path.join(packageRoot, 'dist/bin/nx-lint.js'), args);
const config = (root) => JSON.parse(fs.readFileSync(path.join(root, 'nx.json'), 'utf8'));

test('bundle discovery validates every schema before compilation and uses the installed compatibility version', () => {
  const root = workspace();
  aliasConformance(root);
  put(root, 'legacy/project.json', { name: 'legacy', targets: { build: { executor: '@beta_su/nx-lint:bundle-rules', options: { outputPath: 'dist/legacy' } } } });
  put(root, 'node_modules/@nx/owners/package.json', { name: '@nx/owners', version: '7.2.0' });
  put(root, 'legacy/src/a/index.ts', "import {createConformanceRule} from '@nx/conformance';import owners from '@nx/owners';import legacyOwners from '@nx/powerpack-owners';export default createConformanceRule({name:'legacy',category:'consistency',description:String(owners)+String(legacyOwners),implementation:async()=>({severity:'low',details:{violations:[]}})});");
  put(root, 'legacy/src/a/schema.json', '{\n// Nx accepts JSONC rule schemas\n"$schema": "", "type": "object",\n}\n');
  put(root, 'legacy/src/b/index.ts', 'export default {};');
  put(root, 'legacy/src/b/schema.json', { type: 'object' });
  put(root, 'dist/legacy/previous.txt', 'previous bundle');
  const invalid = nx(root, 'run', 'legacy:build');
  expect(invalid.code).toBe(1);
  expect(fs.existsSync(path.join(root, 'dist/legacy/a/index.js'))).toBe(false);
  expect(fs.readFileSync(path.join(root, 'dist/legacy/previous.txt'), 'utf8')).toBe('previous bundle');
  fs.rmSync(path.join(root, 'legacy/src/b'), { recursive: true });
  const valid = nx(root, 'run', 'legacy:build');
  expect(valid.code, valid.output).toBe(0);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'dist/legacy/a/package.json'), 'utf8'));
  expect(manifest.dependencies).toEqual({ '@nx/conformance': '^0', '@nx/owners': '^7', '@nx/powerpack-owners': '^5' });
}, 90000);

test('both official rule specifiers load with their own schemas and enforce through native Nx', () => {
  const root = workspace();
  aliasConformance(root);
  put(root, 'project.json', { name: 'fixture', root: '.', tags: ['scope:ui'], targets: {} });
  put(root, 'dependent/project.json', { name: 'dependent', implicitDependencies: ['fixture'], targets: {} });
  const nxConfig = config(root);
  nxConfig.conformance.rules = [
    { rule: '@nx/conformance/ensure-owners' },
    { rule: '@nx/conformance/enforce-project-boundaries', options: { depConstraints: [{ sourceTag: '*', notDependOnProjectsWithTags: ['scope:ui'] }] } },
  ];
  put(root, 'nx.json', nxConfig);
  const failed = nx(root, 'conformance:check');
  expect(failed.code, failed.output).toBe(1);
  const failedReport = JSON.parse(fs.readFileSync(path.join(root, 'dist/conformance-result.json'), 'utf8'));
  expect(failedReport.ruleResults).toHaveLength(2);
  expect(failedReport.ruleResults.every((item) => item.details.violations.length > 0)).toBe(true);
  for (const filename of ['project.json', 'dependent/project.json']) {
    const project = JSON.parse(fs.readFileSync(path.join(root, filename), 'utf8'));
    project.metadata = { owners: { '@team': [] } };
    put(root, filename, project);
  }
  nxConfig.conformance.rules[1].options.depConstraints = [{ sourceTag: '*', onlyDependOnProjectsWithTags: ['*'] }];
  put(root, 'nx.json', nxConfig);
  const passed = nx(root, 'conformance:check');
  expect(passed.code, passed.output).toBe(0);
  expect(JSON.parse(fs.readFileSync(path.join(root, 'dist/conformance-result.json'), 'utf8')).ruleResults.every((item) => item.details.violations.length === 0)).toBe(true);
  const generated = nx(root, 'generate', '@nx/conformance:create-rule', '--name=official-import', '--directory=rules/src', '--category=security', '--interactive=false');
  expect(generated.code, generated.output).toBe(0);
  expect(fs.readFileSync(path.join(root, 'rules/src/official-import/index.ts'), 'utf8')).toContain("from '@beta_su/nx-lint'");
  expect(JSON.parse(fs.readFileSync(path.join(root, 'rules/src/official-import/schema.json'), 'utf8'))).toMatchObject({ $id: 'official-import', title: 'official-import rule configuration' });
}, 90000);

test('silent fixes write changes without a second evaluation, and fix generators run even for empty results', () => {
  const root = workspace();
  put(root, 'rules/fix/index.cjs', "module.exports={name:'silent',category:'consistency',description:'silent',implementation:async({tree})=>({severity:'low',details:{violations:tree.exists('fixed.txt')?[]:[{workspaceViolation:true,message:'missing fixed.txt'}]}}),fixGenerator:async(tree)=>{tree.write('fixed.txt','fixed');}};");
  put(root, 'rules/fix/schema.json', { type: 'object' });
  const nxConfig = config(root);
  nxConfig.conformance.rules = [{ rule: './rules/fix/index.cjs' }];
  put(root, 'nx.json', nxConfig);
  put(root, 'silent.cjs', "require('@beta_su/nx-lint/conformance-handler').conformanceHandler({},'silent').then(code=>{process.exitCode=code;});");
  const first = child(root, path.join(root, 'silent.cjs'), []);
  expect(first.code).toBe(1);
  expect(fs.readFileSync(path.join(root, 'fixed.txt'), 'utf8')).toBe('fixed');
  const firstReport = JSON.parse(fs.readFileSync(path.join(root, 'dist/conformance-result.json'), 'utf8'));
  expect(firstReport.ruleResults[0].runnerData.countOfViolationsFixedByGenerator).toBe(0);
  const second = nx(root, 'run', 'fixture:conformance-fix');
  expect(second.code, second.output).toBe(0);
  const secondReport = JSON.parse(fs.readFileSync(path.join(root, 'dist/conformance-result.json'), 'utf8'));
  expect(secondReport.ruleResults[0].runnerData).toMatchObject({ fixGeneratorStatus: 'applied', countOfOriginalViolations: 0 });
}, 90000);

test('the fix recheck merges results for each configured occurrence of a rule', () => {
  const root = workspace();
  const rule = './rules/marker/index.cjs';
  put(root, 'rules/marker/index.cjs', `
    module.exports = {
      name: 'marker', category: 'consistency', description: 'Check for a workspace marker',
      implementation: async ({ tree, ruleOptions }) => ({
        severity: 'low',
        details: { violations: tree.exists(ruleOptions.file) ? [] : [{ workspaceViolation: true, message: ruleOptions.file }] },
      }),
      fixGenerator: async (tree, { ruleOptions }) => {
        if (ruleOptions.fix) tree.write(ruleOptions.file, 'present');
      },
    };
  `);
  put(root, 'rules/marker/schema.json', { type: 'object' });
  const nxConfig = config(root);
  nxConfig.conformance.rules = [
    { rule, options: { file: 'first.txt', fix: true } },
    { rule, options: { file: 'second.txt' } },
  ];
  put(root, 'nx.json', nxConfig);
  const execution = cli(root, 'conformance');
  expect(execution.code, execution.output).toBe(1);
  const { ruleResults } = JSON.parse(fs.readFileSync(path.join(root, 'dist/conformance-result.json'), 'utf8'));
  expect(ruleResults.map(({ details }) => details.violations.map(({ message }) => message))).toEqual([[], ['second.txt']]);
  expect(ruleResults.map(({ runnerData }) => runnerData.countOfViolationsFixedByGenerator)).toEqual([1, 0]);
}, 90000);


test('the real Nx inferred target enforces an existing built-in rule and reports project findings', () => {
  const root = workspace();
  const failure = nx(root, 'run', 'fixture:conformance-check');
  expect(failure.output).toContain('ensure-owners');
  expect(failure.code).toBe(1);
  const report = JSON.parse(fs.readFileSync(path.join(root, 'dist/conformance-result.json'), 'utf8'));
  expect(report.ruleResults[0].details.violations).toMatchObject([{ sourceProject: 'fixture' }]);
  const project = JSON.parse(fs.readFileSync(path.join(root, 'project.json'), 'utf8'));
  project.metadata = { owners: { '@owner': [] } };
  put(root, 'project.json', project);
  const success = nx(root, 'run', 'fixture:conformance-check');
  expect(success.output).toContain('Conformance checks passed');
  expect(success.code).toBe(0);
}, 120000);

test('a newly generated TypeScript rule enforces, fixes, rechecks, bundles and runs from its bundle', () => {
  const root = workspace();
  const generated = nx(root, 'generate', '@beta_su/nx-lint:create-rule', '--name=required-marker', '--directory=rules/src', '--category=reliability', '--interactive=false');
  expect(generated.output).toContain('CREATE');
  expect(generated.code).toBe(0);
  const filename = 'rules/src/required-marker/index.ts';
  const source = fs.readFileSync(path.join(root, filename), 'utf8')
    .replace('const violations: ConformanceViolation[] = [];', "const violations: ConformanceViolation[] = context.tree.exists('required.txt') ? [] : [{ workspaceViolation: true, message: 'Missing required.txt' }];")
    .replace('  implementation:', "  fixGenerator: async (tree) => { tree.write('required.txt', 'fixed'); },\n  implementation:");
  put(root, filename, source);
  const nxConfig = config(root);
  nxConfig.conformance.rules = [{ rule: './' + filename }];
  put(root, 'nx.json', nxConfig);
  const failure = cli(root, 'conformance:check');
  expect(failure.output).toContain('Missing required.txt');
  expect(failure.code).toBe(1);
  expect(fs.existsSync(path.join(root, 'required.txt'))).toBe(false);
  const fixed = nx(root, 'run', 'fixture:conformance-fix');
  expect(fixed.output).toContain('Conformance checks passed');
  expect(fixed.code).toBe(0);
  expect(fs.readFileSync(path.join(root, 'required.txt'), 'utf8')).toBe('fixed');
  const report = JSON.parse(fs.readFileSync(path.join(root, 'dist/conformance-result.json'), 'utf8'));
  expect(report.ruleResults[0].runnerData).toMatchObject({ fixGeneratorStatus: 'applied', countOfOriginalViolations: 1, countOfViolationsFixedByGenerator: 1 });
  put(root, 'rules/project.json', { name: 'rules', targets: { build: { executor: '@beta_su/nx-lint:bundle-rules', options: { outputPath: 'dist/rules' } } } });
  const bundled = nx(root, 'run', 'rules:build');
  expect(bundled.output).toContain('Bundled rule: required-marker');
  expect(bundled.code).toBe(0);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'dist/rules/required-marker/package.json'), 'utf8'));
  expect(manifest.dependencies).toEqual({ '@beta_su/nx-lint': '^0' });
  nxConfig.conformance.rules[0].rule = './dist/rules/required-marker/index.js';
  put(root, 'nx.json', nxConfig);
  fs.unlinkSync(path.join(root, 'required.txt'));
  const bundleFailure = cli(root, 'conformance:check');
  expect(bundleFailure.output).toContain('Missing required.txt');
  expect(bundleFailure.code).toBe(1);
}, 180000);

test('configuration validation, statuses, schema errors, default exports, printConfig and outputPath are observable through CLI', () => {
  const root = workspace();
  put(root, 'rules/local/index.cjs', "module.exports={default:{default:{name:'local',category:'security',description:'local',implementation:async({ruleOptions})=>({severity:'high',details:{violations:[{workspaceViolation:true,message:ruleOptions.message}]}})}}};");
  put(root, 'rules/local/schema.json', { type: 'object', required: ['message'], properties: { message: { type: 'string' } }, additionalProperties: false });
  const nxConfig = config(root);
  nxConfig.conformance = { outputPath: false, rules: [{ rule: './rules/local/index.cjs', options: { message: 'observed' }, status: 'evaluated' }] };
  put(root, 'nx.json', nxConfig);
  const evaluated = cli(root, 'conformance:check');
  expect(evaluated.code).toBe(0);
  expect(evaluated.output).toContain('observed');
  expect(fs.existsSync(path.join(root, 'dist/conformance-result.json'))).toBe(false);
  expect(cli(root, 'conformance:check', '--printConfig').output).toContain('"outputPath": false');
  nxConfig.conformance.rules[0].status = 'disabled';
  put(root, 'nx.json', nxConfig);
  const disabled = cli(root, 'conformance:check');
  expect(disabled.code).toBe(0);
  expect(disabled.output).not.toContain('observed');
  nxConfig.conformance.rules[0].options.message = 123;
  put(root, 'nx.json', nxConfig);
  const schemaFailure = cli(root, 'conformance:check');
  expect(schemaFailure.code).toBe(1);
  expect(schemaFailure.output).toContain('schema');
  nxConfig.conformance.rules[0].options.message = 'observed';
  nxConfig.conformance.rules[0].status = 'unknown';
  put(root, 'nx.json', nxConfig);
  expect(cli(root, 'conformance:check').output).toContain('rule.status');
  nxConfig.conformance.rules[0].status = 'enforced';
  nxConfig.conformance.rules[0].rule = 'nx-cloud:example';
  put(root, 'nx.json', nxConfig);
  const cloud = cli(root, 'conformance:check');
  expect(cloud.code).toBe(1);
  expect(cloud.output).toContain('no Cloud connection');
}, 180000);

test('the preset creates a rule project without connecting to Cloud', () => {
  const root = workspace();
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  pkg.packageManager = 'pnpm@11.15.1';
  put(root, 'package.json', pkg);
  put(root, 'pnpm-workspace.yaml', 'packages:\n  - packages/*\nallowBuilds:\n  esbuild: false\n  nx: false\n');
  put(root, 'apps/existing/index.ts', 'export const app = true;');
  put(root, 'libs/existing/index.ts', 'export const lib = true;');
  const preset = nx(root, 'generate', '@beta_su/nx-lint:preset', '--interactive=false');
  expect(preset.code, preset.output).toBe(0);
  expect(fs.readFileSync(path.join(root, 'apps/existing/index.ts'), 'utf8')).toBe('export const app = true;');
  expect(fs.readFileSync(path.join(root, 'libs/existing/index.ts'), 'utf8')).toBe('export const lib = true;');
  expect(fs.existsSync(path.join(root, 'packages/conformance-rules/src/example-conformance-rule/index.ts'))).toBe(true);
  const definition = JSON.parse(fs.readFileSync(path.join(root, 'packages/conformance-rules/package.json'), 'utf8')).nx;
  expect(definition.targets.build.executor).toBe('@beta_su/nx-lint:bundle-rules');
  expect(Object.keys(definition.targets)).not.toContain('publish-conformance-rules');
}, 90000);

test('the reserved Cloud hooks preserve resolution, scheduling and result callbacks without making network requests', () => {
  const root = workspace();
  put(root, 'hooks.cjs', [
    "const fs = require('node:fs');",
    "const {conformanceHandler} = require('@beta_su/nx-lint/conformance-handler');",
    "const events=[];",
    "conformanceHandler({},false,{",
    "validateConfiguration(config){events.push('validate');if(!config.rules)throw Error('missing');},",
    "preRuleResolutionHook:async config=>{events.push('pre');return {...config,outputPath:false,rules:[{rule:'nx-cloud:reserved'}]};},",
    "ruleResolver:async rule=>{events.push('resolve:'+rule);return {error:null,data:{ruleSpecifier:rule,status:'disabled',scheduledStatus:'evaluated',scheduledStatusDate:1,ruleModule:{name:'adapter-rule',category:'security',description:'adapter',implementation:async()=>({severity:'high',details:{violations:[{workspaceViolation:true,message:'evaluated after schedule'}]}})}}};},",
    "postRuleResolutionHook:async()=>{events.push('resolved');},",
    "postResultHook:async result=>{events.push('results');fs.writeFileSync('hooks.json',JSON.stringify({events,result}));}",
    "}).then(code=>{process.exitCode=code;});",
  ].join('\n'));
  const execution = child(root, path.join(root, 'hooks.cjs'), []);
  expect(execution.code, execution.output).toBe(0);
  const { events, result } = JSON.parse(fs.readFileSync(path.join(root, 'hooks.json'), 'utf8'));
  expect(events).toEqual(['validate', 'pre', 'resolve:nx-cloud:reserved', 'resolved', 'results']);
  expect(result.ruleResults[0]).toMatchObject({ resolvedStatus: 'evaluated', details: { violations: [{ message: 'evaluated after schedule' }] } });
}, 90000);

test.each([
  [false, false, false, 1, ['validate', 'pre', 'resolve', 'resolved', 'evaluate', 'results']],
  [true, false, 'matrix-report.json', 0, ['validate', 'pre', 'resolve', 'resolved', 'evaluate', 'fix', 'evaluate', 'results']],
  ['silent', false, 'matrix-report.json', 1, ['validate', 'pre', 'resolve', 'resolved', 'evaluate', 'fix', 'results']],
  [false, true, 'matrix-report.json', 0, ['validate', 'pre', 'resolve']],
])('Cloud interface hooks preserve fix=%s printConfig=%s outputPath=%s lifecycle', (fix, printConfig, outputPath, code, expectedEvents) => {
  const root = workspace();
  put(root, 'matrix.cjs', [
    "const fs=require('node:fs');const {conformanceHandler}=require('@beta_su/nx-lint/conformance-handler');const events=[];",
    'conformanceHandler({printConfig:' + JSON.stringify(printConfig) + '},' + JSON.stringify(fix) + ',{',
    "validateConfiguration(){events.push('validate');},",
    "preRuleResolutionHook:async()=>{events.push('pre');return {outputPath:" + JSON.stringify(outputPath) + ",rules:[{rule:'nx-cloud:memory'}]};},",
    "ruleResolver:async()=>{events.push('resolve');return {error:null,data:{ruleSpecifier:'nx-cloud:memory',ruleModule:{name:'matrix-rule',category:'consistency',description:'matrix',implementation:async({tree})=>{events.push('evaluate');return {severity:'low',details:{violations:tree.exists('fixed.txt')?[]:[{workspaceViolation:true,message:'missing marker'}]}};},fixGenerator:async(tree)=>{events.push('fix');tree.write('fixed.txt','fixed');}}}};},",
    "postRuleResolutionHook:async()=>{events.push('resolved');},",
    "postResultHook:async()=>{events.push('results');if(" + JSON.stringify(outputPath) + "&&!fs.existsSync('matrix-report.json'))throw Error('report must exist before result hook');}",
    "}).then(code=>fs.writeFileSync('matrix-result.json',JSON.stringify({code,events,reportWritten:fs.existsSync('matrix-report.json'),fixed:fs.existsSync('fixed.txt')})));",
  ].join('\n'));
  const execution = child(root, path.join(root, 'matrix.cjs'), []);
  expect(execution.code, execution.output).toBe(0);
  const result = JSON.parse(fs.readFileSync(path.join(root, 'matrix-result.json'), 'utf8'));
  expect(result).toEqual({ code, events: expectedEvents, reportWritten: !!outputPath && !printConfig, fixed: !!fix && !printConfig });
}, 90000);

test.each([false, true])('final fixed results reach the usual report sinks with reporters enabled=%s', (withReporters) => {
  const root = workspace();
  const nxConfig = config(root);
  nxConfig.conformance.rules = [{ rule: 'nx-cloud:reporter-test' }];
  nxConfig.conformance.outputPath = 'rule-report.json';
  put(root, 'nx.json', nxConfig);
  put(root, 'reporters.cjs', `
    const fs = require('node:fs');
    const path = require('node:path');
    const terminal = require(path.join(path.dirname(require.resolve('@beta_su/nx-lint')), 'terminal-reporter.js'));
    const events = [];
    let terminalResults;
    let reportedResults;
    let outputExistedAtReporter;
    const reportToTerminal = terminal.terminalReporter;
    terminal.terminalReporter = (result) => {
      events.push('terminal');
      terminalResults = result.ruleResults;
      reportToTerminal(result);
    };
    const { conformanceHandler, validateConfiguration } = require('@beta_su/nx-lint/conformance-handler');
    const reporters = [
      async ({ ruleResults }) => {
        events.push('first:start');
        await new Promise((resolve) => setImmediate(resolve));
        reportedResults = ruleResults;
        outputExistedAtReporter = fs.existsSync('rule-report.json');
        events.push('first:end');
      },
      () => { events.push('throwing'); throw new Error('reporter test error'); },
      () => { events.push('last'); },
    ];
    const args = process.argv[2] === 'true' ? { reporters } : {};
    conformanceHandler(args, true, {
      validateConfiguration,
      preRuleResolutionHook: async (config) => config,
      ruleResolver: async (ruleSpecifier) => ({ error: null, data: {
        ruleSpecifier,
        ruleModule: {
          name: 'reporter-test', category: 'consistency', description: 'Reporter lifecycle',
          implementation: async ({ tree }) => {
            const fixed = tree.exists('fixed.txt');
            return { severity: 'low', details: {
              violations: fixed ? [] : [{ workspaceViolation: true, message: 'missing marker' }],
              checks: [{ rule: 'marker', durationMs: 1, units: [{ project: '', value: fixed ? 0 : 1 }] }],
            } };
          },
          fixGenerator: async (tree) => { tree.write('fixed.txt', 'fixed'); },
        },
      } }),
      postRuleResolutionHook: async () => {},
      postResultHook: async ({ ruleResults }) => {
        events.push('post-result');
        fs.writeFileSync('lifecycle.json', JSON.stringify({
          events, ruleResults, outputExistedAtReporter,
          outputExistsAtHook: fs.existsSync('rule-report.json'),
          sameTerminalResults: ruleResults === terminalResults,
          sameReporterResults: ruleResults === reportedResults,
        }));
      },
    }).then((code) => { process.exitCode = code; });
  `);
  const execution = child(root, path.join(root, 'reporters.cjs'), [String(withReporters)]);
  expect(execution.code, execution.output).toBe(0);
  expect(execution.output).toContain('Fix generator applied; fixed 1 violation(s)');
  expect(execution.output).toContain('Conformance checks passed successfully');
  expect(execution.output.match(/Conformance reporter failed: Error: reporter test error/g) ?? []).toHaveLength(withReporters ? 1 : 0);
  const lifecycle = JSON.parse(fs.readFileSync(path.join(root, 'lifecycle.json'), 'utf8'));
  expect(lifecycle.events).toEqual(withReporters
    ? ['terminal', 'first:start', 'first:end', 'throwing', 'last', 'post-result']
    : ['terminal', 'post-result']);
  expect(lifecycle.sameTerminalResults).toBe(true);
  expect(lifecycle.sameReporterResults).toBe(withReporters);
  expect(lifecycle.outputExistedAtReporter).toBe(withReporters ? false : undefined);
  expect(lifecycle.outputExistsAtHook).toBe(true);
  expect(JSON.parse(fs.readFileSync(path.join(root, 'rule-report.json'), 'utf8'))).toEqual({ ruleResults: lifecycle.ruleResults });
  expect(lifecycle.ruleResults[0]).toMatchObject({
    details: { violations: [], checks: [{ rule: 'marker', durationMs: 1, units: [{ project: '', value: 0 }] }] },
    runnerData: { countOfOriginalViolations: 1, countOfViolationsFixedByGenerator: 1 },
  });
}, 90000);

test('rule evaluation errors fail the process and a missing sibling schema is rejected even for disabled rules', () => {
  const root = workspace();
  put(root, 'rules/broken/index.cjs', "module.exports={name:'broken',category:'security',description:'broken',implementation:async()=>{throw Error('rule crashed');}};");
  put(root, 'rules/broken/schema.json', { type: 'object' });
  const nxConfig = config(root);
  nxConfig.conformance.rules = [{ rule: './rules/broken/index.cjs' }];
  put(root, 'nx.json', nxConfig);
  const crashed = cli(root, 'conformance:check');
  expect(crashed.code).toBe(1);
  expect(crashed.output).toContain('rule crashed');
  fs.unlinkSync(path.join(root, 'rules/broken/schema.json'));
  nxConfig.conformance.rules[0].status = 'disabled';
  put(root, 'nx.json', nxConfig);
  const missing = cli(root, 'conformance:check');
  expect(missing.code).toBe(1);
  expect(missing.output).toContain('No schema.json');
}, 90000);


test('Nx native conformance commands resolve existing rule imports through the package alias', () => {
  const root = workspace();
  aliasConformance(root);
  put(root, 'rules/unchanged/index.cjs', "const {createConformanceRule}=require('@nx/conformance');module.exports=createConformanceRule({name:'unchanged-import',category:'consistency',description:'Existing rule interface',implementation:async()=>({severity:'low',details:{violations:[{workspaceViolation:true,message:'native command blocked'}]}})});");
  put(root, 'rules/unchanged/schema.json', { type: 'object' });
  const nxConfig = config(root);
  nxConfig.conformance.rules = [{ rule: './rules/unchanged/index.cjs' }];
  put(root, 'nx.json', nxConfig);
  const failed = nx(root, 'conformance:check');
  expect(failed.output).toContain('native command blocked');
  expect(failed.code).toBe(1);
  nxConfig.conformance.rules[0].status = 'disabled';
  put(root, 'nx.json', nxConfig);
  const passed = nx(root, 'conformance:check');
  expect(passed.output).toContain('Conformance checks passed');
  expect(passed.code).toBe(0);
}, 90000);
