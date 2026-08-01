import assert from "node:assert/strict";

const baseUrl = (process.env.CHANCE_ATOMS_BASE_URL || "http://localhost:8787").replace(
  /\/$/,
  "",
);

async function request(path, init = {}, cookie = "") {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...init.headers,
    },
  });
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.arrayBuffer();
  return { response, body };
}

function json(method, body) {
  return { method, body: JSON.stringify(body) };
}

const planV1 = {
  schemaVersion: 1,
  kind: "web_app_plan",
  title: "构建俄罗斯方块",
  requestSummary: "创建一个可直接游玩的单页俄罗斯方块。",
  designDecisions: ["使用 Canvas 绘制棋盘，游戏状态只保留在页面内。"],
  interactionFlow: ["开始游戏，移动和旋转方块，消行计分，结束后重新开始。"],
  implementationSteps: [
    {
      title: "完成核心游戏循环",
      description: "实现方块、碰撞、落下、消行、计分、结束和重新开始。",
    },
  ],
  assumptions: ["刷新页面后不保留当前局。"],
  acceptanceCriteria: ["方块可以移动和旋转，完整行会消除并增加分数。"],
};

const artifactV1 = {
  schemaVersion: 1,
  kind: "web_app",
  title: "俄罗斯方块",
  description: "一个自包含的浏览器俄罗斯方块。",
  html: "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><title>俄罗斯方块</title><style>body{font-family:sans-serif}</style></head><body><h1>俄罗斯方块</h1><canvas width=\"300\" height=\"600\"></canvas><button>重新开始</button><script>let score=0;</script></body></html>",
  acceptanceCriteria: ["可以开始和重新开始游戏。"],
};

const planV2 = {
  ...planV1,
  title: "增加暂停能力",
  requestSummary: "在现有俄罗斯方块中增加暂停和继续。",
  designDecisions: [...planV1.designDecisions, "暂停时冻结计时循环并保留当前棋盘。"],
  acceptanceCriteria: [...planV1.acceptanceCriteria, "玩家可以暂停并继续同一局。"],
};

const artifactV2 = {
  ...artifactV1,
  description: "支持暂停和继续的自包含浏览器俄罗斯方块。",
  html: artifactV1.html.replace("<button>重新开始</button>", "<button>暂停 / 继续</button><button>重新开始</button>"),
  acceptanceCriteria: [...artifactV1.acceptanceCriteria, "可以暂停和继续同一局。"],
};

const home = await fetch(`${baseUrl}/`);
assert.equal(home.status, 200);
assert.match(await home.text(), /Chance Atoms/);

const initial = await request("/api/projects");
assert.equal(initial.response.status, 200);
const cookie = (initial.response.headers.get("set-cookie") || "").split(";")[0];
assert.match(cookie, /^atoms_workspace=/);
assert.deepEqual(initial.body.projects, []);

const guestSession = await request("/api/auth/session", {}, cookie);
assert.equal(guestSession.response.status, 200);
assert.equal(guestSession.body.user, null);

const crossOriginLogout = await request(
  "/api/auth/logout",
  { method: "POST", headers: { Origin: "https://attacker.example" } },
  cookie,
);
assert.equal(crossOriginLogout.response.status, 403);

const guestLogout = await request(
  "/api/auth/logout",
  { method: "POST", headers: { Origin: new URL(baseUrl).origin } },
  cookie,
);
assert.equal(guestLogout.response.status, 200);
assert.equal(guestLogout.body.ok, true);

const rejectedContentType = await request(
  "/api/projects",
  {
    ...json("POST", { name: "must not be created" }),
    headers: { "Content-Type": "text/plain" },
  },
  cookie,
);
assert.equal(rejectedContentType.response.status, 415);

const crossOriginMutation = await request(
  "/api/projects",
  {
    ...json("POST", { name: "cross-origin project" }),
    headers: { Origin: "https://attacker.example" },
  },
  cookie,
);
assert.equal(crossOriginMutation.response.status, 403);

