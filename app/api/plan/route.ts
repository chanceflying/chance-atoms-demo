import { NextResponse } from "next/server";
import {
  isWebAppArtifact,
  parseBuildPlan,
  parseStoredArtifact,
  type WebAppArtifact,
} from "@/lib";

const MAX_INPUT_LENGTH = 12_000;
const MAX_REQUEST_BYTES = 720_000;
const DEFAULT_MODEL = "gpt-5.6-terra";

const buildPlanSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "kind",
    "title",
    "requestSummary",
    "designDecisions",
    "interactionFlow",
    "implementationSteps",
    "assumptions",
    "acceptanceCriteria",
  ],
  properties: {
    schemaVersion: { type: "integer", const: 1 },
    kind: { type: "string", enum: ["web_app_plan"] },
    title: { type: "string", minLength: 1, maxLength: 100 },
    requestSummary: { type: "string", minLength: 1, maxLength: 1_200 },
    designDecisions: {
      type: "array",
      minItems: 1,
      maxItems: 12,
      items: { type: "string", minLength: 1, maxLength: 500 },
    },
    interactionFlow: {
      type: "array",
      minItems: 1,
      maxItems: 16,
      items: { type: "string", minLength: 1, maxLength: 300 },
    },
    implementationSteps: {
      type: "array",
      minItems: 1,
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "description"],
        properties: {
          title: { type: "string", minLength: 1, maxLength: 120 },
          description: { type: "string", minLength: 1, maxLength: 600 },
        },
      },
    },
    assumptions: {
      type: "array",
      maxItems: 12,
      items: { type: "string", minLength: 1, maxLength: 400 },
    },
    acceptanceCriteria: {
      type: "array",
      minItems: 1,
      maxItems: 16,
      items: { type: "string", minLength: 1, maxLength: 400 },
    },
  },
} as const;

type PlanBody = {
  prompt?: unknown;
  instruction?: unknown;
  previousArtifact?: unknown;
};

export async function POST(request: Request) {
  const parsedBody = await readPlanBody(request);
  if (parsedBody instanceof Response) return parsedBody;

  const prompt = cleanText(parsedBody.prompt);
  const instruction = cleanText(parsedBody.instruction);
  if (!prompt && !instruction) {
    return NextResponse.json(
      { error: "请先描述你想创建或修改的 Web App。" },
      { status: 400 },
    );
  }
  if (prompt.length > MAX_INPUT_LENGTH || instruction.length > MAX_INPUT_LENGTH) {
    return NextResponse.json(
      { error: `单次描述请控制在 ${MAX_INPUT_LENGTH} 字以内。` },
      { status: 400 },
    );
  }

  let previousArtifact: WebAppArtifact | undefined;
  if (parsedBody.previousArtifact !== undefined && parsedBody.previousArtifact !== null) {
    try {
      const parsed = parseStoredArtifact(parsedBody.previousArtifact);
      if (!isWebAppArtifact(parsed)) throw new TypeError("Expected WebAppArtifact");
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
  if (!apiKey) {
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

  try {
    const result = await planWithOpenAI({
      apiKey,
      model,
      prompt,
      instruction,
      previousArtifact,
    });
    return NextResponse.json({
      ...result,
      provider: "openai",
      model,
    });
  } catch (error) {
    console.error("OpenAI Web App planning failed", error);
    return NextResponse.json(
      { error: "真实模型规划失败，请稍后重试。" },
      { status: 502 },
    );
  }
}

async function planWithOpenAI({
  apiKey,
  model,
  prompt,
  instruction,
  previousArtifact,
}: {
  apiKey: string;
  model: string;
  prompt: string;
  instruction: string;
  previousArtifact?: WebAppArtifact;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  const task = previousArtifact
    ? [
        "Plan the next version of the existing self-contained Web App.",
        `Original request: ${prompt || previousArtifact.description}`,
        `Change request: ${instruction}`,
        `Existing artifact: ${JSON.stringify(previousArtifact)}`,
      ].join("\n\n")
    : `Plan a self-contained Web App for this request:\n\n${prompt || instruction}`;

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
        reasoning: { effort: "low", summary: "auto" },
        input: [
          {
            role: "system",
            content:
              "You are the planning stage of Chance Atoms. Return only the requested BuildPlan. Produce a concrete plan for one self-contained HTML/CSS/JavaScript Web App. The plan must reflect the user's actual request and existing artifact, not a generic fixed checklist. Cover product behavior, interaction design, implementation steps, assumptions, and testable acceptance criteria. Do not generate code yet. Runtime data is ephemeral; project source and versions are persisted by the host application.",
          },
          { role: "user", content: task },
        ],
        text: {
          verbosity: "low",
          format: {
            type: "json_schema",
            name: "chance_web_app_build_plan",
            strict: true,
            schema: buildPlanSchema,
          },
        },
        max_output_tokens: 6_000,
      }),
    });

    if (!response.ok) throw new Error(`OpenAI returned ${response.status}`);
    const payload = (await response.json()) as unknown;
    const outputText = extractOutputText(payload);
    if (!outputText) throw new Error("OpenAI response contained no BuildPlan");
    return {
      plan: parseBuildPlan(JSON.parse(outputText)),
      reasoningSummary: extractReasoningSummary(payload),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readPlanBody(request: Request): Promise<PlanBody | Response> {
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
    return parsed as PlanBody;
  } catch {
    return NextResponse.json({ error: "请求格式无效。" }, { status: 400 });
  }
}

function extractOutputText(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  if (typeof payload.output_text === "string") return payload.output_text;
  if (!Array.isArray(payload.output)) return null;
  for (const item of payload.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (isRecord(part) && part.type === "output_text" && typeof part.text === "string") {
        return part.text;
      }
    }
  }
  return null;
}

function extractReasoningSummary(payload: unknown): string[] {
  if (!isRecord(payload) || !Array.isArray(payload.output)) return [];
  const summaries: string[] = [];
  for (const item of payload.output) {
    if (!isRecord(item) || item.type !== "reasoning" || !Array.isArray(item.summary)) {
      continue;
    }
    for (const part of item.summary) {
      if (isRecord(part) && typeof part.text === "string" && part.text.trim()) {
        summaries.push(part.text.trim().slice(0, 2_000));
      }
    }
  }
  return summaries.slice(0, 8);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
