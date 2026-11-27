# Nx Lint

Nx 工作区规则插件，用于检查项目依赖、所有权和自定义工作区约束。

本地规则生命周期、公开 TypeScript 类型、规则解析、测试工具、两项内置规则、生成器和 bundle-rules executor 均有实现。Cloud 连接、发布、下载和服务端配置暂不实现；conformanceHandler 的 Cloud adapter hook 保留。

## 安装与调用

需要 Node >=22.12，以及同版本的 `nx`、`@nx/devkit` 和 `@nx/js`。

从源码目录开发或安装 file dependency 前先构建：

    pnpm install
    ./bin/test-infra run nx-lint:build

运行和类型入口均指向 `dist/`；`pnpm pack` 会通过 prepack 自动构建。发行包自带可执行 JavaScript，消费方安装时无需编译本包。

直接加载本地 TypeScript 规则时，Node 22.12–22.17 需要启用 `--experimental-strip-types`，或安装 Nx 支持的 TypeScript loader；Node 24 验收环境使用原生类型剥离。

    pnpm add -D nx-lint@0.1.0 @nx/js@23.3.0

在 nx.json 中注册插件和规则：

    {
      "plugins": ["nx-lint/plugin"],
      "conformance": {
        "outputPath": "dist/conformance-result.json",
        "rules": [
          { "rule": "nx-lint/enforce-project-boundaries" }
        ]
      }
    }

插件为根项目推断 conformance-check 和 conformance-fix 两个不可缓存 Target：

    pnpm exec nx run <根项目>:conformance-check
    pnpm exec nx run <根项目>:conformance-fix

也可以直接调用 CLI：

    pnpm exec nx-lint conformance:check
    pnpm exec nx-lint conformance
    pnpm exec nx-lint conformance:check --printConfig

check 不运行 fix generator。普通 conformance 先评估、按配置顺序应用 fix、写入变更，再评估规则。默认保存 JSON；outputPath:false 关闭文件输出。enforced 违规返回非零，evaluated 只报告，disabled 不执行。projects 使用 Nx 原生项目匹配语法，支持 {matcher, explanation}。

要让现有 lint/check 门禁包含规则检查，在根项目 lint 的 dependsOn 中加入 conformance-check。

## 保留原来的命令与 import

新代码从 `nx-lint` 或 `nx-lint/conformance` 导入规则类型与工厂。执行器可从 `nx-lint/conformance-handler` 导入 `conformanceHandler`。

要使用 Nx 原生 `conformance` 和 `conformance:check` 命令，在根 `package.json` 将 Nx 查找的两个包名安装为 `nx-lint` 的 npm 别名。

```json
{
  "devDependencies": {
    "nx-lint": "0.1.0",
    "@nx/conformance": "npm:nx-lint@0.1.0",
    "@nx/powerpack-conformance": "npm:nx-lint@0.1.0"
  }
}
```

在根 `pnpm-workspace.yaml` 同步约束传递依赖。

```yaml
overrides:
  "@nx/conformance": "npm:nx-lint@0.1.0"
  "@nx/powerpack-conformance": "npm:nx-lint@0.1.0"
```

已有 `@nx/conformance` 子路径导入和内置规则配置可通过别名加载。生成器统一生成 `nx-lint` 导入。两个独立 legacy bin 用于 Nx <19.8，新版本使用 Nx 原生命令或 `nx-lint` CLI。

## 新规则

    pnpm exec nx generate nx-lint:create-rule \
      --name=my-rule --directory=tools/rules --category=reliability --interactive=false

生成 `index.ts` 和同目录 `schema.json` 后，将 `./tools/rules/my-rule/index.ts` 加入 `conformance.rules`。在 `implementation` 中使用只读 `tree`、`projectGraph`、`fileMapCache` 和 `ruleOptions`，返回 `severity` 和 `details.violations`。违规应指定 `file`、`sourceProject` 或 `workspaceViolation: true`。需要自动修复时，可以通过 `fixGenerator` 提供修复逻辑。

内置规则：

- enforce-project-boundaries：应用/E2E 依赖限制、可构建库依赖、循环与忽略对、标签约束、文件归属。
- ensure-owners：检查项目 metadata.owners；不会安装或实现 Nx Owners。

bundle-rules 为每条规则生成 index.js、schema.json、package.json：

    {
      "executor": "nx-lint:bundle-rules",
      "outputs": ["{options.outputPath}"],
      "options": { "rulesDirectory": "tools/rules", "outputPath": "dist/rules" }
    }

`preset` 为新工作区初始化 Nx JS 和 Prettier，并创建示例规则与构建入口。已有工作区可通过 `create-rule` 添加规则。

## 源码与构建

```text
src/
  index.ts / types.ts          公开入口与规则契约
  commands/nx-lint/            命令定义、Cloud hook 与执行生命周期
  rules-runner.ts              并发评估、归属与过滤、顺序修复
  resolve-rule.ts              本地规则加载与 schema 校验
  rules/<name>/               内置规则及相邻 schema
  executors/                  Nx 检查入口、规则打包
  generators/                 规则与工作区生成器
  utils/                      规则工厂、依赖版本解析
testing/                      临时目录、工作区生命周期、图 fixture
bin/                          CLI 启动入口
tools/build.cjs               tsc、静态资产与 CommonJS 入口构建
dist/                         JavaScript、生成的声明和 Nx 静态资源
```

构建从 TypeScript 实现生成声明，复制 Nx 需要的 schema，并设置 CLI 执行权限。生成的 CommonJS 入口支持直接 `require()`。

公开子路径包括 conformance、rules-runner、resolve-rule、conformance-handler、testing、两个 bin、create-rule generator、bundle-rules executor/schema 和内置规则。

Nx 插件使用 Nx 的 JSONC 读取器。规则打包分别解析 Conformance、Owners 与 Nx 的版本。测试辅助 API 在初始化失败和正常清理时均恢复临时目录、`workspaceRoot` 和 `INIT_CWD`。

## 验证

本包测试入口：

    ./bin/test-infra run nx-lint:test-contracts--p0
    ./bin/test-infra run nx-lint:type-check
    ./bin/test-infra run nx-lint:test-official-rules--p0
    ./bin/test-infra run nx-lint:test-source-structure--p0
    ./bin/test-infra run nx-lint:test-package--p0

同项目多个目标使用单次 `run-many -p nx-lint -t <targets...>`，由 Nx 共享一次 build；不要让多个独立命令同时重建同一个 dist。

可以在隔离的 Nx 工作区验收已安装的 `nx-lint` 和别名。准备一个没有所有权声明且具有隐式依赖的示例项目。

    NX_LINT_INTEGRATION_WORKSPACE="$(cd ../isolated-workspace && pwd)" ./bin/test-infra run nx-lint:test-installed-workspace--p0

该命令临时替换示例工作区的规则配置，验证 enforced 和 evaluated 行为，随后恢复原配置并再次运行原有检查。

`test-package--p0` 在全新工作区通过同一份 tarball 验证 `nx-lint` 与 Nx 别名、原生命令、推断任务、生成器、规则 schema 和 CLI 权限。Cloud hook 覆盖 check、fix、silent、printConfig 和 outputPath 的分支顺序。
