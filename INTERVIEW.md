# Chance Atoms Demo：面试说明

## 1. 文档定位

这份文档用于解释项目为什么这样做、后端在哪里、Cloudflare 起什么作用、当前完成到什么程度，以及如果继续投入应该先做什么。

需要先区分两个范围：

- **原始 6–8 小时时间盒**：目标是证明“自然语言生成可运行 Web App”的主闭环；
- **当前仓库版本**：在首版基线上继续迭代，补充了 GitHub 登录、D1 持久化、项目管理、后台切换、版本恢复、对话和显式长期记忆。

面试时不要把当前全部功能都描述成 6–8 小时一次完成。更准确的说法是：

> 我先在时间盒内完成纵向主链路，再根据可用性问题逐步补齐平台能力；当前仓库是最终整理后的演示版本。

### 快速导航

- [90 秒面试口径](#3-90-秒面试口径)
- [当前功能介绍](#5-当前功能介绍)
- [推荐演示流程](#6-推荐演示流程)
- [技术实现架构](#7-技术实现架构)
- [实现思路与关键取舍](#13-实现思路与关键取舍)
- [当前完成程度](#14-当前完成程度)
- [后续扩展与优先级](#16-如果继续投入时间)
- [面试评估维度复盘](#17-按面试评估维度复盘)
- [面试官可能追问](#18-面试官可能追问)

## 2. 一句话定位

> Chance Atoms 是一个 Next.js 单仓全栈 AI 工作台。Web App 模式采用“先规划、可调整、确认后生成”的两阶段流程，并通过不可变版本支持持续演进；对话模式保存历史并提供用户显式控制的长期记忆。React 负责前端交互，Next.js Route Handlers 是业务后端，Cloudflare Worker 和 D1 负责在线运行与持久化。

它不是纯前端，也不是通用 AI IDE。

## 3. 90 秒面试口径

> 我没有在 6–8 小时里复刻一个通用 AI IDE，而是先把题目收敛成一个可验收问题：用户能不能用自然语言得到一个真的可运行、可以继续修改、过程可追溯的 Web App。
>
> 技术上这是一个 Next.js 单仓全栈应用。React 负责工作台，Next.js Route Handlers 是后端，部署后运行在 Cloudflare Worker，D1 保存用户、项目、版本和对话。Cloudflare 在这里主要提供运行环境、静态托管和数据库，业务框架仍然是 Next.js。
>
> Web App 模式没有让模型直接吐代码，而是拆成 Plan 和 Generate 两阶段。模型先返回严格结构化的 BuildPlan，用户可以继续调整，确认后再生成一个自包含的 index.html。这个文件直接在 sandbox iframe 中运行，也进入版本快照和 ZIP 导出。每次修改都会创建新版本，恢复历史版本也会创建新的最新版本，不覆盖历史。
>
> 对话模式保存消息历史和用户显式配置的长期记忆。为了避免用户等待模型时被锁在一个页面里，我把任务状态按项目隔离：当前浏览器内，不同对话可以后台运行，Chat 和 Web 构建可以同时进行；请求 ID、workspace epoch 和 project ID 用来阻止慢响应写错项目。
>
> 最大的取舍是只支持自包含前端 Web App，不做多文件工程和生成后端。这样才能在面试时间盒内把规划、生成、预览、版本、登录、持久化和部署做成完整闭环。当前限制也明确：后台任务不是服务端持久队列，Preview 不是生产级代码沙箱，验收标准还没有自动执行。

## 4. 我如何理解原始任务

“做一个类似 Atoms 的 Demo”范围很容易失控。可能的方向包括：

- 通用聊天；
- 在线 IDE；
- 多 Agent 编排；
- 多文件代码生成；
- 构建容器；
- 数据库与后端生成；
- 模板市场；
- 协作与分享。

如果平均分配时间，最后很可能每个方向都只有静态页面。因此我把核心验收目标定义为：

> 用户输入一个 Web App 需求，系统先给出可审阅方案，用户确认后生成可运行产物；用户还能继续修改，并知道每次结果来自哪一轮需求。

这个定义同时覆盖五类评估维度：

| 评估维度 | 对应设计 |
| --- | --- |
| 完成度 | Prompt 到可运行 Preview 的纵向闭环 |
| 工程思维 | 结构化契约、状态边界、版本和数据模型 |
| 用户体验 | 先规划再生成、可调整方案、后台切换 |
| 创新性 | 可审阅 BuildPlan、不可变演进、显式记忆 |
| 可交付性 | 在线地址、GitHub、D1、CI、部署和文档 |

## 5. 当前功能介绍

### 5.1 首页与项目管理

- 首页默认进入“对话”，也可以切换到“Web App 构建”；
- 两种能力的输入草稿互不共享；
- 首页包含示例输入和功能引导；
- 左侧展示按最后操作时间排序的最近 5 个项目；
- 首页、我的项目、对话详情和 Web App 详情使用独立 URL；
- “我的项目”支持全部、对话、Web App 筛选；
- 两类项目都支持自动标题、手动改名和删除；
- 项目删除时，对话消息或版本历史会级联清理；
- 运行中的任务不会阻止用户查看其他项目或发起新的对话。

项目标题不是简单复制第一条输入：

1. 首次输入先通过确定性规则提取短标题；
2. 模糊输入回退为“新对话”或“新 Web App”；
3. 用户可以在详情页手动改名；
4. 改名后，旧列表请求和后台构建结果不会覆盖用户名称。

这里使用确定性摘要而不是额外模型调用，是为了让项目创建立即完成、可测试，并避免标题依赖模型延迟。人工改名是最终兜底。

### 5.2 Web App 构建

主流程：

~~~text
首次输入
→ 先创建 currentVersion=0 的项目草稿
→ 模型生成 BuildPlan
→ 用户查看或继续调整方案
→ 用户确认
→ 模型生成 WebAppArtifact
→ sandbox iframe 运行
→ D1 保存 v1
→ 用户提出修改
→ 新 BuildPlan
→ D1 保存 v2 / v3
~~~

当前能力包括：

- 新建和修改都先生成 BuildPlan；
- BuildPlan 展示需求摘要、设计决策、交互流程、实现步骤、假设和验收标准；
- 用户可以基于当前方案继续反馈，不是只有“确认 / 取消”；
- 确认后才进入代码生成；
- 生成完整、自包含的单文件 HTML；
- 支持预览、代码和生成详情；
- 对话区域与预览区域宽度可调；
- Preview 自动缩放到桌面可视区域；
- 生成结果可导出为独立 ZIP；
- 每次修改形成新的不可变版本；
- 历史版本可恢复为新的最新版本；
- 版本迭代完成消息会总结用户本次实际诉求；
- 生成 BuildPlan 和正式构建期间，非当前版本被锁定，完成后恢复切换。

### 5.3 对话与长期记忆

- 对话不是首页的一次性问答，而是独立项目；
- 用户消息先写入 D1，再请求模型；
- 模型回复完成后单独写入 D1；
- 重新打开项目后恢复消息历史；
- 模型失败时保留用户问题，当前浏览器中可以继续重试；
- 每个项目可以独立配置长期记忆；
- 记忆只有在开启时才进入模型上下文；
- 最近最多 40 条历史进入模型；
- 当前浏览器内，不同对话可以独立发起回复任务；
- 当前浏览器内，同一个对话禁止并行发送，保证上下文顺序；
- 多标签页或多设备暂时没有服务端并发锁。

当前记忆是“用户显式维护的项目级上下文”，不是自动记忆系统。它没有自动提取、向量检索、跨项目共享或冲突合并。

### 5.4 版本管理

每个 Web App 版本保存完整快照：

- 原始 Prompt；
- 本次修改指令；
- BuildPlan；
- reasoning summary；
- WebAppArtifact；
- Provider 和模型；
- 构建阶段与时间。

版本规则：

- 首次生成创建 v1；
- 每次修改创建 v2、v3；
- 历史版本不能被覆盖；
- 恢复 v1 会复制完整快照并创建新的最新版本；
- 当前选中版本可以独立导出；
- 正在规划或构建时锁定非当前版本，避免工作上下文发生变化。

### 5.5 访客与 GitHub 登录

- 未登录用户通过 HttpOnly Cookie 获得匿名 workspace；
- 访客可以先创建和保存项目；
- GitHub OAuth 使用 state + PKCE；
- GitHub 登录不申请仓库 Scope，只读取公共身份；
- GitHub Access Token 不保存到数据库；
- Session 在 D1 中只保存 Token Hash；
- 登录成功后认领当前访客 workspace 的项目；
- 账号项目可以跨设备访问；
- 退出后切回新的访客 workspace。

GitHub 登录只负责身份与项目归属，不等于 GitHub 仓库同步。

## 6. 推荐演示流程

### 6.1 5 分钟演示

1. 打开首页，说明“对话”和“Web App 构建”是两类独立项目；
2. 输入“生成一个支持键盘操作、计分和重新开始的俄罗斯方块”；
3. 展示系统先创建项目草稿，再生成 BuildPlan；
4. 输入“增加触屏控制，并让第一版更简洁”，展示方案可以继续调整；
5. 确认方案，等待生成 Web App；
6. 在 Preview 中实际操作应用，并切换“代码 / 生成详情”；
7. 输入“增加下一个方块预览”，生成新版本；
8. 展示版本历史、恢复为新版本和 ZIP 导出；
9. 在任务运行时返回首页，打开另一个项目，说明后台结果仍归属原项目；
10. 创建对话项目，配置长期记忆，等待回复保存后刷新或重新打开；
11. 展示 GitHub 登录后的项目归属与跨设备能力。

### 6.2 没有线上 API Key 时

演示前在本机执行：

~~~bash
codex login status
npm run model:bridge
~~~

然后可以打开本地页面，也可以从同一台电脑打开线上 Demo。浏览器收到 Worker 的 <code>OPENAI_NOT_CONFIGURED</code> 后，会访问本机 <code>127.0.0.1:4317</code>。

必须主动说明：

> 本机 Bridge 是当前没有 API Key 时的真实模型验证入口，不是生产后端。Cloudflare 不接收我的 ChatGPT 会话凭证。

## 7. 技术实现架构

~~~mermaid
flowchart TD
    Browser["Browser"]
    Studio["React Studio"]
    Edge["Cloudflare Edge"]
    Worker["Cloudflare Worker<br/>OpenNext + Next.js Route Handlers"]
    Assets["Cloudflare Assets"]
    D1["Cloudflare D1"]
    Github["GitHub OAuth"]
    OpenAI["OpenAI Responses API"]
    Bridge["Local Codex Bridge"]
    Codex["codex exec + local login"]
    Preview["sandbox iframe"]

    Browser --> Studio
    Studio -->|"pages and same-origin API"| Edge
    Edge --> Assets
    Edge --> Worker
    Worker --> D1
    Worker --> Github
    Worker -->|"OPENAI_API_KEY configured"| OpenAI
    Studio -->|"only on OPENAI_NOT_CONFIGURED"| Bridge
    Bridge --> Codex
    Studio --> Preview
~~~

### 7.1 框架和基础设施怎么区分

| 层级 | 当前技术 | 作用 |
| --- | --- | --- |
| 前端 | React 19、TypeScript、自定义 CSS | 页面、交互、任务状态和 Preview |
| 全栈框架 | Next.js 16 App Router | 页面与 Route Handlers |
| 后端 | <code>app/api/**/route.ts</code> | 认证、数据、模型、版本、对话和导出 |
| 部署适配 | OpenNext for Cloudflare | 把标准 Next.js 构建转换为 Worker bundle |
| 运行环境 | Cloudflare Worker | 运行 Next.js 服务端逻辑 |
| 静态资源 | Cloudflare Assets | 托管浏览器资源 |
| 数据库 | Cloudflare D1 | 持久化关系数据 |
| 数据定义 | Drizzle Schema + migration | 管理 Schema 和版本化迁移 |
| 模型 | OpenAI Responses API / Codex Bridge | 规划、生成与对话 |
| 产物运行 | sandbox iframe | 隔离运行生成 HTML |

后端在哪里？

> Next.js Route Handlers 就是后端。Cloudflare Worker 是这套后端的线上运行环境，D1 是数据库。

Cloudflare 起什么作用？

> Cloudflare 不负责定义业务框架。它负责托管 Worker、静态资源和 D1，让单仓 Next.js 应用可以在线运行。

### 7.2 部署链路

~~~text
GitHub 源码
→ npm ci
→ lint + typecheck + test
→ Next.js build
→ OpenNext 转换
→ .open-next/worker.js + Assets
→ Wrangler 部署
→ Worker 绑定 D1
~~~

当前没有独立 Node 服务器、Kubernetes、Redis、Kafka、Durable Object 或单独的前后端仓库。这是时间盒内主动减少服务治理复杂度的选择。

## 8. 核心领域契约

### 8.1 BuildPlan

~~~ts
interface BuildPlan {
  schemaVersion: 1;
  kind: "web_app_plan";
  title: string;
  requestSummary: string;
  designDecisions: string[];
  interactionFlow: string[];
  implementationSteps: Array<{
    title: string;
    description: string;
  }>;
  assumptions: string[];
  acceptanceCriteria: string[];
}
~~~

### 8.2 WebAppArtifact

~~~ts
interface WebAppArtifact {
  schemaVersion: 1;
  kind: "web_app";
  title: string;
  description: string;
  html: string;
  acceptanceCriteria: string[];
}
~~~

OpenAI Route 与本机 Codex Bridge 分别执行严格 JSON Schema 约束和运行时校验。模型输出不会作为自由文本直接写入数据库或 iframe。

### 8.3 为什么不展示“真实思维链”

页面展示的是：

- BuildPlan；
- 用户可读的 reasoning summary；
- 生成阶段信息。

它们是结构化业务产物，不是隐藏 reasoning token 或私有 chain-of-thought 的逐字转录。面试中应该称为“模型决策摘要”，不要称为“原始思维链”。

## 9. 数据模型

### 9.1 主要表

| 表 | 作用 |
| --- | --- |
| <code>projects</code> | Web App / Chat 共用项目、workspace、标题、Prompt、当前版本和记忆配置 |
| <code>versions</code> | 不可变版本、Artifact、BuildPlan、摘要、Provider 和时间 |
| <code>chat_messages</code> | 对话角色、内容、Provider、模型和时间 |
| <code>users</code> | GitHub 公共身份与账号 workspace |
| <code>sessions</code> | Session Token Hash、有效期和撤销时间 |

### 9.2 为什么保存完整快照

版本采用 append-only 完整快照，不做增量 Diff。

优点：

- 查询和预览简单；
- 恢复语义清楚；
- 历史可追溯；
- Demo 数据规模下易于验证。

代价：

- HTML 会重复存储；
- 暂无代码 Diff、分支与合并；
- 数据规模扩大后需要对象存储或增量策略。

<code>projects.current_spec</code> 与 <code>versions</code> 存在少量反范式重复：

- <code>current_spec</code> 方便快速读取当前产物；
- <code>versions</code> 保存完整不可变历史。

## 10. Provider 路由

~~~text
Browser
→ /api/plan | /api/generate | /api/chat
   ├─ OPENAI_API_KEY 存在
   │  └─ OpenAI Responses API
   └─ 503 + OPENAI_NOT_CONFIGURED
      └─ Local Codex Bridge
~~~

关键规则：

1. 始终优先请求同源服务端；
2. Worker 配置 Key 时，服务端优先调用 OpenAI；
3. 只有“没有配置 Key”才回退本机 Bridge；
4. Key 已配置但调用失败时，不静默切换 Provider；
5. Bridge 只监听 localhost，不把本机登录信息上传 Cloudflare；
6. Bridge 使用串行队列执行 Codex CLI，避免并发子进程争抢本机会话。

不同 Provider 下的“并发”含义不同：

- 服务端 OpenAI：不同请求可以真正并行；
- 本机 Codex Bridge：UI 可以同时发起和切换，但模型任务在本机依次完成。

## 11. 页面状态与并发策略

### 11.1 页面与任务是两套状态

页面层：

~~~text
home ↔ projects ↔ project
~~~

Web App 任务层：

~~~text
project_created
→ planning
→ plan_ready
→ building
→ ready
→ planning
→ building
→ ready
~~~

Chat 任务层：

~~~text
ready → replying → ready / reply_error
~~~

当前代码中的 <code>planning</code> 同时表示两个子状态：

- <code>planningLoading=true</code>：模型正在生成方案；
- <code>planningLoading=false</code> 且存在 Plan：等待用户确认。

如果继续重构，应该改成显式 reducer 或状态机枚举。

### 11.2 并发策略

| 任务 | 当前策略 | 原因 |
| --- | --- | --- |
| 当前浏览器内同一对话的多次发送 | 禁止并发 | 后一条依赖前一条回复，历史有顺序 |
| 当前浏览器内的不同对话 | 允许后台并发 | 项目、历史和失败状态隔离 |
| Chat 与 Web App | 允许同时运行 | 不写同一份版本数据 |
| Web 方案任务 | 浏览器内最多一个待处理方案 | 控制未确认方案的恢复复杂度 |
| Web 构建或版本恢复 | 浏览器内最多一个写任务 | 避免竞争当前版本号 |
| 本机 Codex | 串行队列 | 保护本地 CLI 会话与资源 |

### 11.3 如何防止慢响应“串项目”

前端使用多层请求身份：

- <code>projectsRequestRef</code>：项目列表只接受最新请求；
- <code>openProjectRequestRef</code>：快速切换时丢弃旧项目加载；
- <code>planRequestRef</code>：旧规划不能覆盖新规划；
- <code>workspaceEpochRef</code>：切换工作上下文后，旧任务不写当前页面；
- <code>activeProjectIdRef</code>：任务结果只更新所属项目；
- <code>identityEpochRef</code>：登录或退出后丢弃旧身份请求；
- <code>activeVersionIdRef</code>：用户选中的版本不会被后台结果随意切换。

不同对话使用：

- <code>Set&lt;projectId&gt;</code> 保存运行状态；
- <code>Map&lt;projectId, FailedChatTask&gt;</code> 保存失败上下文。

零版本 Web 草稿在规划前就写入 D1。刷新后虽然正在执行的模型请求不会继续，但项目标题和首次 Prompt 仍在，可以重新生成方案。

## 12. 预览与导出

模型生成完整、自包含的 <code>index.html</code>：

- CSS 和 JavaScript 全部内联；
- 不依赖 npm install；
- 不依赖构建容器；
- Preview 与导出使用同一 Artifact；
- Preview 使用 <code>srcDoc</code> 放入 sandbox iframe；
- iframe 允许脚本、表单和模态框，但没有同源权限；
- Preview 注入自适应缩放逻辑；
- ZIP 导出使用原始 Artifact，不包含工作台的缩放脚本。

选择单文件产物，是整个时间盒中最关键的复杂度控制。

如果一开始生成 React/Vite 多文件工程，还必须实现：

- 依赖安装；
- 文件系统；
- 构建容器；
- 日志与超时；
- 依赖安全；
- 产物托管；
- 构建任务队列。

这些会抢占核心产品闭环的时间。

## 13. 实现思路与关键取舍

### 13.1 实现顺序

1. 先定义 BuildPlan 和 WebAppArtifact 契约；
2. 打通 Prompt → Plan → Confirm → Preview；
3. 增加方案调整和版本演进；
4. 增加 D1、访客 workspace 和 GitHub 登录；
5. 增加对话与显式长期记忆；
6. 修复后台切换、竞态、版本锁定和恢复；
7. 补齐测试、CI、部署和文档。

原则是“先纵向闭环，再横向扩展”。

### 13.2 关键取舍表

| 设计问题 | 本版选择 | 为什么 | 暂时放弃 |
| --- | --- | --- | --- |
| 通用 AI IDE 还是聚焦场景 | 只生成 Web App | 输入、产物和验收统一 | 任意技术栈、终端、多 Agent |
| 多文件还是单文件 | 自包含 HTML | 无需依赖安装和构建容器 | npm 生态、文件树和源码 Diff |
| 直接生成还是 Plan-first | 先规划、可调整、确认后生成 | 降低方向错误和返工成本 | 更短的单次等待 |
| 版本如何保存 | 不可变完整快照 | 简单、稳定、可追溯 | 增量 Diff、分支和合并 |
| 保存哪些数据 | 保存平台项目，不保存应用运行状态 | 先完成项目找回和演进 | 游戏进度和生成应用业务数据 |
| 长期记忆 | 用户显式文本 | 可见、可控、可验证 | 自动画像、Embedding 和 RAG |
| 前后端组织 | Next.js 单仓全栈 | 共用类型、同源 API、一套部署 | 微服务和独立 API 网关 |
| 数据库 | D1 | 与 Worker 绑定、无需数据库服务 | 高并发写入与复杂事务平台 |
| 无 API Key 怎么验证 | 服务端 Key 优先，本机 Bridge 兜底 | 保留生产路径且能使用现有订阅 | 上传个人会话凭证 |
| 安全做到什么程度 | OAuth、Session hash、校验、sandbox 等基础边界 | 满足 Demo 基本质量 | 完整生产安全体系 |

## 14. 当前完成程度

### 14.1 已完成

- Web App 真实规划、方案多轮调整、确认生成和可运行 Preview；
- 代码与生成详情查看；
- 自然语言持续修改；
- 不可变版本、历史恢复和 ZIP 导出；
- 版本规划/构建期间切换锁定；
- 零版本草稿、后台项目切换和结果归属；
- Chat 项目、消息历史和失败保留；
- 用户显式控制的长期记忆；
- 自动标题、手动改名和删除；
- 访客 workspace、GitHub OAuth 和访客项目认领；
- D1 持久化用户、Session、项目、版本、消息和记忆；
- 服务端 OpenAI Provider 和本机 Codex Bridge；
- OpenNext + Cloudflare Worker + D1 部署；
- public GitHub、migration、CI 和 53 项自动测试。

### 14.2 部分完成

| 能力 | 已有部分 | 尚缺部分 |
| --- | --- | --- |
| 线上真实模型 | 三条 OpenAI 路由已实现 | 当前 Worker 未配置 API Key，外部评审者不能独立新生成 |
| 后台任务 | SPA 内可切项目，结果归属原项目 | 不是服务端持久队列，刷新或关闭页面会中断 |
| 失败恢复 | 项目壳、Prompt、用户消息和已完成版本持久化 | 未完成 Plan/Artifact 和运行中队列不持久化 |
| 模型验收 | Schema、类型、长度和字段校验 | acceptance criteria 未自动执行 |
| 预览安全 | sandbox iframe、输入限制、结构校验 | 没有独立预览域、CSP 重写和完整代码扫描 |
| 自动化 | 单元/接口测试、Worker build、HTTP smoke | 缺 Playwright E2E、视觉回归和浏览器矩阵 |
| 响应式 | 有自适应布局和 Preview 缩放 | 本轮以桌面演示为主，未做完整手机端验收 |
| 多设备并发 | 登录后可以跨设备访问已保存项目 | 运行中任务不能跨设备继续，也没有乐观锁 |

### 14.3 明确未做

- 多文件工程、npm 依赖、在线 IDE 和终端；
- 生成后端、数据库和第三方服务；
- 生成应用内部数据持久化；
- 服务端 Job Queue、流式输出、暂停和跨刷新恢复；
- 自动记忆、Embedding、向量库、RAG 和跨项目画像；
- GitHub 仓库同步和代码自动提交；
- 团队空间、RBAC、分享和协作编辑；
- 版本 Diff、分支、合并和多人冲突处理；
- 通用工具调用和多 Agent 编排；
- 生产级限流、配额、计费、内容审核和监控告警；
- 完整手机端与系统性无障碍审计。

## 15. 当前必须主动说明的技术限制

### 15.1 后台任务只存在于浏览器会话

“后台运行”保证 SPA 内切换项目时不丢任务，不代表持久化任务系统。

- 刷新页面或关闭标签页后，进行中的 Promise 和失败缓存会丢失；
- 项目壳和已保存输入仍在 D1；
- 未保存的 Plan 或 Artifact 需要重新生成。

### 15.2 模型调用和数据库不是一个事务

- Chat 先保存用户消息，再请求模型，再保存回复；
- Web App 先拿到模型产物，再写入版本；
- 可能出现用户消息已保存但回复失败；
- 也可能出现模型生成成功但版本保存失败。

当前有消息 ID、失败缓存和重试保护，但不是 Exactly Once。

### 15.3 多标签页和多设备写入

当前 Web 版本写入和 Chat 同项目回复主要依靠单浏览器锁。D1 唯一约束能阻止重复版本号，但没有 operation ID、乐观锁或跨设备任务协调。

### 15.4 Preview 不是生产级代码沙箱

iframe 没有同源权限，可以降低风险，但当前没有：

- HTML 静态扫描；
- CSP 重写；
- 独立 Preview 域；
- 网络访问审计；
- 运行时异常自动隔离。

### 15.5 结构校验不等于行为验收

Artifact 可以通过字段、大小和类型校验，但不代表键盘操作、游戏规则和所有 acceptance criteria 一定正确。

## 16. 如果继续投入时间

优先级不按功能大小排序，而按“是否补齐可验证短板、是否提高主链路稳定性、投入产出比”排序。

| 优先级 | 时间 | 下一步 | 判断依据 |
| --- | --- | --- | --- |
| P0 | 0.5 天 | 配置线上 API Key；增加 Provider 健康检查和准确状态；跑一次生产模型 smoke；录制 3–5 分钟 Demo | 先消除外部评审者无法独立生成的最大交付风险 |
| P1 | 1–2 天 | Playwright 主链路 E2E；服务端 operation ID 和幂等；持久任务表或 Queue；trace ID、阶段耗时和结构化错误 | 直接提升稳定性、可诊断性和长任务恢复 |
| P2 | 2–4 天 | 自动执行 acceptance criteria；捕获 Preview 运行错误；最多一次受控自修复；Plan/代码版本 Diff | 把“生成完成”升级为“生成并验证完成”，形成 Agent 工程亮点 |
| P2 | 1–2 天 | 拆分 Studio.tsx；用 reducer/状态机管理 Web 和 Chat；抽象统一 Provider adapter | 降低组件复杂度，提高扩展与测试能力 |
| P3 | 1–2 周以上 | 隔离构建沙箱、多文件工程、依赖白名单、对象存储和生成后端 | 只有核心闭环稳定后才值得扩大产物边界 |
| P3 | 视需求 | 自动记忆/RAG、团队协作、GitHub 同步和计费 | 这些是平台扩展，不是当前主链路短板 |

最重要的判断是：

> 不先增加更多项目类型，也不先做自动 RAG。先让线上模型独立可用、主流程可自动回归，再把验收标准变成自动执行与有界修复。

## 17. 按面试评估维度复盘

| 维度 | 当前优势 | 当前短板 | 最值得优化 |
| --- | --- | --- | --- |
| 完成度 | 两条闭环、登录、持久化、版本、删除、导出和部署 | 线上 Key 缺失，任务不持久 | 配置线上 Provider，增加持久任务和 E2E |
| 工程思维 | 先定义契约；版本、Provider、数据边界清楚 | Studio 组件过大，状态由多个布尔组合 | 拆分模块并引入 reducer/状态机 |
| 用户体验 | 访客直接开始；方案可调整；可后台切项目 | 长等待缺少流式进度和服务端取消 | 阶段流式反馈、取消、重试和准确 Provider 状态 |
| 创新性 | Plan-first、不可变演进、显式记忆 | 验收标准尚未执行，版本无 Diff | 自动验收 + 一次有界修复 + 版本 Diff |
| 可交付性 | 在线地址、public 仓库、D1、CI、测试和文档 | 新模型调用依赖本机 Bridge | 配置 Key、Demo 视频、部署后 smoke 证据 |

## 18. 面试官可能追问

### Q1：这个项目是纯前端吗？后端在哪里？

不是。React 是前端；<code>app/api/**/route.ts</code> 里的 Next.js Route Handlers 是后端。部署后这些后端逻辑运行在 Cloudflare Worker，D1 是数据库。

### Q2：Cloudflare 是框架吗？

不是。业务框架是 Next.js。OpenNext 是部署适配器，Cloudflare Worker 是运行环境，Assets 托管静态资源，D1 保存关系数据。

### Q3：为什么不直接生成 React 项目？

多文件 React 工程需要依赖安装、文件系统、构建容器、日志、超时和安全隔离。时间盒内使用自包含 HTML，能让 Preview、版本和导出围绕同一 Artifact，优先证明核心价值。

### Q4：为什么要先生成 BuildPlan？

它把“需求理解”和“代码生成”拆开。用户可以在完整生成前修正方向，降低返工和调用成本；方案还能与版本一起保存，形成可追溯决策。

### Q5：这是不是展示模型思维链？

不是。展示的是结构化 BuildPlan 和用户可读的决策摘要，不是隐藏 reasoning token。

### Q6：为什么版本保存完整快照？

Demo 数据规模下，完整快照用存储空间换查询稳定性和可解释性。恢复时创建新版本，不覆盖历史。规模扩大后再考虑对象存储与增量 Diff。

### Q7：为什么长期记忆不做向量库？

显式文本让用户知道模型记住了什么，也容易验证。自动记忆需要提取、召回、冲突、评测和隐私策略，不是时间盒内最优先问题。

### Q8：Chat 为什么先保存用户消息？

慢模型或页面切换时，用户问题不能消失。代价是可能暂时只有用户消息而没有回复，所以需要失败状态和幂等重试。

### Q9：Chat 可以并发吗？

在当前浏览器内，不同对话可以独立发起任务，同一个对话不可以。后一条消息依赖上一条回复，必须保持顺序；多标签页和多设备暂时没有服务端锁。本机 Codex Bridge 还会把所有本地模型任务串行排队。

### Q10：为什么没有把 ChatGPT 会话凭证传到 Cloudflare？

个人会话凭证不应该作为线上服务认证。Bridge 只在 localhost 使用已有 Codex 登录；生产方案仍然是 Worker 持有服务端 API Key。

### Q11：生成应用安全吗？

当前有结构校验、长度限制和 sandbox iframe，但还不是生产级代码执行平台。后续需要独立预览域、CSP、静态扫描、网络限制和运行时审计。

### Q12：为什么不保存游戏进度？

当前产品边界是 AI 项目生成与演进平台。保存任意生成应用的运行数据，需要统一数据协议、权限模型和生成后端，会显著扩大范围。

## 19. 关键代码位置

| 路径 | 面试时可以讲什么 |
| --- | --- |
| [app/components/Studio.tsx](app/components/Studio.tsx) | 页面状态、后台任务、项目切换、版本和对话 |
| [app/api/plan/route.ts](app/api/plan/route.ts) | BuildPlan Structured Output、修订与输入边界 |
| [app/api/generate/route.ts](app/api/generate/route.ts) | 确认方案后生成 WebAppArtifact |
| [app/api/chat/route.ts](app/api/chat/route.ts) | 历史、长期记忆与 Chat Structured Output |
| [app/api/projects](app/api/projects) | workspace、项目、版本、对话和删除 |
| [app/api/auth](app/api/auth) | GitHub OAuth、Session 和访客认领 |
| [lib/validation.ts](lib/validation.ts) | 领域对象运行时校验 |
| [lib/project-title.ts](lib/project-title.ts) | 可测试的首次标题摘要 |
| [lib/export-project.ts](lib/export-project.ts) | 独立 ZIP 导出 |
| [db/schema.ts](db/schema.ts) | D1 数据模型 |
| [db/auth.ts](db/auth.ts) | workspace 身份和 Session 解析 |
| [scripts/codex-session-bridge.mjs](scripts/codex-session-bridge.mjs) | 本机 Codex Provider 和串行队列 |
| [scripts/smoke-http.mjs](scripts/smoke-http.mjs) | Worker + D1 主链路验证 |
| [.github/workflows](.github/workflows) | CI 与 Cloudflare 部署 |

## 20. 最终总结

这个项目最值得讲的不是“功能数量”，而是以下几件事：

1. 把开放题收敛成一个可验收的 Web App 生成闭环；
2. 用结构化 Plan 和 Artifact 限制模型自由度；
3. 把用户反馈放在完整生成之前；
4. 用不可变版本让自然语言修改可追溯；
5. 用项目级状态隔离解决慢模型请求下的页面切换与并发；
6. 明确区分平台持久化、生成应用运行时状态和模型 Provider；
7. 保留线上 API Key 生产路径，同时用 localhost Bridge 完成真实模型验证；
8. 对尚未完成的任务持久化、自动验收和生产安全保持诚实边界。

面试时的核心表达应该是：

> 我没有追求“看起来像一个很大的平台”，而是先让核心路径可运行、可解释、可恢复和可部署，再明确记录哪些复杂度被主动推迟。
