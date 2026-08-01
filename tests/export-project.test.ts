import assert from "node:assert/strict";
import test from "node:test";

import { deterministicAgent } from "../lib/deterministic-agent";
import {
  createStandaloneProject,
  createZipArchive,
} from "../lib/export-project";
import { AppSpecValidationError } from "../lib/validation";
import { POST } from "../app/api/export/route";

test("exports a runnable, dependency-free standalone project", () => {
  const spec = deterministicAgent("Create a bug tracker");
  const result = createStandaloneProject({
    spec,
    records: spec.seedData,
    projectId: "project-42",
  });

  assert.equal(result.fileName, "bug-tracker-standalone.zip");
  assert.deepEqual(
    result.files.map((file) => file.name),
    ["index.html", "app-spec.json", "README.md"],
  );

  const html = result.files[0].content;
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /chance-atoms:standalone:/);
  assert.match(html, /window\.localStorage\.setItem/);
  assert.match(html, /type: "records-change"/);
  assert.match(html, /id="record-form"/);
  assert.doesNotMatch(html, /\beval\s*\(|new Function\s*\(/);

  assert.match(result.files[1].content, /"schemaVersion": 1/);
  assert.match(result.files[2].content, /直接双击 `index\.html`/);
  assert.match(result.files[2].content, /不包含 API 密钥/);

  const view = new DataView(
    result.archive.buffer,
    result.archive.byteOffset,
    result.archive.byteLength,
  );
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint32(result.archive.byteLength - 22, true), 0x06054b50);
  const archiveText = new TextDecoder().decode(result.archive);
  assert.match(archiveText, /index\.html/);
  assert.match(archiveText, /app-spec\.json/);
  assert.match(archiveText, /README\.md/);
});

test("exports a Web App Artifact without rewriting the generated HTML", () => {
  const html = `<!doctype html>
<html lang="zh-CN">
  <head><meta charset="utf-8"><title>贪吃蛇</title></head>
  <body><canvas id="game"></canvas><script>document.title = "贪吃蛇";</script></body>
</html>`;
  const artifact = {
    schemaVersion: 1 as const,
    kind: "web_app" as const,
    title: "贪吃蛇",
    description: "一个可以直接运行的键盘控制小游戏。",
    html,
    acceptanceCriteria: ["方向键可以控制移动", "碰撞后可以重新开始"],
  };

  const result = createStandaloneProject({
    artifact,
    records: [{ id: "ignored", values: [] }],
    projectId: "snake-demo",
  });

  assert.deepEqual(
    result.files.map((file) => file.name),
    ["index.html", "artifact.json", "README.md"],
  );
  assert.equal(result.files[0].content, html);
  assert.match(result.files[1].content, /"kind": "web_app"/);
  assert.match(result.files[1].content, /"acceptanceCriteria"/);
  assert.match(result.files[2].content, /独立 Web App/);
  assert.match(result.files[2].content, /artifact\.json/);
  const archiveText = new TextDecoder().decode(result.archive);
  assert.match(archiveText, /index\.html/);
  assert.match(archiveText, /artifact\.json/);
  assert.match(archiveText, /README\.md/);
});

test("keeps hostile generated text inert inside the exported HTML", () => {
  const spec = deterministicAgent("Build a generic tracker");
  const hostile = "</script><img src=x onerror=alert('owned')>";
  const result = createStandaloneProject({
    spec: {
      ...spec,
      title: hostile,
      seedData: [
        {
          id: "safe-row",
          values: [{ fieldId: spec.fields[0].id, value: hostile }],
        },
      ],
    },
    projectId: "safe-project",
  });
  const html = result.files.find((file) => file.name === "index.html")?.content ?? "";

  assert.doesNotMatch(html, /<img src=x onerror=/);
  assert.match(html, /\\u003c\/script\\u003e\\u003cimg/);
});

test("exports a generated web app without rebuilding its HTML", async () => {
  const artifact = {
    schemaVersion: 1 as const,
    kind: "web_app" as const,
    title: "Snake Game",
    description: "A playable single-file snake game",
    html: "<!doctype html><html><body><canvas id=game></canvas><script>document.title='Snake Game'</script></body></html>",
    acceptanceCriteria: ["Arrow keys move the snake", "Restart starts a new game"],
  };
  const result = createStandaloneProject({ artifact, projectId: "snake-demo" });

  assert.equal(result.fileName, "snake-game-standalone.zip");
  assert.deepEqual(
    result.files.map((file) => file.name),
    ["index.html", "artifact.json", "README.md"],
  );
  assert.equal(result.files[0].content, artifact.html);
  assert.match(result.files[1].content, /"kind": "web_app"/);
  assert.match(result.files[2].content, /独立 Web App/);

  const response = await POST(
    new Request("http://localhost/api/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ artifact, projectId: "snake-demo" }),
    }),
  );
  assert.equal(response.status, 200);
  assert.match(new TextDecoder().decode(await response.arrayBuffer()), /artifact\.json/);
});

test("rejects invalid specs, records, project ids, and archive paths", () => {
  const spec = deterministicAgent("Create an expense tracker");

  assert.throws(
    () => createStandaloneProject({ spec: { ...spec, fields: [] } }),
    AppSpecValidationError,
  );
  assert.throws(
    () =>
      createStandaloneProject({
        spec,
        records: [
          {
            id: "bad-row",
            values: [{ fieldId: "amount", value: "not-a-number" }],
          },
        ],
      }),
    AppSpecValidationError,
  );
  assert.throws(
    () => createStandaloneProject({ spec, projectId: "../escape" }),
    /projectId/,
  );
  assert.throws(
    () => createZipArchive([{ name: "../escape.html", content: "unsafe" }]),
    /Unsafe archive path/,
  );
});

test("export API returns a downloadable ZIP and rejects malformed input", async () => {
  const spec = deterministicAgent("Create a task tracker");
  const response = await POST(
    new Request("http://localhost/api/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ spec, records: spec.seedData, projectId: "task-demo" }),
    }),
  );
  const bytes = new Uint8Array(await response.arrayBuffer());

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/zip");
  assert.match(response.headers.get("content-disposition") ?? "", /attachment/);
  assert.deepEqual(Array.from(bytes.slice(0, 4)), [0x50, 0x4b, 0x03, 0x04]);

  const invalid = await POST(
    new Request("http://localhost/api/export", {
      method: "POST",
      body: "not json",
    }),
  );
  assert.equal(invalid.status, 400);
});
