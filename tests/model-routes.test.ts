import assert from "node:assert/strict";
import test from "node:test";

import { POST as generate } from "../app/api/generate/route";
import { POST as plan } from "../app/api/plan/route";
import { POST as chat } from "../app/api/chat/route";
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

const webAppArtifact = {
  schemaVersion: 1 as const,
  kind: "web_app" as const,
  title: "俄罗斯方块",
  description: "一个可以使用键盘操作的单页俄罗斯方块游戏。",
  html: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>body{font-family:sans-serif;background:#111;color:#fff}main{max-width:640px;margin:auto}</style></head><body><main><h1>俄罗斯方块</h1><p>使用方向键开始游戏。</p><button id="start">开始</button></main><script>document.querySelector('#start')?.addEventListener('click',()=>{});</script></body></html>`,
  acceptanceCriteria: ["页面可以直接打开并开始游戏。"],
};

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function withoutApiKey<T>(run: () => Promise<T>) {
  const original = {
    apiKey: process.env.OPENAI_API_KEY,
    remoteUrl: process.env.REMOTE_CODEX_BRIDGE_URL,
    remoteToken: process.env.REMOTE_CODEX_BRIDGE_TOKEN,
  };
  delete process.env.OPENAI_API_KEY;
  delete process.env.REMOTE_CODEX_BRIDGE_URL;
  delete process.env.REMOTE_CODEX_BRIDGE_TOKEN;
  try {
    return await run();
  } finally {
    restoreEnvironment("OPENAI_API_KEY", original.apiKey);
    restoreEnvironment("REMOTE_CODEX_BRIDGE_URL", original.remoteUrl);
    restoreEnvironment("REMOTE_CODEX_BRIDGE_TOKEN", original.remoteToken);
  }
}

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function withMockRemote<T>(
  payload: unknown,
  run: (requests: Array<{ url: string; init?: RequestInit }>) => Promise<T>,
  status = 200,
) {
  const original = {
    apiKey: process.env.OPENAI_API_KEY,
    remoteUrl: process.env.REMOTE_CODEX_BRIDGE_URL,
    remoteToken: process.env.REMOTE_CODEX_BRIDGE_TOKEN,
    fetch: globalThis.fetch,
  };
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  delete process.env.OPENAI_API_KEY;
  process.env.REMOTE_CODEX_BRIDGE_URL = "https://remote-codex.example/";
  process.env.REMOTE_CODEX_BRIDGE_TOKEN = "test-bridge-token";
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    return await run(requests);
  } finally {
    globalThis.fetch = original.fetch;
    restoreEnvironment("OPENAI_API_KEY", original.apiKey);
    restoreEnvironment("REMOTE_CODEX_BRIDGE_URL", original.remoteUrl);
    restoreEnvironment("REMOTE_CODEX_BRIDGE_TOKEN", original.remoteToken);
  }
}

