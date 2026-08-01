import { NextResponse } from "next/server";
import {
  deterministicAgent,
  parseAppSpec,
  type AppSpec,
} from "@/lib";

const MAX_PROMPT_LENGTH = 1_200;
const MAX_REQUEST_BYTES = 64_000;
const DEFAULT_MODEL = "gpt-5.6-terra";

const appSpecSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "title",
    "description",
    "entityName",
    "entityNamePlural",
    "layout",
    "theme",
    "fields",
    "features",
    "seedData",
    "acceptanceCriteria",
  ],
  properties: {
    schemaVersion: { type: "number", enum: [1] },
    title: { type: "string", minLength: 1, maxLength: 48 },
    description: { type: "string", minLength: 1, maxLength: 180 },
    entityName: { type: "string", minLength: 1, maxLength: 24 },
    entityNamePlural: { type: "string", minLength: 1, maxLength: 32 },
    layout: { type: "string", enum: ["table", "cards"] },
    theme: {
      type: "object",
      additionalProperties: false,
      required: ["accent", "background"],
      properties: {
        accent: {
          type: "string",
          description: "A readable CSS hex color, for example #4F46E5",
          pattern: "^#[0-9A-Fa-f]{6}$",
        },
        background: {
          type: "string",
          description: "A readable CSS hex background color, for example #F5F7FB",
          pattern: "^#[0-9A-Fa-f]{6}$",
        },
      },
    },
    fields: {
      type: "array",
      minItems: 3,
      maxItems: 7,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "label",
          "type",
          "required",
          "placeholder",
          "options",
        ],
        properties: {
          id: { type: "string", pattern: "^[a-z][a-z0-9_]{0,23}$" },
          label: { type: "string", minLength: 1, maxLength: 24 },
          type: {
            type: "string",
            enum: [
              "text",
              "textarea",
              "number",
              "date",
              "select",
              "checkbox",
            ],
          },
          required: { type: "boolean" },
          placeholder: { type: "string", maxLength: 60 },
          options: {
            type: "array",
            maxItems: 8,
            items: { type: "string", minLength: 1, maxLength: 24 },
          },
        },
      },
    },
    features: {
      type: "object",
      additionalProperties: false,
      required: ["search", "stats", "filterField"],
      properties: {
        search: { type: "boolean" },
        stats: { type: "boolean" },
        filterField: { type: ["string", "null"] },
      },
    },
    seedData: {
      type: "array",
      minItems: 2,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "values"],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 48 },
          values: {
            type: "array",
            maxItems: 7,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["fieldId", "value"],
              properties: {
                fieldId: { type: "string" },
                value: { type: ["string", "number", "boolean"] },
              },
            },
          },
        },
      },
    },
    acceptanceCriteria: {
      type: "array",
      minItems: 3,
      maxItems: 6,
      items: { type: "string", minLength: 1, maxLength: 90 },
    },
  },
} as const;

type GenerateBody = {
  prompt?: unknown;
  previousSpec?: unknown;
  instruction?: unknown;
};

export async function POST(request: Request) {
  let body: GenerateBody;

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
    body = parsed as GenerateBody;
  } catch {
    return NextResponse.json(
      { error: "请求格式无效，请重新输入。" },
      { status: 400 },
    );
  }

  const prompt = cleanText(body.prompt);
  const instruction = cleanText(body.instruction);

  if (!prompt && !instruction) {
    return NextResponse.json(
      { error: "请先描述你想创建或修改的应用。" },
      { status: 400 },
    );
  }

  if (prompt.length > MAX_PROMPT_LENGTH || instruction.length > MAX_PROMPT_LENGTH) {
    return NextResponse.json(
      { error: `单次描述请控制在 ${MAX_PROMPT_LENGTH} 字以内。` },
      { status: 400 },
    );
  }

  let previousSpec: AppSpec | undefined;
  if (body.previousSpec) {
    try {
      previousSpec = parseAppSpec(body.previousSpec);
    } catch {
      return NextResponse.json(
        { error: "当前版本的数据不完整，请刷新后重试。" },
        { status: 400 },
      );
    }
  }

  const fallback = () =>
    deterministicAgent(prompt || previousSpec?.description || instruction, previousSpec, instruction);
  const fallbackResponse = (warning: string, stages: string[]) => {
    const spec = fallback();
    if (previousSpec && JSON.stringify(spec) === JSON.stringify(previousSpec)) {
      return NextResponse.json(
        {
          error:
            "本地演示 Agent 没有识别出这次调整。可以尝试修改标题、布局、主题、字段或筛选方式；配置模型密钥后可理解更自由的描述。",
        },
        { status: 422 },
      );
    }
    return NextResponse.json({
      spec,
      provider: "local",
      model: null,
      warning,
      stages,
    });
  };

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;

  if (!apiKey) {
    return fallbackResponse(
      "当前使用本地 Agent 演示模式；配置模型密钥后会自动切换为真实 AI。",
      ["理解需求", "生成 AppSpec", "校验结构", "准备预览"],
    );
  }

  try {
    const spec = await generateWithOpenAI({
      apiKey,
      model,
      prompt,
      instruction,
      previousSpec,
    });

    return NextResponse.json({
      spec,
      provider: "openai",
      model,
      warning: null,
      stages: ["AI 规划", "生成 AppSpec", "安全校验", "准备预览"],
    });
  } catch (error) {
    console.error("OpenAI generation failed; using local fallback", error);
    return fallbackResponse(
      "AI 服务暂时不可用，已切换到本地 Agent，完整流程仍可体验。",
      ["AI 服务降级", "本地规划", "校验结构", "准备预览"],
    );
  }
}

async function generateWithOpenAI({
  apiKey,
  model,
  prompt,
  instruction,
  previousSpec,
}: {
  apiKey: string;
  model: string;
  prompt: string;
  instruction: string;
  previousSpec?: AppSpec;
}): Promise<AppSpec> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 24_000);

  const task = previousSpec
    ? [
        "Update the existing AppSpec according to the user's instruction.",
        `Original request: ${prompt || previousSpec.description}`,
        `Change request: ${instruction}`,
        `Existing AppSpec: ${JSON.stringify(previousSpec)}`,
      ].join("\n\n")
    : `Create an AppSpec from this request:\n\n${prompt}`;

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
              "You are Forge Planner. Turn a product request into one compact, useful single-entity CRUD web app. Return only the requested AppSpec. Use concise Chinese labels when the request is Chinese. Keep field IDs in snake_case English. Prefer 4-6 fields, one select field for filtering, realistic seed data, and testable acceptance criteria. Never emit JavaScript, HTML, URLs, secrets, or executable expressions. When updating a prior spec, preserve working fields and data unless the user explicitly asks to remove them.",
          },
          { role: "user", content: task },
        ],
        text: {
          verbosity: "low",
          format: {
            type: "json_schema",
            name: "forge_app_spec",
            strict: true,
            schema: appSpecSchema,
          },
        },
        max_output_tokens: 5_000,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI returned ${response.status}`);
    }

    const payload = (await response.json()) as unknown;
    const outputText = extractOutputText(payload);
    if (!outputText) throw new Error("OpenAI response contained no output text");

    return parseAppSpec(JSON.parse(outputText));
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
      const partRecord = part as Record<string, unknown>;
      if (partRecord.type === "output_text" && typeof partRecord.text === "string") {
        return partRecord.text;
      }
    }
  }
  return null;
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
