import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import Studio from "../app/components/Studio";

test("server-renders the Chance Atoms creation shell", () => {
  const html = renderToStaticMarkup(createElement(Studio));

  assert.match(html, /今天想聊点什么/);
  assert.match(html, /对话/);
  assert.match(html, /围绕一个主题持续交流/);
  assert.match(html, /Web App 构建/);
  assert.match(html, /描述页面或游戏/);
  assert.match(html, /创作内容会自动保存/);
  assert.match(html, /我的项目/);
  assert.match(html, /最近项目/);
  assert.match(html, /class="atoms-shell"/);
  assert.doesNotMatch(html, /客户线索看板|内容发布日历|设备巡检台/);
  assert.doesNotMatch(html, /Your site is taking shape|react-loading-skeleton/);
});

test("wires the real Studio, persistent routes, and standard OpenNext deployment", async () => {
  const [page, studio, bridge, projectsPage, chatPage, appPage, layout, styles, packageJson, wranglerConfig] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/Studio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../scripts/codex-session-bridge.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/projects/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/chat/[projectId]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/apps/[projectId]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
  ]);

  assert.match(page, /import Studio from "\.\/components\/Studio"/);
  assert.match(page, /<Studio \/>/);
  assert.match(projectsPage, /initialView="projects"/);
  assert.match(chatPage, /initialProjectKind="chat"/);
  assert.match(appPage, /initialProjectKind="web_app"/);
  assert.match(studio, /className="atoms-project-summary" role="tablist"/);
  assert.ok(studio.indexOf('["all", "全部项目"') < studio.indexOf('["chat", "对话"'));
  assert.ok(studio.indexOf('["chat", "对话"') < studio.indexOf('["web_app", "Web App"'));
  assert.doesNotMatch(studio, /atoms-project-filters/);
  const homeView = studio.slice(
    studio.indexOf('if (landingView === "home")'),
    studio.indexOf("const workspaceName"),
  );
  assert.doesNotMatch(homeView, /disabled=\{accountSwitching \|\| workspaceWriteBusy\}/);
  assert.match(studio, /useRef<Set<string>>\(new Set\(\)\)/);
  assert.match(studio, /backgroundChatProjectIdsRef\.current\.has\(project\.id\)/);
  assert.doesNotMatch(studio, /chatSendInFlightRef/);
  assert.match(studio, /summarizeInitialProjectTitle\(cleanPrompt, "新对话"\)/);
  assert.match(studio, /summarizeInitialProjectTitle\(cleanPrompt, "新 Web App"\)/);
  assert.match(studio, /aria-label="修改项目名称"/);
  assert.doesNotMatch(studio, /你正在查看历史版本|恢复此版本|history-callout/);
  assert.match(styles, /\.project-title-editor/);
  assert.match(bridge, /enqueueModelRequest/);
  assert.doesNotMatch(bridge, /已有模型任务正在执行|modelRequestInFlight/);
  assert.match(layout, /generateMetadata/);
  assert.match(layout, /Chance Atoms/);
  assert.doesNotMatch(layout, /\/og\.png/);
  assert.match(styles, /\.atoms-shell/);
  assert.match(styles, /\.atoms-project-grid/);
  assert.match(styles, /\.studio-shell/);
  assert.match(styles, /account-control--compact\.account-control--login:hover:not\(:disabled\)/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/);
  assert.match(packageJson, /"name": "chance-atoms-demo"/);
  assert.match(packageJson, /@opennextjs\/cloudflare/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton|vinext|@cloudflare\/vite-plugin/);
  assert.match(wranglerConfig, /"main": "\.open-next\/worker\.js"/);
  assert.match(wranglerConfig, /"binding": "DB"/);

  await Promise.all([
    assert.rejects(
      access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)),
    ),
    assert.rejects(access(new URL("../.openai/hosting.json", import.meta.url))),
    assert.rejects(access(new URL("../vite.config.ts", import.meta.url))),
    assert.rejects(access(new URL("../worker/index.ts", import.meta.url))),
  ]);
});
