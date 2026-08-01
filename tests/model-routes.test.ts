import assert from "node:assert/strict";
import test from "node:test";

import { POST as generate } from "../app/api/generate/route";
import { POST as plan } from "../app/api/plan/route";
import { deterministicAgent, type BuildPlan } from "../lib";

const buildPlan: BuildPlan = {
  schemaVersion: 1,
  kind: "web_app_plan",
  title: "构建俄罗斯方块",
  requestSummary: "创建一个可以直接游玩的单页俄罗斯方块 Web App。",
  designDecisions: ["使用 Canvas 绘制棋盘，并把状态保留在当前页面内。"],
  interactionFlow: ["开始游戏后，玩家使用键盘移动和旋转方块。"],
  implementationSteps: [
    {
      title: "实现游戏循环",
      description: "实现方块生成、碰撞、消行、计分、结束与重新开始。",
    },
  ],
  assumptions: ["刷新页面后不保留当前局游戏数据。"],
  acceptanceCriteria: ["方块可以移动和旋转，完整行会被消除并计分。"],
};

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function withoutApiKey<T>(run: () => Promise<T>) {
  const original = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    return await run();
  } finally {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
  }
}

test("planning route directs an unconfigured deployment to the local bridge", async () => {
  const response = await withoutApiKey(() =>
    plan(jsonRequest("http://localhost/api/plan", { prompt: "做一个俄罗斯方块" })),
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 503);
  assert.equal(body.code, "OPENAI_NOT_CONFIGURED");
});

test("generation route requires a model-authored plan first", async () => {
  const response = await generate(
    jsonRequest("http://localhost/api/generate", { prompt: "做一个俄罗斯方块" }),
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 400);
  assert.match(String(body.error), /构建方案/);
});

test("generation route rejects a legacy CRUD artifact as a Web App version", async () => {
  const response = await generate(
    jsonRequest("http://localhost/api/generate", {
      prompt: "继续完善游戏",
      instruction: "增加暂停功能",
      plan: buildPlan,
      previousArtifact: deterministicAgent("Build a task tracker"),
    }),
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 400);
  assert.match(String(body.error), /Web App 版本/);
});

test("valid planned generation uses the local bridge fallback when no API key exists", async () => {
  const response = await withoutApiKey(() =>
    generate(
      jsonRequest("http://localhost/api/generate", {
        prompt: "做一个俄罗斯方块",
        plan: buildPlan,
      }),
    ),
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 503);
  assert.equal(body.code, "OPENAI_NOT_CONFIGURED");
});

test("model routes reject malformed JSON", async () => {
  const request = new Request("http://localhost/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "not-json",
  });
  const response = await plan(request);

  assert.equal(response.status, 400);
});
