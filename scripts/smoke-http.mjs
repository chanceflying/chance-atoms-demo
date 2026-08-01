import assert from "node:assert/strict";

const baseUrl = (process.env.CHANCE_ATOMS_BASE_URL || "http://127.0.0.1:8787").replace(
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

const home = await fetch(`${baseUrl}/`);
assert.equal(home.status, 200);
assert.match(await home.text(), /从一句话到可运行工具/);

const initial = await request("/api/projects");
assert.equal(initial.response.status, 200);
const cookie = (initial.response.headers.get("set-cookie") || "").split(";")[0];
assert.match(cookie, /^atoms_workspace=/);
assert.deepEqual(initial.body.projects, []);

const generated = await request(
  "/api/generate",
  json("POST", {
    prompt: "做一个任务管理工具，包含任务、状态、优先级、负责人和截止日期",
  }),
  cookie,
);
assert.equal(generated.response.status, 200);
assert.equal(generated.body.provider, "local");
assert.ok(generated.body.spec.fields.length >= 4);

const created = await request(
  "/api/projects",
  json("POST", { name: "HTTP smoke project", prompt: "任务管理工具" }),
  cookie,
);
assert.equal(created.response.status, 201);
const projectId = created.body.project.id;

const versionOne = await request(
  `/api/projects/${projectId}/versions`,
  json("POST", {
    spec: generated.body.spec,
    records: generated.body.spec.seedData,
    prompt: "任务管理工具",
    provider: "local",
    stages: ["smoke"],
  }),
  cookie,
);
assert.equal(versionOne.response.status, 201);
assert.equal(versionOne.body.version.version, 1);
const versionOneId = versionOne.body.version.id;

const emptied = await request(
  `/api/projects/${projectId}/versions`,
  json("PATCH", { versionId: versionOneId, records: [] }),
  cookie,
);
assert.equal(emptied.response.status, 200);
assert.deepEqual(emptied.body.project.records, []);

const afterEmpty = await request(`/api/projects/${projectId}/versions`, {}, cookie);
assert.equal(afterEmpty.response.status, 200);
assert.deepEqual(afterEmpty.body.versions[0].records, []);

const refined = await request(
  "/api/generate",
  json("POST", {
    prompt: "任务管理工具",
    previousSpec: generated.body.spec,
    instruction: "增加电话号码字段，并改成卡片布局",
  }),
  cookie,
);
assert.equal(refined.response.status, 200);
assert.ok(refined.body.spec.fields.some((field) => field.id === "phone"));
assert.equal(refined.body.spec.layout, "cards");

const versionTwo = await request(
  `/api/projects/${projectId}/versions`,
  json("POST", {
    spec: refined.body.spec,
    records: [],
    prompt: "任务管理工具",
    instruction: "增加电话号码字段，并改成卡片布局",
    provider: "local",
    stages: ["smoke"],
  }),
  cookie,
);
assert.equal(versionTwo.response.status, 201);
assert.equal(versionTwo.body.version.version, 2);

const invalidRecords = await request(
  `/api/projects/${projectId}/versions`,
  json("PATCH", {
    versionId: versionTwo.body.version.id,
    records: [{ id: "bad-record", values: [{ fieldId: "unknown", value: "x" }] }],
  }),
  cookie,
);
assert.equal(invalidRecords.response.status, 400);

const rolledBack = await request(
  `/api/projects/${projectId}/versions`,
  json("POST", { action: "rollback", sourceVersionId: versionOneId }),
  cookie,
);
assert.equal(rolledBack.response.status, 201);
assert.equal(rolledBack.body.version.version, 3);
assert.deepEqual(rolledBack.body.version.records, []);

const archive = await request(
  "/api/export",
  json("POST", {
    spec: rolledBack.body.version.spec,
    records: rolledBack.body.version.records,
    projectId,
  }),
  cookie,
);
assert.equal(archive.response.status, 200);
assert.equal(archive.response.headers.get("content-type"), "application/zip");
assert.deepEqual(Array.from(new Uint8Array(archive.body).slice(0, 4)), [0x50, 0x4b, 0x03, 0x04]);

const isolated = await request("/api/projects");
assert.equal(isolated.response.status, 200);
assert.deepEqual(isolated.body.projects, []);

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
        "workspace isolation",
        "fallback generation",
        "project persistence",
        "empty records",
        "refinement",
        "server validation",
        "rollback",
        "standalone export",
      ],
    },
    null,
    2,
  ),
);
