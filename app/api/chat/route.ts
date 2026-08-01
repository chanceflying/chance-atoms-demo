import { NextResponse } from "next/server";
import { summarizeInitialProjectTitle } from "@/lib/project-title";

const MAX_MESSAGE_LENGTH = 12_000;
const MAX_MEMORY_LENGTH = 12_000;
const MAX_HISTORY_ITEMS = 40;
const MAX_REQUEST_BYTES = 512_000;
const MAX_REPLY_LENGTH = 20_000;
const MAX_TITLE_LENGTH = 48;
const DEFAULT_CHAT_TITLE = "新对话";
const DEFAULT_MODEL = "gpt-5.6-terra";
const GENERIC_TITLE_KEYS = new Set([
  "主题讨论",
  "问题讨论",
  "话题讨论",
  "普通对话",
  "对话",
  "聊天",
  "discussion",
  "conversation",
  "chat",
  "newconversation",
  "newchat",
]);
const MECHANICAL_TITLE_SUFFIXES = new Set([
  "主题讨论",
  "问题讨论",
  "话题讨论",
  "讨论",
  "总结",
  "概述",
  "discussion",
  "summary",
  "topic",
  "chat",
]);

const chatResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "title"],
  properties: {
    reply: { type: "string", minLength: 1, maxLength: MAX_REPLY_LENGTH },
    title: { type: "string", minLength: 1, maxLength: MAX_TITLE_LENGTH },
  },
} as const;

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatBody = {
  message?: unknown;
  history?: unknown;
  memory?: unknown;
};

type ChatResult = {
  reply: string;
  title: string;
};

export async function POST(request: Request) {
  const parsedBody = await readChatBody(request);
  if (parsedBody instanceof Response) return parsedBody;

  const message = cleanText(parsedBody.message);
  if (!message) {
    return NextResponse.json({ error: "请输入对话内容。" }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      { error: `单条消息请控制在 ${MAX_MESSAGE_LENGTH} 字以内。` },
      { status: 400 },
    );
  }

  const history = parseHistory(parsedBody.history);
  if (history instanceof Response) return history;

  if (
    parsedBody.memory !== undefined &&
    parsedBody.memory !== null &&
    typeof parsedBody.memory !== "string"
  ) {
    return NextResponse.json(
      { error: "长期记忆配置必须是文本。" },
      { status: 400 },
    );
  }
  const memory = cleanText(parsedBody.memory);
  if (memory.length > MAX_MEMORY_LENGTH) {
    return NextResponse.json(
      { error: `长期记忆请控制在 ${MAX_MEMORY_LENGTH} 字以内。` },
      { status: 400 },
    );
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
    const result = await chatWithOpenAI({
      apiKey,
      model,
      message,
      history,
      memory,
    });
    return NextResponse.json({ ...result, provider: "openai", model });
  } catch (error) {
    console.error("OpenAI chat failed", error);
    return NextResponse.json(
      { error: "真实模型回复失败，请稍后重试。" },
      { status: 502 },
    );
  }
}

async function chatWithOpenAI({
  apiKey,
  model,
  message,
  history,
  memory,
}: {
  apiKey: string;
  model: string;
  message: string;
  history: ChatMessage[];
  memory: string;
}): Promise<ChatResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);

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
            content: [
              "You are the conversational assistant inside Chance Atoms.",
              "Answer the user's current message directly and naturally in the user's language.",
              "Use the supplied conversation history for continuity.",
              "Return both reply and title. title must be a concise semantic summary of the conversation's primary topic and user intent, not the first user message copied, lightly trimmed, or extended with a generic suffix. Prefer a specific noun phrase: 4-18 Chinese characters for Chinese, or 3-8 words for other languages. Do not wrap title in quotation marks or end it with punctuation. If no meaningful topic can be inferred, use 新对话 instead of inventing a generic summary.",
              memory
                ? `The user explicitly configured this long-term memory. Use it only when relevant, and do not invent facts beyond it:\n${memory}`
                : "No long-term memory is configured for this conversation.",
            ].join("\n\n"),
          },
          ...history,
          { role: "user", content: message },
        ],
        text: {
          verbosity: "low",
          format: {
            type: "json_schema",
            name: "chance_chat_response",
            strict: true,
            schema: chatResponseSchema,
          },
        },
        max_output_tokens: 4_000,
      }),
    });

    if (!response.ok) throw new Error(`OpenAI returned ${response.status}`);
    const payload = (await response.json()) as unknown;
    const outputText = extractOutputText(payload);
    if (!outputText) throw new Error("OpenAI response contained no chat result");
    const firstUserMessage =
      history.find((item) => item.role === "user")?.content ?? message;
    return parseChatResult(JSON.parse(outputText), firstUserMessage);
  } finally {
    clearTimeout(timeout);
  }
}

async function readChatBody(request: Request): Promise<ChatBody | Response> {
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
    if (!isRecord(parsed)) throw new TypeError("Body must be an object");
    return parsed as ChatBody;
  } catch {
    return NextResponse.json({ error: "请求格式无效。" }, { status: 400 });
  }
}

function parseHistory(value: unknown): ChatMessage[] | Response {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_HISTORY_ITEMS) {
    return NextResponse.json(
      { error: `历史消息必须是最多 ${MAX_HISTORY_ITEMS} 条的数组。` },
      { status: 400 },
    );
  }

  const history: ChatMessage[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      (item.role !== "user" && item.role !== "assistant") ||
      typeof item.content !== "string"
    ) {
      return NextResponse.json(
        { error: "历史消息格式无效。" },
        { status: 400 },
      );
    }
    const content = item.content.trim();
    if (!content || content.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json(
        { error: `历史消息内容必须为 1-${MAX_MESSAGE_LENGTH} 字。` },
        { status: 400 },
      );
    }
    history.push({ role: item.role, content });
  }
  return history;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseChatResult(value: unknown, firstUserMessage: string): ChatResult {
  if (!isRecord(value)) throw new TypeError("Chat result must be an object");

  const reply = typeof value.reply === "string" ? value.reply.trim() : "";
  if (!reply || reply.length > MAX_REPLY_LENGTH) {
    throw new TypeError("Chat result reply is invalid");
  }
  return {
    reply,
    title: resolveChatTitle(value.title, firstUserMessage),
  };
}

function semanticTitleKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}

function cleanTitle(value: unknown): string {
  if (typeof value !== "string") return "";
  const title = value
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/[。！？!?.,，；;：:]+$/u, "")
    .trim();
  return title.length <= MAX_TITLE_LENGTH ? title : "";
}

function isUsefulModelTitle(title: string, firstUserMessage: string): boolean {
  const titleKey = semanticTitleKey(title);
  const firstMessageKey = semanticTitleKey(firstUserMessage);
  if (!titleKey || GENERIC_TITLE_KEYS.has(titleKey)) return false;
  if (!firstMessageKey || titleKey === firstMessageKey) return false;
  if (titleKey.startsWith(firstMessageKey)) {
    const suffix = titleKey.slice(firstMessageKey.length);
    if (MECHANICAL_TITLE_SUFFIXES.has(suffix)) return false;
  }
  return true;
}

function resolveChatTitle(value: unknown, firstUserMessage: string): string {
  const modelTitle = cleanTitle(value);
  if (isUsefulModelTitle(modelTitle, firstUserMessage)) return modelTitle;
  return summarizeInitialProjectTitle(firstUserMessage, DEFAULT_CHAT_TITLE);
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
