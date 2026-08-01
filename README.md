# Chance Atoms Demo · Forge

> 一个可以公开部署、完整运行并继续迭代的 AI 应用生成 Demo。

Forge 是 Demo 内的产品名，`chance-atoms-demo` 是仓库、Cloudflare Worker 和交付项目名。用户用自然语言描述需求，先审阅执行计划，再生成一个可直接运行、持久保存、继续修改和回滚的应用。当前同时支持声明式 CRUD 数据应用和模型生成的单文件 Web App（例如贪吃蛇）。

## 在线体验与源码

- 在线 Demo：[https://chance-atoms-demo.chanceflying1.workers.dev](https://chance-atoms-demo.chanceflying1.workers.dev)
- GitHub 源码：[https://github.com/chanceflying/chance-atoms-demo](https://github.com/chanceflying/chance-atoms-demo)

模型路由优先级固定为：

1. 线上 Worker 配置了 `OPENAI_API_KEY` 时，优先使用服务端 OpenAI Responses API；
2. 线上没有密钥且当前浏览器运行在用户本机时，Web App 模式回退到 `127.0.0.1:4317` 的 Codex Bridge，复用本机已登录的 ChatGPT/Codex 订阅；
3. 两种真实模型均不可用时，Web App 明确提示错误；CRUD 模式仍可使用仓库内的确定性 Agent 演示。

ChatGPT/Codex 登录凭证不会上传到 Cloudflare，Bridge 只把生成后的 `WebAppArtifact` 返回给页面。

## 核心体验

1. 输入需求，或选择“客户线索看板 / 内容发布日历 / 设备巡检台”模板。
2. Forge 先生成四步计划，只有用户确认后才开始构建。
3. 数据应用生成声明式 `AppSpec` 并由固定编译器生成；Web App 生成自包含的 `WebAppArtifact`（内联 HTML/CSS/JavaScript）。
4. 在 Preview 中新增、编辑、删除、搜索和筛选记录，数据自动保存到 D1。
5. 用自然语言继续调整字段、布局或主题；每次调整创建一个新版本。
6. 历史版本只读，可复制恢复成新的当前版本，不覆盖后续历史。
7. 点击“导出项目”，下载一个无依赖 ZIP；其中的 `index.html` 可独立部署。
8. 访客项目直接保存到 D1；使用 GitHub 登录后会自动认领当前项目，并支持跨浏览器、跨设备找回。

完整链路：

```text
Prompt → Plan approval → Provider routing
       ├─ CRUD → AppSpec → Validator → deterministic compiler
       └─ Web App → WebAppArtifact → sandboxed srcDoc preview
       → D1 persistence → Refine / Rollback / Export
```

## 与笔试要求的对应关系

| 要求 | 当前实现 |
| --- | --- |
| 自然语言生成应用 | `/api/generate` 优先 OpenAI；无线上密钥时，浏览器按明确错误码回退本机 Codex Bridge |
| 过程可理解、可控制 | 生成前展示四步 Plan，必须由用户明确确认 |
| 结果真正可运行 | CRUD 使用固定编译器；Web App 直接运行模型生成的完整单文件应用，均放入 sandbox iframe |
| 支持持续修改 | 基于当前 Spec 的 refinement，每次形成独立版本 |
| 数据不是静态展示 | iframe 通过 `postMessage` 回传 CRUD 变化，Next.js API 写入 D1 |
| 访客试用与账号同步 | 匿名 workspace 免登录保存；GitHub OAuth 登录后迁移到账号 workspace |
| 可恢复、可追溯 | 项目与版本快照持久化；Rollback 复制成新版本 |
| 可独立交付 | 两类应用都可导出无依赖 ZIP；仓库本身也可标准部署到 Cloudflare |
| 稳定演示 | CRUD 保留无密钥 Agent；Web App 不伪装降级，真实模型不可用时明确提示 |

## 技术架构

这是一个单仓库全栈项目，不是纯前端应用。

```text
Browser
  └─ Next.js / React Studio
      ├─ POST /api/generate
      │   ├─ OpenAI Responses API（第一优先级，服务端调用）
      │   └─ Deterministic Agent（仅 CRUD 无密钥演示）
      ├─ 503 OPENAI_NOT_CONFIGURED
      │   └─ Browser → 127.0.0.1 Codex Bridge → codex exec
      │                                           └─ 本机 ChatGPT 订阅会话
      ├─ AppSpec compiler / WebAppArtifact runtime
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
- **本机 Codex Bridge（可选）**：只监听 `127.0.0.1`，通过 `codex exec` 复用本机 Codex 登录；Cloudflare 只收到最终项目产物。
- **Provider 路由**：线上 API Key 优先；只有服务端明确返回 `OPENAI_NOT_CONFIGURED` 时，浏览器才请求本机 Bridge。

换句话说，Cloudflare 在这里负责“运行与存储”，Next.js/React 才是前后端应用框架。

## Demo 边界

CRUD 模式仍维持原有的声明式安全边界；Web App 模式为了验证真实代码生成，会在 sandbox iframe 中执行模型生成的 JavaScript。

- `AppSpec`、`WebAppArtifact` 和记录都经过基础运行时结构校验。
- 编译器固定在仓库内，不使用 `eval` 或 `new Function`。
- CRUD Preview 使用 CSP、JSON 安全转义和 `textContent`；两种 Preview 都保留 iframe sandbox。
- 历史版本禁止直接编辑；恢复会创建新版本。
- 新 Spec 会迁移兼容记录，删除过的字段不会让下一版崩溃。
- 写接口限制 JSON 请求体大小，并在服务端再次校验 `spec + records`。
- 导出 ZIP 限制文件名、路径、文件数和总大小，不包含任何密钥。
- 访客 workspace 由 `HttpOnly + SameSite=Lax` 匿名 Cookie 隔离。
- GitHub OAuth 使用随机 `state`、PKCE 和服务端 Client Secret；不请求仓库或邮箱权限。
- 登录 Session 使用随机 Token；浏览器只保存 `HttpOnly` Cookie，D1 只保存 SHA-256 哈希。
- 所有项目归属都在服务端解析，前端不能通过提交 `userId` 越权访问。

Web App 导出后将脱离 Studio iframe，公开发布前应自行审阅生成代码。

这是笔试 Demo，当前迭代优先证明“真实模型 → 可运行应用 → 保存/版本/导出”的完整链路。团队权限、企业 SSO、生成代码扫描、独立预览域、Prompt Injection 防护、内容审核、Rate Limiting、Turnstile、模型额度、流式进度、取消任务、多文件编辑器、代码 Diff、自动修复循环和精细错误体验均暂缓实现。

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

### 使用 ChatGPT/Codex 订阅生成 Web App

不需要 API Key。先确认本机 Codex 已通过 ChatGPT 登录，然后启动 Bridge：

```bash
codex login status
npm run model:bridge
```

保持这个终端运行，再打开线上 Demo：

```text
https://chance-atoms-demo.chanceflying1.workers.dev
```

输入“构造一个贪吃蛇前端应用”并确认构建。页面会先请求线上 `/api/generate`；线上没有 API Key 时才自动调用本机 Bridge。生成结果随后照常保存到线上 D1，刷新页面后仍可找回。

Bridge 需要本机已安装 `codex` CLI，默认监听 `http://127.0.0.1:4317`。它不会读取或上传 `auth.json`，而是让 Codex CLI 自己复用已保存的登录状态。

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
- `app/api/generate/route.ts`：线上 OpenAI 优先路由、严格 JSON Schema 与 CRUD 本地降级。
- `scripts/codex-session-bridge.mjs`：浏览器可访问的本机 Codex 订阅桥接。
- `scripts/web-app-artifact.schema.json`：Codex 结构化输出 Schema。
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
| `POST` | `/api/generate` | 从 prompt 或 refinement 生成 AppSpec / WebAppArtifact；线上 OpenAI 优先 |
| `GET` | `/api/auth/github` | 发起 GitHub OAuth 登录 |
| `GET` | `/api/auth/github/callback` | 校验 OAuth 回调、创建 Session 并认领访客项目 |
| `GET` | `/api/auth/session` | 查询当前登录用户 |
| `POST` | `/api/auth/logout` | 撤销当前服务端 Session |
| `GET/POST` | `/api/projects` | 查询或创建 workspace 项目 |
| `GET/PATCH/DELETE` | `/api/projects/:id` | 查询、更新或删除项目 |
| `GET/POST/PATCH` | `/api/projects/:id/versions` | 版本查询、创建、记录保存和回滚 |
| `POST` | `/api/export` | 导出独立 ZIP |

## 当前取舍与后续方向

当前版本聚焦把生成、运行、持久化、版本和独立导出闭环做完整。继续生产化时可以扩展：

- 多实体关系与可组合组件；
- 团队协作、企业 SSO 和细粒度权限；
- Cloudflare Rate Limiting / Turnstile 和模型预算；
- 版本 Diff、异步任务和公开分享；
- Playwright Chromium/WebKit 端到端测试；
- 生成代码静态扫描、外部资源白名单与独立预览域；
- 流式输出、取消/重试、自动修复和多文件工程生成；
- 本机 Bridge 的配对授权、健康状态 UI 与多任务队列。

CRUD 会继续保留 `AppSpec → Validator → Compiler` 边界；Web App 则逐步补齐生成代码的审查和隔离能力。

## License

[MIT](LICENSE)
