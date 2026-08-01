import assert from "node:assert/strict";
import test from "node:test";

import {
  AppSpecValidationError,
  BuildPlanValidationError,
  StoredArtifactValidationError,
  compileAppToHtml,
  deterministicAgent,
  isBuildPlan,
  isWebAppArtifact,
  parseBuildPlan,
  parseAppSpec,
  parseRecordsForArtifact,
  parseStoredArtifact,
  reconcileRecordsForSpec,
  validateAppSpec,
  validateBuildPlan,
  validateProject,
  validateRecords,
  validateStoredArtifact,
  validateVersion,
  type AppSpec,
  type BuildPlan,
  type WebAppArtifact,
} from "../lib/index";
import { serializeProject, serializeVersion } from "../db/serializers";

test("deterministic agent recognizes distinct English product prompts", () => {
  const bug = deterministicAgent("Build a bug tracker for a product team");
  const crm = deterministicAgent("Create a lead CRM and sales pipeline");
  const habit = deterministicAgent("Make a daily habit tracker with streaks");
  const expense = deterministicAgent("I need an expense and reimbursement log");
  const task = deterministicAgent("Create a team task and todo tracker");
  const content = deterministicAgent("Create a content calendar and publishing plan");
  const inspection = deterministicAgent("Create an equipment inspection log");

  assert.equal(bug.title, "Bug Tracker");
  assert.equal(bug.features.filterField, "status");
  assert.ok(bug.fields.some((field) => field.id === "priority"));

  assert.equal(crm.title, "Lead Pipeline");
  assert.equal(crm.layout, "cards");
  assert.ok(crm.fields.some((field) => field.id === "dealValue"));

  assert.equal(habit.title, "Habit Garden");
  assert.ok(habit.fields.some((field) => field.type === "checkbox"));

  assert.equal(expense.title, "Expense Ledger");
  assert.ok(expense.fields.some((field) => field.id === "amount"));

  assert.equal(task.title, "Task Board");
  assert.ok(task.fields.some((field) => field.id === "dueDate"));

  assert.equal(content.title, "Content Calendar");
  assert.ok(content.fields.some((field) => field.id === "publishDate"));

  assert.equal(inspection.title, "Equipment Inspections");
  assert.ok(inspection.fields.some((field) => field.id === "riskLevel"));

  assert.notDeepEqual(bug.fields, crm.fields);
  assert.notDeepEqual(habit.seedData, expense.seedData);
});

test("deterministic agent supports Chinese prompts and stable output", () => {
  const prompt = "为产品团队创建一个缺陷追踪器，支持状态筛选和优先级";
  const first = deterministicAgent(prompt);
  const second = deterministicAgent(prompt);

  assert.deepEqual(first, second);
  assert.equal(first.title, "缺陷追踪器");
  assert.equal(first.entityName, "缺陷");
  assert.ok(first.fields.some((field) => field.label === "优先级"));
  assert.equal(first.seedData.length, 3);
  assert.equal(validateAppSpec(first).success, true);
  assert.equal(
    deterministicAgent("Bug tracker with title and status fields").title,
    "Bug Tracker",
  );
});

test("follow-up instructions evolve a previous spec without arbitrary code", () => {
  const original = deterministicAgent("Build a lead CRM");
  const updated = deterministicAgent(
    "Build a lead CRM",
    original,
    "Use a dark theme, add a priority and due date, switch to table view, rename it to Deal Desk",
  );

  assert.equal(updated.title, "Deal Desk");
  assert.equal(updated.theme.background, "#111827");
  assert.equal(updated.layout, "table");
  assert.ok(updated.fields.some((field) => field.id === "priority"));
  assert.ok(updated.fields.some((field) => field.id === "dueDate"));
  assert.equal(original.fields.some((field) => field.id === "priority"), false);
  assert.equal(validateAppSpec(updated).success, true);
});

test("runtime validation rejects malformed fields, filters, colors, and values", () => {
  const valid = deterministicAgent("Build a bug tracker");
  const malformed = {
    ...valid,
    theme: { accent: "javascript:alert(1)", background: "#ffffff" },
    fields: [valid.fields[0], { ...valid.fields[0] }],
    features: { ...valid.features, filterField: "missing" },
    seedData: [
      {
        id: "bad record id with spaces",
        values: [{ fieldId: valid.fields[0].id, value: false }],
      },
    ],
  };
  const result = validateAppSpec(malformed);

  assert.equal(result.success, false);
  if (!result.success) {
    const paths = result.issues.map((entry) => entry.path);
    assert.ok(paths.includes("theme.accent"));
    assert.ok(paths.includes("fields"));
    assert.ok(paths.includes("features.filterField"));
    assert.ok(paths.includes("seedData[0].id"));
    assert.ok(paths.includes("seedData[0].values[0].value"));
  }
  assert.throws(() => parseAppSpec(malformed), AppSpecValidationError);
});

