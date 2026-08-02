import { NextResponse } from "next/server";
import {
  isWebAppArtifact,
  parseBuildPlan,
  parseStoredArtifact,
  type BuildPlan,
  type WebAppArtifact,
} from "@/lib";
import {
  getRemoteCodexConfig,
  remoteCodexModel,
  requestRemoteCodex,
} from "@/lib/remote-codex";

const MAX_PROMPT_LENGTH = 12_000;
const MAX_REQUEST_BYTES = 720_000;
const MAX_GENERATED_HTML_LENGTH = 300_000;
const DEFAULT_MODEL = "gpt-5.6-terra";

const webAppArtifactSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "kind",
    "title",
    "description",
    "html",
    "acceptanceCriteria",
  ],
  properties: {
    schemaVersion: { type: "number", enum: [1] },
    kind: { type: "string", enum: ["web_app"] },
    title: { type: "string", minLength: 1, maxLength: 80 },
    description: { type: "string", minLength: 1, maxLength: 500 },
    html: {
      type: "string",
      minLength: 200,
      maxLength: MAX_GENERATED_HTML_LENGTH,
      description:
        "A complete self-contained index.html with inline CSS and JavaScript and no external dependencies.",
    },
    acceptanceCriteria: {
      type: "array",
      minItems: 1,
      maxItems: 12,
      items: { type: "string", minLength: 1, maxLength: 300 },
    },
  },
} as const;

type GenerateBody = {
  prompt?: unknown;
  previousArtifact?: unknown;
  instruction?: unknown;
  plan?: unknown;
};

export async function POST(request: Request) {
  const parsedBody = await readGenerateBody(request);
  if (parsedBody instanceof Response) return parsedBody;

  const prompt = cleanText(parsedBody.prompt);
  const instruction = cleanText(parsedBody.instruction);
  if (!prompt && !instruction) {
    return NextResponse.json(
      { error: "请先描述你想创建或修改的 Web App。" },
      { status: 400 },
    );
  }
  if (prompt.length > MAX_PROMPT_LENGTH || instruction.length > MAX_PROMPT_LENGTH) {
    return NextResponse.json(
      { error: `单次描述请控制在 ${MAX_PROMPT_LENGTH} 字以内。` },
      { status: 400 },
    );
  }

  let plan: BuildPlan;
  try {
    plan = parseBuildPlan(parsedBody.plan);
  } catch {
    return NextResponse.json(
      { error: "请先让模型生成并确认构建方案。" },
      { status: 400 },
    );
  }

  let previousArtifact: WebAppArtifact | undefined;
  if (parsedBody.previousArtifact !== undefined && parsedBody.previousArtifact !== null) {
    try {
      const parsed = parseStoredArtifact(parsedBody.previousArtifact);
      if (!isWebAppArtifact(parsed)) throw new TypeError("Expected a WebAppArtifact");
      previousArtifact = parsed;
    } catch {
      return NextResponse.json(
        { error: "当前 Web App 版本数据不完整，请刷新后重试。" },
        { status: 400 },
      );
    }
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
  let remoteConfig: ReturnType<typeof getRemoteCodexConfig> = null;
  if (!apiKey) {
    try {
      remoteConfig = getRemoteCodexConfig();
    } catch (error) {
      console.error("Remote Codex configuration is invalid", error);
      return NextResponse.json(
        { error: "远程 Codex 配置无效，请检查服务端环境变量。" },
        { status: 502 },
      );
    }
  }
  if (!apiKey && !remoteConfig) {
    return NextResponse.json(
      {
        error:
          "线上模型暂未配置。请在本机运行 npm run model:bridge，或稍后配置 OPENAI_API_KEY。",
        code: "OPENAI_NOT_CONFIGURED",
        provider: "unavailable",
      },
      { status: 503 },
    );
  }

  if (!apiKey && remoteConfig) {
    try {
      const payload = await requestRemoteCodex(
        remoteConfig,
        "generate",
        { prompt, instruction, plan, previousArtifact },
        130_000,
      );
      const artifact = parseStoredArtifact(payload.artifact);
      if (!isWebAppArtifact(artifact)) {
        throw new TypeError("Remote Codex did not return a WebAppArtifact");
      }
      if (artifact.html.length > MAX_GENERATED_HTML_LENGTH) {
        throw new TypeError("Generated HTML is too large");
      }
      return NextResponse.json({
        artifact,
        spec: artifact,
        provider: "remote_codex",
        model: remoteCodexModel(payload),
        warning: null,
        stages: ["远程 Codex 已返回 Web App", "Artifact 结构校验通过"],
      });
    } catch (error) {
      console.error("Remote Codex Web App generation failed", error);
      return NextResponse.json(
        { error: "远程 Codex 生成失败，请稍后重试。" },
        { status: 502 },
      );
    }
  }

  if (!apiKey) {
    return NextResponse.json(
      { error: "模型服务配置无效。" },
      { status: 502 },
    );
  }

  try {
    const artifact = await generateWebAppWithOpenAI({
      apiKey,
      model,
      prompt,
      instruction,
      plan,
      previousArtifact,
    });
    return NextResponse.json({
      artifact,
      spec: artifact,
      provider: "openai",
      model,
      warning: null,
      stages: ["模型已返回 Web App", "Artifact 结构校验通过"],
    });
  } catch (error) {
    console.error("OpenAI Web App generation failed", error);
    return NextResponse.json(
      { error: "真实模型生成失败，请稍后重试。" },
      { status: 502 },
    );
  }
}

async function readGenerateBody(request: Request): Promise<GenerateBody | Response> {
  try {
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
      return NextResponse.json({ error: "请求内容过大。" }, { status: 413 });
    }
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) {
      return NextResponse.json({ error: "请求内容过大。" }, { status: 413 });
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new TypeError("Body must be an object");
    }
    return parsed as GenerateBody;
  } catch {
    return NextResponse.json(
      { error: "请求格式无效，请重新输入。" },
      { status: 400 },
    );
  }
}

