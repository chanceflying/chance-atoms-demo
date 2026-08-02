# Chance Atoms Demo

一个可运行、可部署的 AI 创作工作台 MVP。它不是纯前端页面：React 负责工作台交互，Next.js Route Handlers 提供业务后端，Cloudflare Worker 负责在线运行，Cloudflare D1 保存账号、项目、版本和对话数据。

- 在线 Demo：[chance-atoms-demo.chanceflying1.workers.dev](https://chance-atoms-demo.chanceflying1.workers.dev)
- GitHub：[chanceflying/chance-atoms-demo](https://github.com/chanceflying/chance-atoms-demo)
- 项目设计、架构与取舍：[PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md)
- Cloudflare 部署细节：[.github/DEPLOYMENT.md](.github/DEPLOYMENT.md)

## 项目能做什么

Chance Atoms 统一管理两类项目。

### Web App 构建

- 用自然语言创建游戏、交互页面或其他单页 Web App；
- 首次输入会立即生成简短项目标题，详情页可手动改名；
- 模型先生成结构化 BuildPlan，不直接开始写代码；
- 用户可以继续调整当前方案，确认后才进入构建；
- 生成完整、自包含的 HTML/CSS/JavaScript，并在 sandbox iframe 中运行；
- 右侧支持“预览 / 代码 / 生成详情”；
- 可以继续用自然语言修改，生成 v1、v2、v3 等不可变版本；
- 历史版本可查看、恢复为新的最新版本，并导出独立 ZIP；
- 规划和构建过程中可以离开当前页面，结果仍归属原项目；
- 正在生成 BuildPlan 或构建时，非当前版本会被锁定，任务完成后恢复切换。

贪吃蛇、俄罗斯方块和扫雷只是首页示例 Prompt，不是写死的模板。

### 对话与长期记忆

- 每个对话都是独立项目，有自己的标题、历史和更新时间；
- 用户消息先保存，再请求模型；回复完成后继续保存模型消息；
- 切换页面时回复可以在后台继续，不同对话项目可以独立发起任务；
- 当前浏览器会话内，同一个对话只允许一个回复任务，避免上下文顺序错乱；
- 用户可以显式开启、关闭和编辑项目级长期记忆；
- 重新打开项目后可以继续此前对话；
- 支持删除项目及其消息历史。

“长期记忆”是用户可见、可编辑的文本配置，不包含自动画像、Embedding、向量检索或跨项目 RAG。

### 统一输入与操作反馈

- 首页、对话详情和 Web App 构建详情使用一致的输入提示：`输入消息，Enter 发送，Shift + Enter 换行…`；
- 三个输入区域都支持 `Enter` 提交、`Shift + Enter` 换行，鼠标和键盘操作语义一致；
- 首页根据当前能力显示完整的黑色主按钮：“开始对话”或“开始构建”；
- 对话详情和 Web App 构建详情统一使用“发送”按钮，不再只用箭头表达操作；
- 模型来源、版本摘要、构建说明与产物信息使用更清晰的字号和层级，便于演示时快速识别当前状态。

### 项目与账号

- 访客无需注册即可创建项目；
- 首页侧栏展示按最近操作时间排序的 5 个项目；
- “我的项目”支持全部、对话、Web App 分类筛选；
- 首页、项目页和两类详情页使用独立 URL，刷新后仍停留在当前页面；
- Chat 和 Web App 共用改名、删除、排序和 workspace 归属；
- GitHub OAuth 登录后会认领当前访客项目，并可在其他设备登录后继续使用；
- GitHub 只用于身份登录，不会创建仓库、提交代码或申请仓库写权限。

## 当前演示边界

当前线上 Worker 已配置 GitHub OAuth。模型入口按以下顺序选择：

- 在线页面、登录、项目、历史版本、对话历史和长期记忆可以直接访问；
- 配置 <code>OPENAI_API_KEY</code> 时，Worker 直接调用 OpenAI；
- 没有 API Key、但配置了 <code>REMOTE_CODEX_BRIDGE_URL/TOKEN</code> 时，Worker 通过 HTTPS Tunnel 调用 Mac Codex Bridge；默认使用 Bearer，本次 localhost.run 演示额外启用 E2EE；
- 两种服务端 Provider 都没有配置时，浏览器才回退同一台电脑上的 localhost Bridge。

当前生成范围是自包含前端 Web App，不包含：

- 独立后端、数据库 Schema 或第三方服务部署；
- npm 依赖和多文件工程；
- 生成应用内部的游戏进度、分数或业务数据持久化；
- 服务端持久任务队列、跨刷新继续运行和跨设备任务状态；
- 多标签页或多设备对同一项目的并发协调；
- 版本 Diff、分支与合并；
- 生产级限流、计费、内容审核和生成代码安全扫描。

平台保存的是“如何生成并演进项目”，不是“用户在生成应用里做过什么”。

## 技术架构

~~~mermaid
flowchart LR
    B["Browser / React Studio"]
    E["Cloudflare Edge"]
    A["Static Assets"]
    W["Cloudflare Worker<br/>OpenNext + Next.js Route Handlers"]
    D["Cloudflare D1"]
    O["OpenAI Responses API"]
    R["Remote Mac Codex Bridge<br/>HTTPS + Bearer / E2EE"]
    L["Browser-local Codex Bridge"]
    X["codex exec"]
    I["sandbox iframe"]

    B -->|"pages and same-origin /api/*"| E
    E --> A
    E --> W
    W --> D
    W -->|"OPENAI_API_KEY configured"| O
    W -->|"otherwise REMOTE_CODEX_*"| R
    B -->|"only when neither server Provider exists"| L
    R --> X
    L --> X
    B --> I
~~~

| 层级 | 技术 | 职责 |
| --- | --- | --- |
| 前端 | React 19、TypeScript、自定义 CSS | 首页、项目管理、规划交互、对话、版本和 Preview |
| 全栈框架 | Next.js 16 App Router | 页面渲染与 Route Handlers 业务 API |
| 部署适配 | OpenNext for Cloudflare | 把标准 Next.js 构建转换为 Worker 包 |
| 在线运行 | Cloudflare Worker + Assets | 运行服务端逻辑并托管静态资源 |
| 数据 | Cloudflare D1 + Drizzle migrations | 用户、Session、项目、版本、消息和记忆 |
| 模型 | OpenAI Responses API / 远程或本机 Codex Bridge | 规划、生成和对话 |
| 产物运行 | sandbox iframe | 隔离运行模型生成的单文件 Web App |

一句话解释 Cloudflare：

> Next.js/React 是应用框架；Cloudflare 提供 Worker 运行环境、静态资源托管和 D1 数据库。

## 本地运行

### 1. 环境要求

- Node.js <code>&gt;= 22.13.0</code>
- npm
- 可选：已登录的 Codex CLI，或 OpenAI API Key
- 可选：GitHub OAuth App

### 2. 安装与初始化

~~~bash
git clone https://github.com/chanceflying/chance-atoms-demo.git
cd chance-atoms-demo
npm ci
cp .env.example .env.local
npm run db:migrate:local
npm run dev
~~~

打开 [http://localhost:3000](http://localhost:3000)。

<code>next dev</code> 会通过 OpenNext 的开发适配读取 Wrangler 配置和本地 D1 binding。首次运行以及新增 migration 后，都需要执行一次 <code>npm run db:migrate:local</code>。

## 接入模型

### 方式 A：服务端 OpenAI API Key

在 <code>.env.local</code> 中配置：

~~~dotenv
OPENAI_API_KEY=your_server_side_key
OPENAI_MODEL=gpt-5.6-terra
~~~

规划、生成和对话会通过同源的 <code>/api/plan</code>、<code>/api/generate</code> 和 <code>/api/chat</code> 调用 OpenAI Responses API。

### 方式 B：线上 Worker 访问 Mac Codex Bridge

没有 API Key 时，可让线上 Worker 通过 HTTPS Tunnel 调用 Mac 上已登录的 Codex CLI。通用模式是 HTTPS + Bearer；本次因公司安全软件拦截 <code>cloudflared</code>，经用户授权改用 localhost.run，并强制设置 <code>REMOTE_CODEX_BRIDGE_E2EE=1</code>。这只是临时演示链路，不是生产安全方案。

1. 在 Mac 生成随机 Token，确认 Codex 登录，然后启动 Bridge：

~~~bash
openssl rand -hex 32
codex login status
CODEX_BRIDGE_PORT=4317 CODEX_BRIDGE_TOKEN="<上一步生成的-token>" npm run model:bridge
~~~

Bridge 默认端口是 <code>4317</code>；本次面试因旧进程占用该端口，实际使用 <code>CODEX_BRIDGE_PORT=4318</code>。Tunnel 命令中的本地端口必须保持一致。

2. 在另一个终端启动 localhost.run，并记录输出的临时 HTTPS URL：

~~~bash
ssh -R 80:localhost:4317 nokey@localhost.run
~~~

3. 把 Tunnel 地址、同一个 Token 和 E2EE 开关配置为 Worker Secret：

~~~bash
npx wrangler secret put REMOTE_CODEX_BRIDGE_URL
npx wrangler secret put REMOTE_CODEX_BRIDGE_TOKEN
npx wrangler secret put REMOTE_CODEX_BRIDGE_E2EE  # 输入 1
~~~

E2EE 模式下，Worker 与 Bridge 用共享 Token 派生 AES-256-GCM 密钥；Token 不放入 Authorization Header，Prompt 和回复以密文信封经过 Tunnel。Tunnel 仍能看到连接元数据，因此这不能替代正式的网络隔离、密钥管理和安全评审。

临时 Tunnel 重启后 URL 可能变化。恢复演示时重新启动 Bridge/SSH Tunnel，并更新 <code>REMOTE_CODEX_BRIDGE_URL</code>；Token 轮换时同步更新两端，无需重新部署代码。面试结束后按 <code>Ctrl+C</code> 关闭 Bridge 和 SSH Tunnel，并删除临时 Worker Secret：

~~~bash
npx wrangler secret delete REMOTE_CODEX_BRIDGE_URL
npx wrangler secret delete REMOTE_CODEX_BRIDGE_TOKEN
npx wrangler secret delete REMOTE_CODEX_BRIDGE_E2EE
~~~

### 方式 C：浏览器本机 Codex Bridge

服务端既没有 API Key，也没有 Remote Bridge 配置时，可以在访问页面的同一台电脑上复用已有 ChatGPT/Codex 登录：

~~~bash
codex login status
npm run model:bridge
~~~

Bridge 默认监听 <code>127.0.0.1:4317</code>，提供：

| Method | Path | 用途 |
| --- | --- | --- |
| GET | <code>/health</code> | 检查 Bridge 状态 |
| POST | <code>/plan</code> | 生成或调整 BuildPlan |
| POST | <code>/generate</code> | 生成 WebAppArtifact |
| POST | <code>/chat</code> | 生成对话回复 |

浏览器始终先请求同源服务端。只有服务端明确返回 <code>503 + OPENAI_NOT_CONFIGURED</code>，前端才访问 localhost Bridge；已经选中的 OpenAI 或 Remote Bridge 调用失败时，不会静默切换 Provider。

本机 Bridge 使用串行队列执行 Codex CLI 任务。UI 可以切换项目或发起不同任务，但本机模型会依次完成。

明确优先级：<code>OPENAI_API_KEY</code> &gt; <code>REMOTE_CODEX_BRIDGE_URL/TOKEN</code> &gt; 浏览器 localhost Bridge。若要验证 Remote Bridge，请不要同时配置 <code>OPENAI_API_KEY</code>。

## 配置 GitHub 登录

创建 GitHub OAuth App，本地 callback 设置为：

~~~text
http://localhost:3000/api/auth/github/callback
~~~

在 <code>.env.local</code> 中配置：

~~~dotenv
GITHUB_CLIENT_ID=your_github_oauth_client_id
GITHUB_CLIENT_SECRET=your_github_oauth_client_secret
~~~

未配置 GitHub OAuth 时，访客 workspace、项目和版本仍可正常使用。

GitHub OAuth App 只有一个 callback 配置。若本地与线上都要登录，建议分别创建开发和生产两个 OAuth App。

## 部署到 Cloudflare

### 首次部署

登录 Cloudflare，并为自己的 fork 创建 D1：

~~~bash
npx wrangler login
npx wrangler d1 create chance-atoms-demo-db
~~~

把命令返回的 <code>database_id</code> 替换到 <code>wrangler.jsonc</code> 现有的 <code>d1_databases[0]</code> 中，保留 binding 名 <code>DB</code>，再执行：

~~~bash
npm run db:migrate:remote
~~~

不要在当前配置上使用 <code>--update-config</code>，否则可能追加第二个同名 <code>DB</code> binding。只有原部署账号的维护者继续使用现有 Cloudflare 项目时，才能跳过创建和替换；其他 fork 必须创建自己的 D1。

如果 fork 后修改 Worker 名称，还需要同时修改 <code>wrangler.jsonc</code> 的 <code>name</code> 与 <code>WORKER_SELF_REFERENCE.service</code>。

配置生产 GitHub OAuth：

~~~bash
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
~~~

生产 callback 应使用实际部署域名：

~~~text
https://<your-worker>.<your-subdomain>.workers.dev/api/auth/github/callback
~~~

当前 Demo 对应 <code>https://chance-atoms-demo.chanceflying1.workers.dev/api/auth/github/callback</code>。

如需启用线上真实模型：

~~~bash
npx wrangler secret put OPENAI_API_KEY
~~~

<code>OPENAI_MODEL</code> 可选；未配置时使用代码中的默认模型。如需覆盖，再执行 <code>npx wrangler secret put OPENAI_MODEL</code>。

没有 API Key 时，也可按“[方式 B](#方式-b线上-worker-访问-mac-codex-bridge)”配置临时 Remote Codex Bridge。

构建并部署：

~~~bash
npm run build:worker
npm run deploy:worker
~~~

后续没有 migration 时可以直接：

~~~bash
npm run deploy
~~~

### GitHub Actions 部署

仓库包含两个工作流：

- <code>CI</code>：执行 lint、typecheck、test 和 Worker build；
- <code>Deploy to Cloudflare</code>：手动触发，可选择先应用 D1 migration，并部署已构建的 Worker。

需要在 GitHub 创建 <code>production</code> Environment，并配置：

- <code>CLOUDFLARE_API_TOKEN</code>
- <code>CLOUDFLARE_ACCOUNT_ID</code>
- 可选：<code>OPENAI_API_KEY</code>

手动运行部署工作流时，只有勾选 <code>sync_openai_secret</code> 才会把 GitHub 中的 <code>OPENAI_API_KEY</code> 同步到 Worker；默认不会覆盖 Cloudflare 已有 Secret。

完整步骤和 Secret 边界见 [.github/DEPLOYMENT.md](.github/DEPLOYMENT.md)。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| <code>npm run dev</code> | 启动 Next.js 开发环境 |
| <code>npm run model:bridge</code> | 启动本机 Codex Bridge |
| <code>npm run db:migrate:local</code> | 应用本地 D1 migration |
| <code>npm run db:migrate:remote</code> | 应用线上 D1 migration |
| <code>npm run lint</code> | ESLint 检查 |
| <code>npm exec tsc -- --noEmit</code> | TypeScript 检查 |
| <code>npm test</code> | 运行 60 项自动测试 |
| <code>npm run build</code> | 构建标准 Next.js 应用 |
| <code>npm run build:worker</code> | 构建 Cloudflare Worker bundle |
| <code>npm run preview</code> | 本地预览 Worker bundle |
| <code>npm run smoke</code> | 验证已启动的 Worker Preview + D1 主链路 |
| <code>npm run deploy</code> | 构建并部署到 Cloudflare |

## 质量验证

当前自动测试覆盖：

- GitHub OAuth state、PKCE、Session hash 和访客项目认领；
- D1 项目、版本、对话和长期记忆序列化；
- BuildPlan 与 WebAppArtifact 运行时契约；
- 模型路由、Provider 优先级、远程 Bridge Bearer/E2EE 和本机 Bridge 回退条件；
- 项目标题摘要与手动改名相关静态约束；
- 版本锁定/恢复交互的静态约束、导出和生成 HTML 安全编码；
- Next.js 页面渲染、路由和 OpenNext 配置。

Worker HTTP smoke 另外验证 workspace 隔离、项目 CRUD、版本创建与恢复 API、导出、对话与记忆持久化。Smoke 使用固定测试 Artifact，不调用收费模型。

先在一个终端运行 <code>npm run preview</code>，再在另一个终端运行 <code>npm run smoke</code>。验证已部署地址时，可以设置 <code>CHANCE_ATOMS_BASE_URL=https://your-worker-domain</code>。

## 关键目录

| 路径 | 说明 |
| --- | --- |
| [app/components/Studio.tsx](app/components/Studio.tsx) | 双能力工作台和浏览器会话内任务状态 |
| [app/api](app/api) | 认证、项目、版本、对话、模型和导出 API |
| [lib](lib) | 领域类型、运行时校验、标题摘要、编译和导出 |
| [db](db) | D1 访问、身份解析、Schema 和序列化 |
| [drizzle](drizzle) | D1 migrations |
| [scripts/codex-session-bridge.mjs](scripts/codex-session-bridge.mjs) | 本机 Codex 订阅桥接 |
| [scripts/smoke-http.mjs](scripts/smoke-http.mjs) | Worker + D1 冒烟测试 |
| [tests](tests) | 自动测试 |
| [.github/workflows](.github/workflows) | CI 与 Cloudflare 部署工作流 |

## License

[MIT](LICENSE)