test("record, project, and version validation work at runtime", () => {
  const spec = deterministicAgent("Create a task tracker");
  assert.equal(validateRecords(spec.seedData, spec).success, true);
  assert.equal(
    validateRecords(
      [{ id: "row-1", values: [{ fieldId: "priority", value: "Impossible" }] }],
      spec,
    ).success,
    false,
  );

  const project = {
    id: "project-1",
    name: "Task Board",
    prompt: "Create a task tracker",
    status: "ready",
    currentVersionId: "version-1",
    records: spec.seedData,
    createdAt: "2026-07-31T08:00:00.000Z",
    updatedAt: "2026-07-31T08:00:00.000Z",
  };
  const version = {
    id: "version-1",
    projectId: "project-1",
    number: 1,
    instruction: null,
    spec,
    createdAt: "2026-07-31T08:00:00.000Z",
  };
  assert.equal(validateProject(project).success, true);
  assert.equal(validateVersion(version).success, true);
  assert.equal(validateVersion({ ...version, number: 0 }).success, false);
});

test("stored artifacts accept legacy AppSpec and self-contained web apps", () => {
  const legacy = deterministicAgent("Create a task tracker");
  assert.deepEqual(parseStoredArtifact(legacy), legacy);
  assert.equal(isWebAppArtifact(legacy), false);

  const webApp: WebAppArtifact = {
    schemaVersion: 1,
    kind: "web_app",
    title: "Snake",
    description: "A playable snake game",
    html: "<!doctype html><html><body><canvas></canvas><script></script></body></html>",
    acceptanceCriteria: ["Arrow keys move the snake", "Restart begins a new game"],
  };
  assert.deepEqual(parseStoredArtifact(webApp), webApp);
  assert.equal(isWebAppArtifact(webApp), true);
  assert.equal(validateStoredArtifact(webApp).success, true);
  assert.deepEqual(
    parseRecordsForArtifact([{ id: "ignored", values: [] }], webApp),
    [],
  );
  assert.equal(
    validateVersion({
      id: "version-web-1",
      projectId: "project-web-1",
      number: 1,
      instruction: null,
      spec: webApp,
      createdAt: "2026-08-01T08:00:00.000Z",
    }).success,
    true,
  );

  assert.throws(
    () => parseStoredArtifact({ ...webApp, html: "   " }),
    StoredArtifactValidationError,
  );
  assert.equal(
    validateStoredArtifact({ ...legacy, kind: "unknown" }).success,
    false,
  );
});

test("build plans validate and parse a model-authored Web App plan", () => {
  const plan: BuildPlan = {
    schemaVersion: 1,
    kind: "web_app_plan",
    title: "Build a playable Tetris game",
    requestSummary: "Create a self-contained browser game with keyboard controls.",
    designDecisions: [
      "Use a canvas for deterministic board rendering.",
      "Keep all game state inside the generated document.",
    ],
    interactionFlow: [
      "The player starts a new game.",
      "Keyboard input moves and rotates the active piece.",
    ],
    implementationSteps: [
      {
        title: "Create the game model",
        description: "Represent the board, active piece, collision, and line clearing.",
      },
      {
        title: "Build the interaction loop",
        description: "Connect rendering, timed drops, keyboard input, and restart.",
      },
    ],
    assumptions: ["The generated app does not persist an in-progress game."],
    acceptanceCriteria: [
      "A player can move and rotate pieces.",
      "Completed lines are removed and scored.",
    ],
  };

  assert.deepEqual(parseBuildPlan(plan), plan);
  assert.equal(validateBuildPlan(plan).success, true);
  assert.equal(isBuildPlan(plan), true);
  assert.equal(isWebAppArtifact(plan), false);
});

test("build plan validation rejects malformed structure and bounded content", () => {
  const malformed = {
    schemaVersion: 2,
    kind: "web_app",
    title: " ",
    requestSummary: "x".repeat(1_201),
    designDecisions: [],
    interactionFlow: Array.from({ length: 17 }, (_, index) => `Flow ${index}`),
    implementationSteps: [
      { title: "Valid title" },
      ...Array.from({ length: 12 }, () => ({ title: "Step", description: "Do it" })),
    ],
    assumptions: "none",
    acceptanceCriteria: [],
  };
  const result = validateBuildPlan(malformed);

  assert.equal(result.success, false);
  assert.equal(isBuildPlan(malformed), false);
  if (!result.success) {
    const paths = result.issues.map((entry) => entry.path);
    assert.ok(paths.includes("schemaVersion"));
    assert.ok(paths.includes("kind"));
    assert.ok(paths.includes("title"));
    assert.ok(paths.includes("requestSummary"));
    assert.ok(paths.includes("designDecisions"));
    assert.ok(paths.includes("interactionFlow"));
    assert.ok(paths.includes("implementationSteps"));
    assert.ok(paths.includes("implementationSteps[0].description"));
    assert.ok(paths.includes("assumptions"));
    assert.ok(paths.includes("acceptanceCriteria"));
  }
  assert.throws(() => parseBuildPlan(malformed), BuildPlanValidationError);
});

