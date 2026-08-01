# Chance Atoms Demo · Forge

> 一个可以公开部署、完整运行并继续迭代的 AI 应用生成 Demo。

Forge 是 Demo 内的产品名，`chance-atoms-demo` 是仓库、Cloudflare Worker 和交付项目名。用户用自然语言描述内部工具，先审阅执行计划，再生成一个可直接操作、持久保存、继续修改和回滚的 CRUD 应用。

## 在线体验与源码

- 在线 Demo：[https://chance-atoms-demo.chanceflying1.workers.dev](https://chance-atoms-demo.chanceflying1.workers.dev)
- GitHub 源码：[https://github.com/chanceflying/chance-atoms-demo](https://github.com/chanceflying/chance-atoms-demo)

公开 Demo 默认不配置模型密钥，使用仓库内的确定性 Agent，避免匿名访问消耗第三方额度。代码同时支持服务端 OpenAI Responses API；在受控环境配置密钥后会自动切换为模型生成。

## 核心体验

1. 输入需求，或选择“客户线索看板 / 内容发布日历 / 设备巡检台”模板。
2. Forge 先生成四步计划，只有用户确认后才开始构建。
3. Agent 生成声明式 `AppSpec`，服务端校验后由固定编译器生成应用。
4. 在 Preview 中新增、编辑、删除、搜索和筛选记录，数据自动保存到 D1。
5. 用自然语言继续调整字段、布局或主题；每次调整创建一个新版本。
6. 历史版本只读，可复制恢复成新的当前版本，不覆盖后续历史。
7. 点击“导出项目”，下载一个无依赖 ZIP；其中的 `index.html` 可独立部署并用 `localStorage` 保存数据。
8. 访客项目直接保存到 D1；使用 GitHub 登录后会自动认领当前项目，并支持跨浏览器、跨设备找回。

完整链路：

```text
Prompt → Plan approval → AppSpec → Validation → Safe compiler
       → Runnable CRUD app → D1 persistence → Refine / Rollback / Export
```

## 与笔试要求的对应关系

| 要求 | 当前实现 |
| --- | --- |
| 自然语言生成应用 | `/api/generate`，支持 OpenAI Responses API 和本地确定性降级 |
| 过程可理解、可控制 | 生成前展示四步 Plan，必须由用户明确确认 |
| 结果真正可运行 | 声明式 AppSpec 经固定编译器生成完整 CRUD HTML，在 sandbox iframe 中运行 |
| 支持持续修改 | 基于当前 Spec 的 refinement，每次形成独立版本 |
| 数据不是静态展示 | iframe 通过 `postMessage` 回传 CRUD 变化，Next.js API 写入 D1 |
| 访客试用与账号同步 | 匿名 workspace 免登录保存；GitHub OAuth 登录后迁移到账号 workspace |
| 可恢复、可追溯 | 项目与版本快照持久化；Rollback 复制成新版本 |
| 可独立交付 | 应用内可导出无依赖 ZIP；仓库本身也可标准部署到 Cloudflare |
| 稳定演示 | 无密钥 Agent、模型失败降级、输入校验、Schema 数据迁移和错误提示 |

## 技术架构

这是一个单仓库全栈项目，不是纯前端应用。

```text
Browser
  └─ Next.js / React Studio
      ├─ POST /api/generate
      │   ├─ OpenAI Responses API（可选，服务端调用）
      │   └─ Deterministic Agent（默认演示模式）
      ├─ AppSpec validator + deterministic compiler
      ├─ sandboxed iframe + postMessage
      ├─ POST /api/export → standalone ZIP
      ├─ /api/auth/* → GitHub OAuth + D1 sessions
      └─ /api/projects/* → Cloudflare D1
                              ├─ users + sessions
                              ├─ projects
                              └─ version snapshots

Next.js application
  └─ @opennextjs/cloudflare adapter
      └─ Cloudflare Worker runtime + static assets + D1 binding
```

各层职责：

- **Next.js 16 App Router**：同一个工程承载 React 页面和服务端 Route Handlers。
- **React 19**：Studio、计划确认、版本列表、预览控制和错误状态。
- **OpenNext for Cloudflare**：部署适配器，把标准 Next.js 构建转换成 Worker 包；它不是业务框架。
- **Cloudflare Workers**：公开运行 Next.js 服务端逻辑和静态资源。
- **Cloudflare D1**：保存用户、可撤销 Session、匿名或账号 workspace 下的项目、当前记录和版本快照。
- **Drizzle schema / SQL migrations**：数据库结构的唯一来源。
- **OpenAI Responses API（可选）**：只在服务端调用，密钥不会进入浏览器或导出包。

换句话说，Cloudflare 在这里负责“运行与存储”，Next.js/React 才是前后端应用框架。

## 安全边界

模型只生成声明式数据，不能直接生成并执行任意 JavaScript。

- `AppSpec`、字段、颜色和记录都经过运行时校验。
- 编译器固定在仓库内，不使用 `eval` 或 `new Function`。
- Preview 使用 CSP、sandbox、JSON 安全转义和 `textContent`。
- 历史版本禁止直接编辑；恢复会创建新版本。
- 新 Spec 会迁移兼容记录，删除过的字段不会让下一版崩溃。
- 写接口限制 JSON 请求体大小，并在服务端再次校验 `spec + records`。
- 导出 ZIP 限制文件名、路径、文件数和总大小，不包含任何密钥。
- 访客 workspace 由 `HttpOnly + SameSite=Lax` 匿名 Cookie 隔离。
- GitHub OAuth 使用随机 `state`、PKCE 和服务端 Client Secret；不请求仓库或邮箱权限。
- 登录 Session 使用随机 Token；浏览器只保存 `HttpOnly` Cookie，D1 只保存 SHA-256 哈希。
- 所有项目归属都在服务端解析，前端不能通过提交 `userId` 越权访问。

这是笔试 Demo，包含 GitHub 登录和账号级项目同步，但不包含团队权限、企业 SSO 或组织管理。公网 Demo 不应直接挂载无限额模型密钥；生产化仍需要 Cloudflare Rate Limiting / Turnstile 和模型额度策略。

## 本地运行

需要 Node.js `>=22.13.0`。

```bash
npm ci
cp .env.example .env.local
npm run db:migrate:local
npm run dev
```

打开终端输出中的本地地址。数据库必须先执行迁移；应用运行时不会绕过 migration 自行建表。

真实模型是可选项：

```dotenv
OPENAI_API_KEY=your_server_side_key
OPENAI_MODEL=gpt-5.6-terra
```

本地 GitHub 登录也是可选项。创建 OAuth App，并把本地 callback 配置为
`http://localhost:3000/api/auth/github/callback`：

```dotenv
GITHUB_CLIENT_ID=your_github_oauth_client_id
GITHUB_CLIENT_SECRET=your_github_oauth_client_secret
```

没有这两个值时，访客项目保存和其他生成能力仍可使用。

不要把 `.env.local`、`.dev.vars` 或任何密钥提交到 Git。

## 本地生产预览

先生成 Cloudflare Worker 包：

```bash
npm run build:worker
npx opennextjs-cloudflare preview
```

在另一个终端运行全栈冒烟测试：

```bash
npm run smoke
```

`smoke` 会验证首页、访客 Session、退出同源校验、匿名 workspace 隔离、生成、项目持久化、空记录保存、迭代、服务端校验、回滚和独立 ZIP 导出，并清理测试项目。

## 质量检查

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build:worker
```

当前自动测试覆盖：

- 中英文场景识别和稳定输出；
- 增量修改与记录 Schema 迁移；
- AppSpec / records / project / version 校验；
- CRUD 编译、安全转义和恶意输入拒绝；
- 独立 ZIP 结构、CSP、存储隔离和 API 返回；
- OAuth state / PKCE、Session Cookie、Token 哈希和同源校验；
- Studio 服务端渲染和标准 OpenNext 配置契约。

GitHub Actions 会在 Linux + Node.js 22 环境执行 lint、类型检查、测试和完整 Worker 构建。

## 首次 Cloudflare 部署

不要先部署再建库。正确顺序是：显式创建 D1、执行 migration、构建、最后部署。

```bash
npx wrangler login
npx wrangler d1 create chance-atoms-demo-db --binding DB --update-config
npm run db:migrate:remote
npm run build:worker
npm run deploy:worker
```

`d1 create --update-config` 会把公开的 `database_name` 和 `database_id` 写入 `wrangler.jsonc`。D1 UUID 不是密钥，可以安全提交；账号令牌和模型密钥不能提交。

后续普通部署可直接运行：

```bash
npm run deploy
```

如需在受控环境启用模型：

```bash
npx wrangler secret put OPENAI_API_KEY
```

启用 GitHub 登录：

```bash
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
```

生产 OAuth callback 必须配置为：

```text
https://chance-atoms-demo.chanceflying1.workers.dev/api/auth/github/callback
```

仓库还包含手动触发的 `Deploy to Cloudflare` workflow。配置说明见 [`.github/DEPLOYMENT.md`](.github/DEPLOYMENT.md)。工作流默认不会同步 OpenAI 密钥。

## 关键目录

- `app/components/Studio.tsx`：首页、计划、Agent 对话、版本列表和 Preview 工作台。
- `app/api/generate/route.ts`：模型适配、严格 JSON Schema 与本地降级。
- `app/api/auth/`：GitHub OAuth、Session 查询和退出登录。
- `app/api/projects/`：项目、版本、记录保存和回滚 API。
- `app/api/export/route.ts`：独立项目 ZIP 下载接口。
- `lib/deterministic-agent.ts`：无密钥情况下的可演示 Agent。
- `lib/compile-app.ts`：AppSpec 到安全可运行应用的固定编译器。
- `lib/reconcile-records.ts`：跨版本字段变化时的数据迁移。
- `lib/export-project.ts`：无依赖静态项目和 ZIP 生成器。
- `lib/validation.ts`：运行时 Spec / records 校验。
- `db/` 与 `drizzle/`：D1 数据访问、Schema 和 migrations。
- `open-next.config.ts` 与 `wrangler.jsonc`：标准 Cloudflare 运行配置。
- `scripts/smoke-http.mjs`：本地 Worker + D1 全链路冒烟测试。
- `tests/`：领域、编译器、安全、导出和渲染测试。

## API 概览

| Method | Path | 用途 |
| --- | --- | --- |
| `POST` | `/api/generate` | 从 prompt 或 refinement 生成 AppSpec |
| `GET` | `/api/auth/github` | 发起 GitHub OAuth 登录 |
| `GET` | `/api/auth/github/callback` | 校验 OAuth 回调、创建 Session 并认领访客项目 |
| `GET` | `/api/auth/session` | 查询当前登录用户 |
| `POST` | `/api/auth/logout` | 撤销当前服务端 Session |
| `GET/POST` | `/api/projects` | 查询或创建 workspace 项目 |
| `GET/PATCH/DELETE` | `/api/projects/:id` | 查询、更新或删除项目 |
| `GET/POST/PATCH` | `/api/projects/:id/versions` | 版本查询、创建、记录保存和回滚 |
| `POST` | `/api/export` | 导出独立 ZIP |

## 当前取舍与后续方向

当前版本聚焦“单实体内部工具”，把生成、运行、持久化、版本和独立导出闭环做完整。继续生产化时可以扩展：

- 多实体关系与可组合组件；
- 团队协作、企业 SSO 和细粒度权限；
- Cloudflare Rate Limiting / Turnstile 和模型预算；
- 版本 Diff、异步任务和公开分享；
- Playwright Chromium/WebKit 端到端测试。

这些扩展不会改变当前 `AppSpec → Validator → Compiler` 的安全边界。

## License

[MIT](LICENSE)
