import { expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = path.join(packageRoot, '.acceptance');
function execute(command, args, cwd, label) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 20 * 1024 * 1024, env: { ...process.env, NX_DAEMON: 'false', NX_ISOLATE_PLUGINS: 'false', NX_TUI: 'false', CI: 'true' } });
  fs.writeFileSync(path.join(evidence, label + '.log'), (result.stdout ?? '') + (result.stderr ?? ''));
  if (result.error) throw result.error;
  expect(result.status, label + '\n' + result.stdout + result.stderr).toBe(0);
  return result;
}

test('one packed package serves direct imports and the Nx aliases without the source checkout', () => {
  fs.mkdirSync(evidence, { recursive: true });
  const tarball = path.join(evidence, 'nx-lint-0.1.0.tgz');
  execute('pnpm', ['--config.ignore-scripts=true', 'pack', '--out', tarball], packageRoot, 'package-main-pack');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nx-lint-packed-consumer-')));
  try {
    const put = (name, data) => fs.writeFileSync(path.join(root, name), JSON.stringify(data, null, 2));
    const packageSpec = 'file:' + tarball;
    const aliases = { '@nx/conformance': packageSpec, '@nx/powerpack-conformance': packageSpec };
    put('package.json', { name: 'packed-consumer', private: true, devDependencies: {
      'nx-lint': packageSpec,
      ...aliases,
      nx: '23.3.0', '@nx/devkit': '23.3.0', '@nx/js': '23.3.0',
    } });
    put('pnpm-workspace.yaml', { overrides: aliases });
    put('project.json', { name: 'packed-consumer', metadata: { owners: { '@team': [] } }, targets: {} });
    put('nx.json', { neverConnectToCloud: true, plugins: ['nx-lint/plugin'], conformance: { rules: [
      { rule: '@nx/conformance/ensure-owners' },
      { rule: '@nx/conformance/enforce-project-boundaries', options: {} },
      { rule: './rules/direct/index.cjs' },
    ] } });
    fs.mkdirSync(path.join(root, 'rules/direct'), { recursive: true });
    fs.writeFileSync(path.join(root, 'rules/direct/index.cjs'), [
      "const { createConformanceRule } = require('nx-lint');",
      "module.exports = createConformanceRule({ name: 'direct', category: 'consistency', description: 'Direct package import',",
      "  implementation: async () => ({ severity: 'low', details: { violations: [] } }),",
      "});",
    ].join('\n'));
    put('rules/direct/schema.json', { type: 'object' });
    execute('pnpm', ['install', '--prefer-offline', '--ignore-scripts', '--registry=https://registry.npmjs.org'], root, 'package-consumer-install');
    const fromConsumer = createRequire(path.join(root, 'package.json'));
    const installed = path.dirname(fromConsumer.resolve('nx-lint/package.json'));
    expect(installed.startsWith(packageRoot)).toBe(false);
    for (const alias of Object.keys(aliases)) expect(fromConsumer(alias)).toBe(fromConsumer('nx-lint'));
    expect(fromConsumer('nx-lint/conformance')).toBe(fromConsumer('nx-lint'));
    expect(typeof fromConsumer('nx-lint/conformance-handler').conformanceHandler).toBe('function');
    const metadata = fromConsumer('nx-lint/package.json');
    for (const descriptor of [metadata.generators, metadata.executors]) {
      const definition = JSON.parse(fs.readFileSync(path.join(installed, descriptor), 'utf8'));
      for (const entry of Object.values(definition.generators ?? definition.executors)) {
        for (const field of ['factory', 'implementation', 'schema']) if (entry[field]) expect(fs.existsSync(path.join(installed, entry[field]))).toBe(true);
      }
    }
    const nx = fromConsumer.resolve('nx/bin/nx');
    execute(process.execPath, [nx, 'conformance:check', '--output-style=static'], root, 'package-consumer-native-check');
    execute(process.execPath, [nx, 'run', 'packed-consumer:conformance-check', '--output-style=static'], root, 'package-consumer-inferred-check');
    const report = JSON.parse(fs.readFileSync(path.join(root, 'dist/conformance-result.json'), 'utf8'));
    expect(report.ruleResults).toHaveLength(3);
    expect(report.ruleResults.every((rule) => rule.details.violations.length === 0)).toBe(true);
    execute(process.execPath, [nx, 'generate', '@nx/conformance:create-rule', '--name=from-tarball', '--directory=rules', '--category=consistency', '--interactive=false'], root, 'package-consumer-generate');
    expect(fs.readFileSync(path.join(root, 'rules/from-tarball/index.ts'), 'utf8')).toContain("from 'nx-lint'");
    execute(process.execPath, [nx, 'generate', 'nx-lint:create-rule', '--name=native-from-tarball', '--directory=rules', '--category=consistency', '--interactive=false'], root, 'package-consumer-native-generate');
    expect(fs.readFileSync(path.join(root, 'rules/native-from-tarball/index.ts'), 'utf8')).toContain("from 'nx-lint'");
    for (const name of ['ensure-owners', 'enforce-project-boundaries']) {
      const entry = '@nx/conformance/' + name;
      expect(fs.existsSync(path.join(path.dirname(fromConsumer.resolve(entry)), 'schema.json'))).toBe(true);
      expect(fromConsumer(entry).default).toBe(fromConsumer('nx-lint/' + name));
    }
    for (const command of ['nx-lint', 'conformance', 'conformance-check']) expect(fs.statSync(path.join(installed, 'dist/bin/' + command + '.js')).mode & 0o111).not.toBe(0);
    fs.writeFileSync(path.join(evidence, 'package-acceptance.json'), JSON.stringify({ status: 'passed', installedFromTarball: true, aliases: Object.keys(aliases), rules: report.ruleResults.map((rule) => rule.ruleSpecifier), generatedRule: 'from-tarball', sourceCheckoutRequired: false, executableBins: 3 }, null, 2));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}, 180000);
