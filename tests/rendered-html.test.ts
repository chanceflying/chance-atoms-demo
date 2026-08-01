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
  assert.match(html, /持续交流与长期记忆/);
  assert.match(html, /Web App 构建/);
  assert.match(html, /可运行预览与版本演进/);
  assert.match(html, /创作内容会自动保存/);
  assert.match(html, /我的项目/);
  assert.match(html, /class="atoms-shell"/);
  assert.doesNotMatch(html, /最近项目/);
  assert.doesNotMatch(html, /客户线索看板|内容发布日历|设备巡检台/);
  assert.doesNotMatch(html, /Your site is taking shape|react-loading-skeleton/);
});

test("wires the real Studio and standard OpenNext deployment", async () => {
  const [page, layout, styles, packageJson, wranglerConfig] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
  ]);

  assert.match(page, /import Studio from "\.\/components\/Studio"/);
  assert.match(page, /<Studio \/>/);
  assert.match(layout, /generateMetadata/);
  assert.match(layout, /Chance Atoms/);
  assert.doesNotMatch(layout, /\/og\.png/);
  assert.match(styles, /\.atoms-shell/);
  assert.match(styles, /\.atoms-project-grid/);
  assert.match(styles, /\.studio-shell/);
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