const created = await request(
  "/api/projects",
  json("POST", {
    kind: "web_app",
    name: "HTTP smoke Web App",
    prompt: "做一个俄罗斯方块",
  }),
  cookie,
);
assert.equal(created.response.status, 201);
assert.equal(Object.hasOwn(created.body.project, "workspaceId"), false);
assert.equal(created.body.project.kind, "web_app");
const projectId = created.body.project.id;

const versionOne = await request(
  `/api/projects/${projectId}/versions`,
  json("POST", {
    artifact: artifactV1,
    records: [{ id: "should-not-persist", values: [] }],
    buildPlan: planV1,
    reasoningSummary: ["Canvas 足以支持这个单页游戏，且不需要服务端运行时。"],
    prompt: "做一个俄罗斯方块",
    provider: "fixture",
    model: "smoke",
    stages: ["规划完成", "产物校验通过"],
  }),
  cookie,
);
assert.equal(versionOne.response.status, 201);
assert.equal(versionOne.body.version.version, 1);
assert.deepEqual(versionOne.body.version.artifact, artifactV1);
assert.deepEqual(versionOne.body.version.buildPlan, planV1);
assert.deepEqual(versionOne.body.version.records, []);
const versionOneId = versionOne.body.version.id;

const versionTwo = await request(
  `/api/projects/${projectId}/versions`,
  json("POST", {
    artifact: artifactV2,
    records: [{ id: "also-not-persisted", values: [] }],
    buildPlan: planV2,
    reasoningSummary: ["暂停只需要冻结游戏循环，不需要新增后端状态。"],
    prompt: "做一个俄罗斯方块",
    instruction: "增加暂停功能",
    provider: "fixture",
    model: "smoke",
    stages: ["增量规划完成", "版本产物校验通过"],
  }),
  cookie,
);
assert.equal(versionTwo.response.status, 201);
assert.equal(versionTwo.body.version.version, 2);
assert.deepEqual(versionTwo.body.version.artifact, artifactV2);
assert.deepEqual(versionTwo.body.version.buildPlan, planV2);
assert.deepEqual(versionTwo.body.version.records, []);

const history = await request(`/api/projects/${projectId}/versions`, {}, cookie);
assert.equal(history.response.status, 200);
assert.equal(history.body.versions.length, 2);
assert.deepEqual(history.body.versions[0].reasoningSummary, [
  "暂停只需要冻结游戏循环，不需要新增后端状态。",
]);

const rolledBack = await request(
  `/api/projects/${projectId}/versions`,
  json("POST", { action: "rollback", sourceVersionId: versionOneId }),
  cookie,
);
assert.equal(rolledBack.response.status, 201);
assert.equal(rolledBack.body.version.version, 3);
assert.deepEqual(rolledBack.body.version.artifact, artifactV1);
assert.deepEqual(rolledBack.body.version.buildPlan, planV1);
assert.deepEqual(rolledBack.body.version.reasoningSummary, [
  "Canvas 足以支持这个单页游戏，且不需要服务端运行时。",
]);
assert.deepEqual(rolledBack.body.version.records, []);

const archive = await request(
  "/api/export",
  json("POST", {
    artifact: rolledBack.body.version.artifact,
    records: rolledBack.body.version.records,
    projectId,
  }),
  cookie,
);
assert.equal(archive.response.status, 200);
assert.equal(archive.response.headers.get("content-type"), "application/zip");
assert.deepEqual(Array.from(new Uint8Array(archive.body).slice(0, 4)), [
  0x50, 0x4b, 0x03, 0x04,
]);

const chatCreated = await request(
  "/api/projects",
  json("POST", {
    kind: "chat",
    name: "HTTP smoke 对话",
    prompt: "",
  }),
  cookie,
);
assert.equal(chatCreated.response.status, 201);
assert.equal(chatCreated.body.project.kind, "chat");
assert.equal(chatCreated.body.project.memoryEnabled, true);
const chatProjectId = chatCreated.body.project.id;

const chatVersions = await request(
  `/api/projects/${chatProjectId}/versions`,
  {},
  cookie,
);
assert.equal(chatVersions.response.status, 404);

const rejectedChatVersion = await request(
  `/api/projects/${chatProjectId}/versions`,
  json("POST", {
    artifact: artifactV1,
    buildPlan: planV1,
    prompt: "不能写入对话项目",
  }),
  cookie,
);
assert.equal(rejectedChatVersion.response.status, 404);