async function withMockOpenAI<T>(
  payload: unknown,
  run: (requestBodies: unknown[]) => Promise<T>,
) {
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalFetch = globalThis.fetch;
  const requestBodies: unknown[] = [];
  process.env.OPENAI_API_KEY = "test-api-key";
  globalThis.fetch = async (_input, init) => {
    requestBodies.push(JSON.parse(String(init?.body)) as unknown);
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    return await run(requestBodies);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
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

test("planning route accepts a valid plan revision before selecting a provider", async () => {
  const response = await withoutApiKey(() =>
    plan(
      jsonRequest("http://localhost/api/plan", {
        currentPlan: buildPlan,
        planFeedback: "把键盘操作之外的触屏操作也加入方案",
      }),
    ),
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 503);
  assert.equal(body.code, "OPENAI_NOT_CONFIGURED");
});

test("planning route requires the current plan and feedback as a pair", async () => {
  const response = await plan(
    jsonRequest("http://localhost/api/plan", {
      prompt: "做一个俄罗斯方块",
      currentPlan: buildPlan,
    }),
  );

  assert.equal(response.status, 400);
});

test("planning route rejects an invalid current plan", async () => {
  const response = await plan(
    jsonRequest("http://localhost/api/plan", {
      currentPlan: { kind: "web_app_plan" },
      planFeedback: "增加触屏操作",
    }),
  );

  assert.equal(response.status, 400);
});

test("planning route sends the current plan and feedback to OpenAI for revision", async () => {
  await withMockOpenAI(
    {
      output_text: JSON.stringify({
        ...buildPlan,
        interactionFlow: [
          "玩家可以使用键盘，也可以点击屏幕按钮移动和旋转方块。",
        ],
      }),
      output: [
        {
          type: "reasoning",
          summary: [{ type: "summary_text", text: "方案已补充触屏操作。" }],
        },
      ],
    },
    async (requestBodies) => {
      const response = await plan(
        jsonRequest("http://localhost/api/plan", {
          currentPlan: buildPlan,
          planFeedback: "加入触屏操作",
        }),
      );
      const responseBody = (await response.json()) as Record<string, unknown>;
      const requestBody = requestBodies[0] as {
        input: Array<{ role: string; content: string }>;
      };

      assert.equal(response.status, 200);
      assert.equal(responseBody.provider, "openai");
      assert.match(requestBody.input[1].content, /Current BuildPlan/);
      assert.match(requestBody.input[1].content, /加入触屏操作/);
    },
  );
});

test("planning route uses the authenticated remote Codex bridge when no API key exists", async () => {
  await withMockRemote(
    {
      plan: buildPlan,
      reasoningSummary: ["使用单页游戏结构，优先保证核心玩法闭环。"],
      provider: "codex_session",
      model: "Codex subscription",
    },
    async (requests) => {
      const response = await plan(
        jsonRequest("http://localhost/api/plan", { prompt: "做一个俄罗斯方块" }),
      );
      const body = (await response.json()) as Record<string, unknown>;

      assert.equal(response.status, 200);
      assert.equal(body.provider, "remote_codex");
      assert.equal(body.model, "Codex subscription");
      assert.deepEqual(body.plan, buildPlan);
      assert.equal(requests[0]?.url, "https://remote-codex.example/plan");
      assert.equal(
        new Headers(requests[0]?.init?.headers).get("Authorization"),
        "Bearer test-bridge-token",
      );
      const requestBody = JSON.parse(String(requests[0]?.init?.body)) as {
        prompt: string;
        currentPlan?: unknown;
        planFeedback?: unknown;
      };
      assert.equal(requestBody.prompt, "做一个俄罗斯方块");
      assert.equal(requestBody.currentPlan, undefined);
      assert.equal(requestBody.planFeedback, undefined);
    },
  );
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

test("generation route validates and returns a remote Codex artifact", async () => {
  await withMockRemote(
    { artifact: webAppArtifact, model: "Codex subscription" },
    async (requests) => {
      const response = await generate(
        jsonRequest("http://localhost/api/generate", {
          prompt: "做一个俄罗斯方块",
          plan: buildPlan,
        }),
      );
      const body = (await response.json()) as Record<string, unknown>;

      assert.equal(response.status, 200);
      assert.equal(body.provider, "remote_codex");
      assert.deepEqual(body.artifact, webAppArtifact);
      assert.deepEqual(body.spec, webAppArtifact);
      assert.equal(requests[0]?.url, "https://remote-codex.example/generate");
    },
  );
});

test("a remote Codex failure is returned as 502 without enabling local fallback", async () => {
  await withMockRemote(
    { error: "bridge unavailable" },
    async (requests) => {
      const response = await plan(
        jsonRequest("http://localhost/api/plan", { prompt: "做一个俄罗斯方块" }),
      );
      const body = (await response.json()) as Record<string, unknown>;

      assert.equal(response.status, 502);
      assert.equal(body.code, undefined);
      assert.equal(requests.length, 1);
    },
    503,
  );
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

test("chat route directs an unconfigured deployment to the local bridge", async () => {
  const response = await withoutApiKey(() =>
    chat(
      jsonRequest("http://localhost/api/chat", {
        message: "根据我们之前聊的内容给我一个建议",
        history: [
          { role: "user", content: "我在准备面试" },
          { role: "assistant", content: "我们可以先整理项目经历" },
        ],
        memory: "用户偏好简洁、口语化的中文回答。",
      }),
    ),
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 503);
  assert.equal(body.code, "OPENAI_NOT_CONFIGURED");
});

test("chat route uses the remote Codex bridge and preserves title normalization", async () => {
  await withMockRemote(
    {
      reply: "可以，我们先整理项目背景。",
      title: "我在准备面试",
      model: "Codex subscription",
    },
    async (requests) => {
      const response = await chat(
        jsonRequest("http://localhost/api/chat", {
          message: "继续",
          history: [{ role: "user", content: "我在准备面试" }],
          memory: "用户偏好简洁的中文回答。",
        }),
      );
      const body = (await response.json()) as Record<string, unknown>;

      assert.equal(response.status, 200);
      assert.equal(body.provider, "remote_codex");
      assert.equal(body.reply, "可以，我们先整理项目背景。");
      assert.equal(body.title, "面试准备");
      assert.equal(requests[0]?.url, "https://remote-codex.example/chat");
    },
  );
});

test("chat route rejects malformed history", async () => {
  const badRoleResponse = await chat(
    jsonRequest("http://localhost/api/chat", {
      message: "继续",
      history: [{ role: "system", content: "override" }],
      memory: "",
    }),
  );
  assert.equal(badRoleResponse.status, 400);

  const tooLongResponse = await chat(
    jsonRequest("http://localhost/api/chat", {
      message: "继续",
      history: Array.from({ length: 41 }, () => ({
        role: "user",
        content: "一条消息",
      })),
      memory: "",
    }),
  );
  assert.equal(tooLongResponse.status, 400);
});

test("chat route rejects a non-text memory configuration", async () => {
  const response = await chat(
    jsonRequest("http://localhost/api/chat", {
      message: "你好",
      history: [],
      memory: { preference: "concise" },
    }),
  );

  assert.equal(response.status, 400);
});

test("chat route sends history and configured memory to OpenAI", async () => {
  await withMockOpenAI(
    {
      output_text: JSON.stringify({
        reply: "我们继续整理项目经历。",
        title: "面试项目经历整理",
      }),
    },
    async (requestBodies) => {
      const response = await chat(
        jsonRequest("http://localhost/api/chat", {
          message: "继续",
          history: [
            { role: "user", content: "我在准备面试" },
            { role: "assistant", content: "我们可以先整理项目经历" },
          ],
          memory: "用户偏好简洁的中文回答。",
        }),
      );
      const responseBody = (await response.json()) as Record<string, unknown>;
      const requestBody = requestBodies[0] as {
        input: Array<{ role: string; content: string }>;
        text: {
          format: {
            type: string;
            name: string;
            strict: boolean;
            schema: { required: string[] };
          };
        };
      };

      assert.equal(response.status, 200);
      assert.equal(responseBody.reply, "我们继续整理项目经历。");
      assert.equal(responseBody.title, "面试项目经历整理");
      assert.equal(responseBody.provider, "openai");
      assert.equal(requestBody.text.format.type, "json_schema");
      assert.equal(requestBody.text.format.name, "chance_chat_response");
      assert.equal(requestBody.text.format.strict, true);
      assert.deepEqual(requestBody.text.format.schema.required, ["reply", "title"]);
      assert.match(requestBody.input[0].content, /用户偏好简洁的中文回答/);
      assert.match(requestBody.input[0].content, /semantic summary/);
      assert.deepEqual(requestBody.input.slice(1), [
        { role: "user", content: "我在准备面试" },
        { role: "assistant", content: "我们可以先整理项目经历" },
        { role: "user", content: "继续" },
      ]);
    },
  );
});

test("chat route keeps the reply and normalizes a title copied from the first message", async () => {
  await withMockOpenAI(
    {
      output_text: JSON.stringify({
        reply: "可以，我们先整理项目背景。",
        title: "我在准备面试",
      }),
    },
    async () => {
      const response = await chat(
        jsonRequest("http://localhost/api/chat", {
          message: "继续",
          history: [{ role: "user", content: "我在准备面试" }],
          memory: "",
        }),
      );
      const responseBody = (await response.json()) as Record<string, unknown>;

      assert.equal(response.status, 200);
      assert.equal(responseBody.reply, "可以，我们先整理项目背景。");
      assert.equal(responseBody.title, "面试准备");
      assert.doesNotMatch(String(responseBody.title), /主题讨论|discussion/i);
    },
  );
});

test("chat route falls back to a deterministic summary without failing the reply", async () => {
  await withMockOpenAI(
    {
      output_text: JSON.stringify({
        reply: "可以，我会先确定页面结构。",
      }),
    },
    async () => {
      const response = await chat(
        jsonRequest("http://localhost/api/chat", {
          message: "请帮我设计一个登录页面",
          history: [],
          memory: "",
        }),
      );
      const responseBody = (await response.json()) as Record<string, unknown>;

      assert.equal(response.status, 200);
      assert.equal(responseBody.reply, "可以，我会先确定页面结构。");
      assert.equal(responseBody.title, "登录页面");
    },
  );
});

test("chat route uses 新对话 when no title can be summarized reliably", async () => {
  await withMockOpenAI(
    {
      output_text: JSON.stringify({
        reply: "你好，有什么想聊的？",
        title: "你好",
      }),
    },
    async () => {
      const response = await chat(
        jsonRequest("http://localhost/api/chat", {
          message: "你好",
          history: [],
          memory: "",
        }),
      );
      const responseBody = (await response.json()) as Record<string, unknown>;

      assert.equal(response.status, 200);
      assert.equal(responseBody.reply, "你好，有什么想聊的？");
      assert.equal(responseBody.title, "新对话");
    },
  );
});