test("database serializers expose artifact aliases and clear web app records", () => {
  const artifact: WebAppArtifact = {
    schemaVersion: 1,
    kind: "web_app",
    title: "Snake",
    description: "A playable snake game",
    html: "<!doctype html><title>Snake</title>",
    acceptanceCriteria: ["The game starts"],
  };
  const buildPlan: BuildPlan = {
    schemaVersion: 1,
    kind: "web_app_plan",
    title: "Plan Snake",
    requestSummary: "Create a playable snake game.",
    designDecisions: ["Use canvas rendering."],
    interactionFlow: ["Start and move the snake."],
    implementationSteps: [{ title: "Build game", description: "Implement the loop." }],
    assumptions: [],
    acceptanceCriteria: ["The snake can move."],
  };
  const stored = JSON.stringify(artifact);
  const row = {
    id: "version-1",
    project_id: "project-1",
    workspace_id: "workspace-1",
    title: "Snake",
    prompt: "Build snake",
    current_spec: stored,
    spec: stored,
    records: JSON.stringify([{ id: "stale", values: [] }]),
    current_version: 1,
    version: 1,
    instruction: "",
    provider: "openai",
    model: "test-model",
    warning: null,
    build_plan: JSON.stringify(buildPlan),
    reasoning_summary: JSON.stringify(["Canvas keeps the game loop compact."]),
    stages: "[]",
    created_at: "2026-08-01T08:00:00.000Z",
    updated_at: "2026-08-01T08:00:00.000Z",
  };

  const project = serializeProject(row);
  const version = serializeVersion(row);
  assert.deepEqual(project.artifact, artifact);
  assert.deepEqual(project.spec, artifact);
  assert.deepEqual(project.records, []);
  assert.deepEqual(version.artifact, artifact);
  assert.deepEqual(version.spec, artifact);
  assert.deepEqual(version.records, []);
  assert.deepEqual(version.buildPlan, buildPlan);
  assert.deepEqual(version.reasoningSummary, ["Canvas keeps the game loop compact."]);
});

test("compiler emits a complete, sandbox-friendly CRUD application", () => {
  const spec = deterministicAgent("Create a bug tracker");
  const html = compileAppToHtml(spec, spec.seedData, "project-42");

  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /id="search-input"/);
  assert.match(html, /id="filter-select"/);
  assert.match(html, /id="record-form"/);
  assert.match(html, /function openEditor/);
  assert.match(html, /function removeRecord/);
  assert.match(html, /type: "records-change"/);
  assert.match(html, /source: "forge-preview"/);
  assert.match(html, /projectId, records: snapshot/);
  assert.match(html, /Bug Tracker/);
  assert.match(html, /Coupon total does not refresh/);
  assert.doesNotMatch(html, /\beval\s*\(|new Function\s*\(/);
});

test("compiler escapes hostile text before embedding it in HTML", () => {
  const base = deterministicAgent("Build a generic tracker");
  const hostile = "</script><img src=x onerror=alert('owned')>";
  const spec: AppSpec = {
    ...base,
    title: hostile,
    description: "Safe & sound <script>alert(1)</script>",
    seedData: [
      {
        id: "safe-row",
        values: [{ fieldId: base.fields[0].id, value: hostile }],
      },
    ],
  };
  const html = compileAppToHtml(spec, spec.seedData, "project-safe");

  assert.doesNotMatch(html, /<img src=x onerror=/);
  assert.doesNotMatch(html, /Safe & sound <script>/);
  assert.match(html, /\\u003c\/script\\u003e\\u003cimg/);
  assert.match(html, /Safe \\u0026 sound \\u003cscript\\u003e/);
});

test("compiler refuses records that do not conform to the current spec", () => {
  const spec = deterministicAgent("Build an expense tracker");
  assert.throws(
    () =>
      compileAppToHtml(
        spec,
        [{ id: "expense-x", values: [{ fieldId: "amount", value: "not-a-number" }] }],
        "project-expenses",
      ),
    AppSpecValidationError,
  );
  assert.throws(() => compileAppToHtml(spec, spec.seedData, ""), /projectId/);
});

test("schema refinement preserves compatible records without reviving deleted data", () => {
  const previous = deterministicAgent("Build a task tracker");
  const refined: AppSpec = {
    ...previous,
    seedData: [],
    fields: previous.fields
      .filter((field) => field.id !== "owner")
      .map((field) =>
        field.id === "priority" ? { ...field, options: ["High", "Low"] } : field,
      ),
  };
  const source = [
    {
      id: "task-preserved",
      values: [
        { fieldId: "task", value: "Ship the demo" },
        { fieldId: "owner", value: "Chance" },
        { fieldId: "priority", value: "Medium" },
      ],
    },
  ];

  assert.deepEqual(reconcileRecordsForSpec([], refined), []);
  assert.deepEqual(reconcileRecordsForSpec(source, refined), [
    {
      id: "task-preserved",
      values: [{ fieldId: "task", value: "Ship the demo" }],
    },
  ]);
  assert.equal(
    validateRecords(reconcileRecordsForSpec(source, refined), refined).success,
    true,
  );
});
