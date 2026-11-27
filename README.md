# Nx Lint

Nx 原生命令先查找 `@nx/powerpack-conformance`，再查找 `@nx/conformance`。将两个名称设为 `@beta_su/nx-lint` 的 npm 别名，原生命令和本地规则就会使用同一份运行器。

## 安装

在已有 Nx 工作区使用 Node.js 22.12+，并保持 `nx`、`@nx/devkit` 和 `@nx/js` 的版本一致。在根 `package.json` 的 `devDependencies` 中声明主包和两个别名。

```json
{
  "@beta_su/nx-lint": "0.1.1",
  "@nx/conformance": "npm:@beta_su/nx-lint@0.1.1",
  "@nx/powerpack-conformance": "npm:@beta_su/nx-lint@0.1.1"
}
```

在根 `pnpm-workspace.yaml` 中将传递依赖也指向同一个包版本。

```yaml
overrides:
  "@nx/conformance": "npm:@beta_su/nx-lint@0.1.1"
  "@nx/powerpack-conformance": "npm:@beta_su/nx-lint@0.1.1"
```

## 使用

保留 `nx.json` 中已有的 `conformance` 配置和规则里的 `@nx/conformance` 导入。安装后可继续用 Nx 原生命令检查规则或应用修复。

```sh
pnpm install
pnpm exec nx conformance:check
pnpm exec nx conformance
```

新规则可以直接从 `@beta_su/nx-lint` 导入工厂和类型。自定义执行器从 `@beta_su/nx-lint/conformance-handler` 导入 `conformanceHandler`，执行 `nx-cloud:` 规则时需提供 Cloud adapter。