const rejectedChatRollback = await request(
  `/api/projects/${chatProjectId}/versions`,
  json("POST", { action: "rollback", sourceVersionId: versionOneId }),
  cookie,
);
assert.equal(rejectedChatRollback.response.status, 404);

const rejectedChatVersionEdit = await request(
  `/api/projects/${chatProjectId}/versions`,
  json("PATCH", { versionId: versionOneId, records: [] }),
  cookie,
);
assert.equal(rejectedChatVersionEdit.response.status, 404);

const unchangedChatProject = await request(
  `/api/projects/${chatProjectId}`,
  {},
  cookie,
);
assert.equal(unchangedChatProject.response.status, 200);
assert.equal(unchangedChatProject.body.project.currentVersion, 0);

const emptyChat = await request(
  `/api/projects/${chatProjectId}/chat`,
  {},
  cookie,
);
assert.equal(emptyChat.response.status, 200);
assert.deepEqual(emptyChat.body.memory, { enabled: true, content: "" });
assert.deepEqual(emptyChat.body.messages, []);

const configuredMemory = await request(
  `/api/projects/${chatProjectId}/chat`,
  json("PATCH", {
    memoryEnabled: true,
    memoryContent: "用户希望被称为 Chance。",
  }),
  cookie,
);
assert.equal(configuredMemory.response.status, 200);
assert.deepEqual(configuredMemory.body.memory, {
  enabled: true,
  content: "用户希望被称为 Chance。",
});

const savedTurn = await request(
  `/api/projects/${chatProjectId}/chat`,
  json("POST", {
    userMessage: "请记住我的称呼。",
    assistantMessage: "好的，Chance。",
    provider: "fixture",
    model: "smoke",
  }),
  cookie,
);
assert.equal(savedTurn.response.status, 201);
assert.equal(savedTurn.body.messages.length, 2);
assert.deepEqual(
  savedTurn.body.messages.map((message) => message.role),
  ["user", "assistant"],
);

const persistedChat = await request(
  `/api/projects/${chatProjectId}/chat`,
  {},
  cookie,
);
assert.equal(persistedChat.response.status, 200);
assert.equal(persistedChat.body.messages.length, 2);
assert.equal(persistedChat.body.messages[1].provider, "fixture");
assert.equal(persistedChat.body.memoryContent, "用户希望被称为 Chance。");

const ownedProjects = await request("/api/projects", {}, cookie);
assert.equal(ownedProjects.response.status, 200);
assert.equal(ownedProjects.body.projects.length, 2);
assert.deepEqual(
  new Set(ownedProjects.body.projects.map((project) => project.kind)),
  new Set(["web_app", "chat"]),
);

const isolated = await request("/api/projects");
assert.equal(isolated.response.status, 200);
assert.deepEqual(isolated.body.projects, []);

const isolatedChat = await request(`/api/projects/${chatProjectId}/chat`);
assert.equal(isolatedChat.response.status, 404);

const removedChat = await request(
  `/api/projects/${chatProjectId}`,
  { method: "DELETE" },
  cookie,
);
assert.equal(removedChat.response.status, 200);
assert.equal(removedChat.body.deleted, true);

const deletedChatHistory = await request(
  `/api/projects/${chatProjectId}/chat`,
  {},
  cookie,
);
assert.equal(deletedChatHistory.response.status, 404);

const removed = await request(`/api/projects/${projectId}`, { method: "DELETE" }, cookie);
assert.equal(removed.response.status, 200);
assert.equal(removed.body.deleted, true);

console.log(
  JSON.stringify(
    {
      ok: true,
      baseUrl,
      checks: [
        "home",
        "guest session and GitHub auth boundary",
        "mutation origin boundary",
        "workspace isolation",
        "Web App and chat project persistence",
        "project kind management and deletion",
        "capability boundary between chat and Web App versions",
        "chat history and configured long-term memory",
        "ephemeral gameplay records",
        "BuildPlan and reasoning summary persistence",
        "version evolution",
        "rollback creates a new version",
        "standalone export",
      ],
    },
    null,
    2,
  ),
);