async function generateWebAppWithOpenAI({
  apiKey,
  model,
  prompt,
  instruction,
  plan,
  previousArtifact,
}: {
  apiKey: string;
  model: string;
  prompt: string;
  instruction: string;
  plan: BuildPlan;
  previousArtifact?: WebAppArtifact;
}): Promise<WebAppArtifact> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  const task = previousArtifact
    ? [
        "Update the existing self-contained Web App according to the approved plan and change request.",
        `Original request: ${prompt || previousArtifact.description}`,
        `Change request: ${instruction}`,
        `Approved build plan: ${JSON.stringify(plan)}`,
        `Existing artifact: ${JSON.stringify(previousArtifact)}`,
      ].join("\n\n")
    : [
        "Create a complete self-contained Web App for the request.",
        `User request: ${prompt || instruction}`,
        `Approved build plan: ${JSON.stringify(plan)}`,
      ].join("\n\n");

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        reasoning: { effort: "low" },
        input: [
          {
            role: "system",
            content:
              "You are Chance Atoms Web App Builder. Return only the requested WebAppArtifact. Follow the approved BuildPlan. The html must be one complete index.html with all CSS and JavaScript inline. Do not use npm, imports, CDNs, remote images, fetch, external fonts, network requests, localStorage, or server dependencies. Runtime state is intentionally ephemeral. Make the result immediately usable in a sandboxed iframe, keyboard accessible, touch friendly, and responsive. Match the user's language. For games, implement the complete game loop, controls, scoring, game-over state, and restart behavior. Preserve working behavior when refining an existing artifact.",
          },
          { role: "user", content: task },
        ],
        text: {
          verbosity: "low",
          format: {
            type: "json_schema",
            name: "chance_web_app_artifact",
            strict: true,
            schema: webAppArtifactSchema,
          },
        },
        max_output_tokens: 32_000,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI returned ${response.status}`);
    }

    const payload = (await response.json()) as unknown;
    const outputText = extractOutputText(payload);
    if (!outputText) throw new Error("OpenAI response contained no output text");
    const artifact = parseStoredArtifact(JSON.parse(outputText));
    if (!isWebAppArtifact(artifact)) {
      throw new TypeError("OpenAI did not return a WebAppArtifact");
    }
    if (artifact.html.length > MAX_GENERATED_HTML_LENGTH) {
      throw new TypeError("Generated HTML is too large");
    }
    return artifact;
  } finally {
    clearTimeout(timeout);
  }
}

function extractOutputText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.output_text === "string") return record.output_text;
  if (!Array.isArray(record.output)) return null;

  for (const item of record.output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const value = part as Record<string, unknown>;
      if (value.type === "output_text" && typeof value.text === "string") {
        return value.text;
      }
    }
  }
  return null;
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
