'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const workspace = process.env.NX_LINT_INTEGRATION_WORKSPACE;
if (!workspace || !path.isAbsolute(workspace)) throw new Error('Set NX_LINT_INTEGRATION_WORKSPACE to an absolute path to an isolated Nx workspace.');
const packageRoot = path.resolve(__dirname, '..');
const evidence = path.join(packageRoot, '.acceptance');
const fromWorkspace = createRequire(path.join(workspace, 'package.json'));
const installedRoot = path.dirname(fromWorkspace.resolve('nx-lint/package.json'));
assert.equal(fromWorkspace.resolve('@nx/conformance/package.json'), path.join(installedRoot, 'package.json'));
const summary = { workspace, node: process.version, comparedFiles: 0, officialRules: [], steps: [] };
function compare(source, installed) {
  for (const item of fs.readdirSync(source, { withFileTypes: true })) {
    const original = path.join(source, item.name), actual = path.join(installed, item.name);
    if (item.isDirectory()) compare(original, actual);
    else {
      assert.deepEqual(fs.readFileSync(actual), fs.readFileSync(original), 'Installed artifact differs: ' + actual);
      summary.comparedFiles++;
    }
  }
}
compare(path.join(packageRoot, 'dist'), path.join(installedRoot, 'dist'));
for (const name of ['ensure-owners', 'enforce-project-boundaries']) {
  const filename = fromWorkspace.resolve('@nx/conformance/' + name);
  assert(fs.existsSync(path.join(path.dirname(filename), 'schema.json')));
  assert.equal(fromWorkspace('@nx/conformance/' + name).default.name, name);
  summary.officialRules.push({ name, filename, siblingSchema: true });
}
const configPath = path.join(workspace, 'nx.json');
const originalConfig = fs.readFileSync(configPath);
fs.mkdirSync(evidence, { recursive: true });
function run(label, expected) {
  const execution = spawnSync('pnpm', ['exec', 'nx', 'conformance:check', '--output-style=static'], {
    cwd: workspace, encoding: 'utf8', timeout: 90000, maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, NX_DAEMON: 'false', NX_ISOLATE_PLUGINS: 'false', NX_TUI: 'false', CI: 'true' },
  });
  fs.writeFileSync(path.join(evidence, label + '.log'), (execution.stdout ?? '') + (execution.stderr ?? ''));
  if (execution.error) throw execution.error;
  assert.equal(execution.status, expected, label + ': ' + execution.stdout + execution.stderr);
  summary.steps.push({ label, exitCode: execution.status });
  const { conformance: { outputPath } } = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (outputPath === false) return;
  const report = JSON.parse(fs.readFileSync(path.join(workspace, outputPath || 'dist/conformance-result.json'), 'utf8'));
  fs.writeFileSync(path.join(evidence, label + '.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}
try {
  const config = JSON.parse(originalConfig);
  config.conformance.outputPath = 'dist/conformance-result.json';
  config.conformance.rules = [
    { rule: '@nx/conformance/ensure-owners' },
    { rule: '@nx/conformance/enforce-project-boundaries', options: { depConstraints: [{ sourceTag: '__compatibility_probe_no_match', onlyDependOnProjectsWithTags: ['*'] }] } },
  ];
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  const enforced = run('installed-official-rules-enforced', 1);
  assert.equal(enforced.ruleResults.length, 2);
  assert(enforced.ruleResults.every((rule) => rule.details.violations.length > 0));
  config.conformance.rules.forEach((rule) => { rule.status = 'evaluated'; });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  const evaluated = run('installed-official-rules-evaluated', 0);
  assert(evaluated.ruleResults.every((rule) => rule.resolvedStatus === 'evaluated' && rule.details.violations.length > 0));
} finally { fs.writeFileSync(configPath, originalConfig); }
run('installed-original-policies-restored', 0);
assert.deepEqual(fs.readFileSync(configPath), originalConfig);
summary.status = 'passed';
fs.writeFileSync(path.join(evidence, 'installed-compatibility-acceptance.json'), JSON.stringify(summary, null, 2) + '\n');
console.log('Installed compatibility artifacts and official rule specifiers passed; original policies restored.');
