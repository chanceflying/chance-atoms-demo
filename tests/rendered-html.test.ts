import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import Studio from "../app/components/Studio";

test("server-renders the single Web App product shell", () => {
  const html = renderToStaticMarkup(createElement(Studio));

  assert.match(html, /从一句话到可运行工具/);
  assert.match(html, /描述你想创建的应用/);
  assert.match(html, /生成计划/);
  assert.match(html, /BuildPlan/);
  assert.match(html, /霓虹贪吃蛇/);
  assert.match(html, /俄罗斯方块/);
  assert.match(html, /扫雷挑战/);
  assert.match(html, /最近项目/);
  assert.match(html, /class="forge-home"/);
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
  assert.match(layout, /\/og\.png/);
  assert.match(styles, /\.forge-home/);
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
