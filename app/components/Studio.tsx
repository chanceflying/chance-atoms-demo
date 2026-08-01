"use client";

import {
  FormEvent,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  isWebAppArtifact,
  parseStoredArtifact,
  type BuildPlan,
  type StoredArtifact,
  type WebAppArtifact,
} from "@/lib";
import type { AppRecord } from "@/lib/app-spec";
import { compileAppToHtml } from "@/lib/generator";
import UiIcon from "./UiIcon";

type StudioPhase = "home" | "planning" | "building" | "ready";
type LandingView = "home" | "projects" | "project";
type InspectorTab = "preview" | "code" | "spec";
type PreviewSize = "desktop" | "mobile";
type RetryAction = "projects" | "versions" | "plan" | "build" | "rollback" | null;
type ProjectKind = "web_app" | "chat";
type ProjectFilter = "all" | ProjectKind;

type StudioProps = {
  initialView?: LandingView;
  initialProjectId?: string;
  initialProjectKind?: ProjectKind;
};

type ProjectItem = {
  id: string;
  kind: ProjectKind;
  name: string;
  prompt: string;
  records: AppRecord[];
  currentVersion: number;
  createdAt: string | null;
  updatedAt: string | null;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  provider: string | null;
  model: string | null;
  createdAt: string | null;
};

type ChatMemory = {
  enabled: boolean;
  content: string;
};

type ChatResponse = {
  reply: string;
  provider: string | null;
  model: string | null;
};

type VersionItem = {
  id: string;
  projectId: string;
  ordinal: number;
  prompt: string;
  instruction: string | null;
  artifact: StoredArtifact;
  records: AppRecord[];
  provider: string | null;
  model: string | null;
  warning: string | null;
  stages: string[];
  buildPlan: BuildPlan | null;
  reasoningSummary: string[];
  createdAt: string | null;
};

type PendingBuild = {
  kind: "new" | "refine";
  prompt: string;
  instruction?: string;
  previousArtifact?: StoredArtifact;
};

type ConversationMessage = {
  id: string;
  role: "user" | "agent";
  text: string;
  meta?: string;
};

type GenerateResponse = {
  artifact: StoredArtifact;
  provider: "codex_session" | "openai" | "local";
  model: string | null;
  warning: string | null;
  stages: string[];
};

type PlanResponse = {
  plan: BuildPlan;
  reasoningSummary: string[];
  provider: string | null;
  model: string | null;
};

type SessionUser = {
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  email?: string | null;
};

type Notice = {
  text: string;
  tone: "success" | "error";
};

const STARTERS = [
  {
    eyebrow: "经典 · 街机",
    title: "霓虹贪吃蛇",
    description: "键盘和触屏都能玩的贪吃蛇，包含计分、暂停与重开。",
    prompt:
      "构造一个霓虹风格的贪吃蛇前端应用，支持方向键和 WASD 操作，也提供移动端方向按钮，包含食物、增长、计分、暂停、碰撞失败和重新开始。",
    accent: "violet",
  },
  {
    eyebrow: "经典 · 方块",
    title: "俄罗斯方块",
    description: "可以移动、旋转、消行和计分的完整小游戏。",
    prompt:
      "构造一个复古像素风俄罗斯方块前端应用，支持键盘移动、旋转和快速下落，展示下一个方块、分数、等级，包含暂停、消行和重新开始。",
    accent: "cyan",
  },
  {
    eyebrow: "经典 · 益智",
    title: "扫雷挑战",
    description: "支持难度、计时、插旗和胜负判定的扫雷游戏。",
    prompt:
      "构造一个简洁的扫雷前端应用，支持初级和中级难度、计时、剩余雷数、左键翻开、右键插旗、首次点击安全、胜负判定和重新开始。",
    accent: "amber",
  },
] as const;

const HOME_SUGGESTIONS = {
  chat: [
    {
      label: "梳理一个产品思路",
      prompt: "我有一个产品想法，请通过提问帮我梳理目标用户、核心场景、关键功能和最小可行版本。",
      icon: "lightbulb",
    },
    {
      label: "准备一轮面试问答",
      prompt: "请基于 AI Agent 产品与工程岗位，和我进行一轮结构化模拟面试，并在每题后给出反馈。",
      icon: "briefcase",
    },
  ],
  web_app: [
    {
      label: "做一个霓虹贪吃蛇",
      prompt: STARTERS[0].prompt,
      icon: "gamepad",
    },
    {
      label: "生成支持触屏的俄罗斯方块",
      prompt: STARTERS[1].prompt,
      icon: "panels",
    },
  ],
} as const;

const HOME_GUIDES = {
  chat: [
    { title: "持续对话", copy: "刷新后也能接着聊", icon: "message", tone: "coral" },
    { title: "长期记忆", copy: "由你开启和编辑", icon: "brain", tone: "blue" },
    { title: "项目保存", copy: "对话单独管理", icon: "folder", tone: "violet" },
  ],
  web_app: [
    { title: "可运行预览", copy: "生成后直接体验", icon: "play", tone: "coral" },
    { title: "代码可查看", copy: "产物可以直接导出", icon: "code", tone: "blue" },
    { title: "版本演进", copy: "修改、回退都有记录", icon: "history", tone: "violet" },
  ],
} as const;

const LOCAL_CODEX_BRIDGE = "http://127.0.0.1:4317";
const LOCAL_BRIDGE_TIMEOUT_MS = 1_200;

class ResponseError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

function readNullableString(value: unknown): string | null {
  const stringValue = readString(value).trim();
  return stringValue || null;
}

function readNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function parseArtifact(value: unknown): StoredArtifact | null {
  try {
    return parseStoredArtifact(parseJson(value));
  } catch {
    return null;
  }
}

function parseRecords(value: unknown): AppRecord[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? (parsed as AppRecord[]) : [];
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function readReasoningSummary(value: unknown): string[] {
  const parsed = parseJson(value);
  if (typeof parsed === "string") {
    const summary = parsed.trim();
    return summary ? [summary] : [];
  }
  return readStringArray(parsed);
}

function parseBuildPlan(value: unknown): BuildPlan | null {
  const parsed = parseJson(value);
  if (!isRecord(parsed)) return null;
  if (readNumber(parsed.schemaVersion, 0) !== 1 || parsed.kind !== "web_app_plan") {
    return null;
  }

  const title = readString(parsed.title).trim();
  const requestSummary = readString(parsed.requestSummary).trim();
  const implementationSteps = Array.isArray(parsed.implementationSteps)
    ? parsed.implementationSteps
        .map((item) => {
          if (!isRecord(item)) return null;
          const stepTitle = readString(item.title).trim();
          const description = readString(item.description).trim();
          return stepTitle && description ? { title: stepTitle, description } : null;
        })
        .filter(
          (item): item is { title: string; description: string } => Boolean(item),
        )
    : [];

  if (!title || !requestSummary || !implementationSteps.length) return null;
  return {
    schemaVersion: 1,
    kind: "web_app_plan",
    title,
    requestSummary,
    designDecisions: readStringArray(parsed.designDecisions),
    interactionFlow: readStringArray(parsed.interactionFlow),
    implementationSteps,
    assumptions: readStringArray(parsed.assumptions),
    acceptanceCriteria: readStringArray(parsed.acceptanceCriteria),
  };
}

function parsePlanResponse(payload: unknown): PlanResponse {
  if (!isRecord(payload)) {
    throw new Error("规划服务没有返回有效结果，请重试。 ");
  }
  const plan = parseBuildPlan(payload.plan);
  if (!plan) {
    throw new Error("规划结果不符合 Web App BuildPlan 契约，请重试。 ");
  }
  return {
    plan,
    reasoningSummary: readReasoningSummary(payload.reasoningSummary),
    provider: readNullableString(payload.provider),
    model: readNullableString(payload.model),
  };
}

function unwrapObject(payload: unknown, keys: string[]): Record<string, unknown> | null {
  if (!isRecord(payload)) return null;
  for (const key of keys) {
    if (isRecord(payload[key])) return payload[key] as Record<string, unknown>;
  }
  return payload;
}

function unwrapArray(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];
  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key] as unknown[];
  }
  if (isRecord(payload.data)) {
    for (const key of keys) {
      if (Array.isArray(payload.data[key])) return payload.data[key] as unknown[];
    }
  }
  return [];
}

function normalizeProject(value: unknown): ProjectItem | null {
  const row = unwrapObject(value, ["project", "data"]);
  if (!row) return null;
  const id = readString(row.id ?? row.projectId).trim();
  if (!id) return null;
  return {
    id,
    kind: row.kind === "chat" ? "chat" : "web_app",
    name: readString(row.name ?? row.title, "未命名应用"),
    prompt: readString(row.prompt ?? row.originalPrompt ?? row.description),
    records: parseRecords(row.records),
    currentVersion: readNumber(row.currentVersion ?? row.current_version, 0),
    createdAt: readNullableString(row.createdAt ?? row.created_at),
    updatedAt: readNullableString(row.updatedAt ?? row.updated_at),
  };
}

function normalizeChatMessage(value: unknown, index: number): ChatMessage | null {
  if (!isRecord(value)) return null;
  const role = value.role === "assistant" ? "assistant" : value.role === "user" ? "user" : null;
  const content = readString(value.content).trim();
  if (!role || !content) return null;
  return {
    id: readString(value.id, `chat-message-${index}`),
    role,
    content,
    provider: readNullableString(value.provider),
    model: readNullableString(value.model),
    createdAt: readNullableString(value.createdAt ?? value.created_at),
  };
}

function parseChatResponse(payload: unknown): ChatResponse {
  if (!isRecord(payload)) throw new Error("对话服务没有返回有效结果，请重试。");
  const reply = readString(payload.reply).trim();
  if (!reply) throw new Error("模型没有返回对话内容，请重试。");
  return {
    reply,
    provider: readNullableString(payload.provider),
    model: readNullableString(payload.model),
  };
}

function normalizeSessionUser(payload: unknown): SessionUser | null {
  if (!isRecord(payload) || !isRecord(payload.user)) return null;
  const id = readString(payload.user.id).trim();
  const login = readString(payload.user.login).trim();
  if (!id || !login) return null;
  return {
    id,
    login,
    name: readNullableString(payload.user.name),
    avatarUrl: readNullableString(payload.user.avatarUrl),
    email: readNullableString(payload.user.email),
  };
}

function normalizeVersion(
  value: unknown,
  fallbackProjectId: string,
  fallbackOrdinal = 1,
): VersionItem | null {
  const row = unwrapObject(value, ["version", "data"]);
  if (!row) return null;
  const artifact = parseArtifact(
    row.artifact ?? row.spec ?? row.appSpec ?? row.app_spec,
  );
  if (!artifact) return null;
  const ordinal = readNumber(
    row.ordinal ?? row.version ?? row.versionNumber ?? row.version_number,
    fallbackOrdinal,
  );
  const id = readString(row.id ?? row.versionId, `${fallbackProjectId}-v${ordinal}`);
  const stagesValue = parseJson(row.stages);
  return {
    id,
    projectId: readString(row.projectId ?? row.project_id, fallbackProjectId),
    ordinal,
    prompt: readString(row.prompt ?? row.originalPrompt),
    instruction: readNullableString(row.instruction),
    artifact,
    records: parseRecords(row.records ?? row.recordsJson ?? row.records_json),
    provider: readNullableString(row.provider),
    model: readNullableString(row.model),
    warning: readNullableString(row.warning),
    stages: Array.isArray(stagesValue)
      ? stagesValue.filter((item): item is string => typeof item === "string")
      : [],
    buildPlan: parseBuildPlan(
      row.buildPlan ?? row.build_plan ?? row.buildPlanJson ?? row.build_plan_json,
    ),
    reasoningSummary: readReasoningSummary(
      row.reasoningSummary ?? row.reasoning_summary,
    ),
    createdAt: readNullableString(row.createdAt ?? row.created_at),
  };
}

function sortVersions(items: VersionItem[]): VersionItem[] {
  return [...items].sort((a, b) => {
    if (b.ordinal !== a.ordinal) return b.ordinal - a.ordinal;
    return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
  });
}

function getArtifactTitle(
  artifact: StoredArtifact,
  fallback = "未命名应用",
): string {
  const row = artifact as unknown as Record<string, unknown>;
  return readString(row.name ?? row.title ?? row.appName, fallback).trim() || fallback;
}

function getArtifactDescription(artifact: StoredArtifact): string {
  const row = artifact as unknown as Record<string, unknown>;
  return readString(row.description ?? row.subtitle);
}

function deriveProjectName(prompt: string, artifact?: StoredArtifact): string {
  if (artifact) {
    const artifactTitle = getArtifactTitle(artifact, "");
    if (artifactTitle) return artifactTitle.slice(0, 32);
  }
  const clean = prompt
    .replace(/[，。！？、,.!?]/g, " ")
    .replace(/^(请|帮我|给我|做一个|创建一个|生成一个)+/g, "")
    .trim();
  return (clean.split(/\s+/).slice(0, 5).join(" ") || "我的新应用").slice(0, 32);
}

function providerLabel(provider: string | null): string {
  if (provider === "codex_session") return "本机 Codex";
  if (provider === "openai") return "OpenAI";
  if (provider === "local") return "本地服务";
  return provider || "模型服务";
}

function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatRelativeDate(value: string | null): string {
  if (!value) return "刚刚";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "最近更新";
  const delta = Date.now() - date.getTime();
  const minutes = Math.max(1, Math.round(delta / 60_000));
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} 天前`;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
  }).format(date);
}

async function readResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function requestJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload = await readResponse(response);
  if (!response.ok) {
    const message = isRecord(payload)
      ? readString(payload.error ?? payload.message, `请求失败（${response.status}）`)
      : readString(payload, `请求失败（${response.status}）`);
    const code = isRecord(payload) ? readNullableString(payload.code) : null;
    throw new ResponseError(message, response.status, code);
  }
  return payload;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function planWithLocalCodex(
  build: PendingBuild,
  currentPlan?: BuildPlan,
  planFeedback?: string,
): Promise<PlanResponse> {
  const response = await fetch(`${LOCAL_CODEX_BRIDGE}/plan`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    mode: "cors",
    body: JSON.stringify({
      prompt: build.prompt,
      ...(build.instruction ? { instruction: build.instruction } : {}),
      ...(build.previousArtifact
        ? { previousArtifact: build.previousArtifact }
        : {}),
      ...(currentPlan ? { currentPlan } : {}),
      ...(planFeedback ? { planFeedback } : {}),
    }),
  });
  const payload = await readResponse(response);
  if (!response.ok) {
    const message = isRecord(payload)
      ? readString(payload.error ?? payload.message, "本机 Codex 规划失败。")
      : "本机 Codex 规划失败。";
    throw new Error(message);
  }
  const result = parsePlanResponse(payload);
  return {
    ...result,
    provider: result.provider ?? "codex_session",
    model: result.model ?? "Codex subscription",
  };
}

async function chatWithLocalCodex(body: {
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  memory: string;
}): Promise<ChatResponse> {
  const response = await fetch(`${LOCAL_CODEX_BRIDGE}/chat`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    mode: "cors",
    body: JSON.stringify(body),
  });
  const payload = await readResponse(response);
  if (!response.ok) {
    const message = isRecord(payload)
      ? readString(payload.error ?? payload.message, "本机 Codex 对话失败。")
      : "本机 Codex 对话失败。";
    throw new Error(message);
  }
  return parseChatResponse(payload);
}

async function generateWithLocalCodex(
  build: PendingBuild,
  plan: BuildPlan,
): Promise<GenerateResponse> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), LOCAL_BRIDGE_TIMEOUT_MS);

  try {
    const healthResponse = await fetch(`${LOCAL_CODEX_BRIDGE}/health`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      mode: "cors",
      signal: controller.signal,
    });
    const health = await readResponse(healthResponse);
    if (!healthResponse.ok || !isRecord(health) || health.status !== "ok") {
      throw new Error("本机 Codex bridge 尚未就绪");
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("未检测到本机 Codex bridge，请先启动本地生成服务。 ");
    }
    throw new Error(
      getErrorMessage(error, "未检测到本机 Codex bridge，请先启动本地生成服务。"),
    );
  } finally {
    window.clearTimeout(timeout);
  }

  const response = await fetch(`${LOCAL_CODEX_BRIDGE}/generate`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    mode: "cors",
    body: JSON.stringify({
      prompt: build.prompt,
      ...(build.instruction ? { instruction: build.instruction } : {}),
      ...(build.previousArtifact
        ? { previousArtifact: build.previousArtifact }
        : {}),
      plan,
    }),
  });
  const payload = await readResponse(response);
  if (!response.ok) {
    const message = isRecord(payload)
      ? readString(payload.error ?? payload.message, "本机 Codex 生成失败。")
      : "本机 Codex 生成失败。";
    throw new Error(message);
  }

  const artifact = isRecord(payload)
    ? parseArtifact(payload.artifact ?? payload.spec)
    : null;
  if (!artifact || !isWebAppArtifact(artifact)) {
    throw new Error("本机 Codex 返回的 Web App 结构无效。 ");
  }

  return {
    artifact: artifact as WebAppArtifact,
    provider: "codex_session",
    model: isRecord(payload)
      ? readNullableString(payload.model) ?? "Codex subscription"
      : "Codex subscription",
    warning: isRecord(payload) ? readNullableString(payload.warning) : null,
    stages: isRecord(payload) && Array.isArray(payload.stages)
      ? payload.stages.filter((item): item is string => typeof item === "string")
      : [],
  };
}

function safeCompile(
  artifact: StoredArtifact | null,
  records: AppRecord[],
  projectId: string,
): string {
  if (!artifact) return "";
  if (isWebAppArtifact(artifact)) return artifact.html;
  try {
    return compileAppToHtml(artifact, records, projectId);
  } catch (error) {
    const message = getErrorMessage(error, "预览编译失败");
    return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{font-family:system-ui;padding:40px;color:#24262b}main{max-width:560px;margin:auto;border:1px solid #ddd;border-radius:16px;padding:24px}p{color:#666}</style><main><h1>预览暂不可用</h1><p>${message.replace(/[<>&]/g, "")}</p></main></html>`;
  }
}

export default function Studio({
  initialView = "home",
  initialProjectId,
  initialProjectKind,
}: StudioProps = {}) {
  const [phase, setPhase] = useState<StudioPhase>("home");
  const [landingView, setLandingView] = useState<LandingView>(initialView);
  const [capability, setCapability] = useState<ProjectKind>("chat");
  const [promptByCapability, setPromptByCapability] = useState<Record<ProjectKind, string>>({
    chat: "",
    web_app: "",
  });
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>("all");
  const [instruction, setInstruction] = useState("");
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [activeProject, setActiveProject] = useState<ProjectItem | null>(null);
  const [versions, setVersions] = useState<VersionItem[]>([]);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [records, setRecords] = useState<AppRecord[]>([]);
  const [pendingBuild, setPendingBuild] = useState<PendingBuild | null>(null);
  const [plan, setPlan] = useState<BuildPlan | null>(null);
  const [reasoningSummary, setReasoningSummary] = useState<string[]>([]);
  const [planProvider, setPlanProvider] = useState<string | null>(null);
  const [planModel, setPlanModel] = useState<string | null>(null);
  const [planFeedback, setPlanFeedback] = useState("");
  const [planningLoading, setPlanningLoading] = useState(false);
  const [buildLog, setBuildLog] = useState<string[]>([]);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("preview");
  const [previewSize, setPreviewSize] = useState<PreviewSize>("desktop");
  const [rollbackLoading, setRollbackLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryAction, setRetryAction] = useState<RetryAction>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatSending, setChatSending] = useState(false);
  const [chatMemory, setChatMemory] = useState<ChatMemory>({ enabled: false, content: "" });
  const [memorySaving, setMemorySaving] = useState(false);
  const [memoryPanelOpen, setMemoryPanelOpen] = useState(true);
  const [agentPanePercent, setAgentPanePercent] = useState(42);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const initialProjectOpenedRef = useRef(false);
  const accountSwitchingRef = useRef(false);
  const mutationInFlightRef = useRef(false);
  const identityEpochRef = useRef(0);
  const openProjectRequestRef = useRef(0);
  const planRequestRef = useRef(0);
  const workspaceEpochRef = useRef(0);
  const chatRequestRef = useRef(0);
  const chatSendInFlightRef = useRef(false);
  const chatCreateInFlightRef = useRef(false);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const prompt = promptByCapability[capability];
  const setPrompt = useCallback((value: string) => {
    setPromptByCapability((current) => ({ ...current, [capability]: value }));
  }, [capability]);

  const accountSwitching = loginLoading || logoutLoading;
  const workspaceWriteBusy =
    phase === "building"
    || phase === "planning"
    || rollbackLoading
    || chatSending
    || Boolean(deletingProjectId)
    || (phase === "home" && chatLoading);

  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => {
      const aTime = Date.parse(a.updatedAt ?? a.createdAt ?? "") || 0;
      const bTime = Date.parse(b.updatedAt ?? b.createdAt ?? "") || 0;
      return bTime - aTime;
    }),
    [projects],
  );

  const recentProjects = useMemo(() => sortedProjects.slice(0, 5), [sortedProjects]);
  const filteredProjects = useMemo(
    () => projectFilter === "all"
      ? sortedProjects
      : sortedProjects.filter((project) => project.kind === projectFilter),
    [projectFilter, sortedProjects],
  );

  const workspaceOwner = user?.email?.split("@")[0]?.trim() || user?.login || "游客";

  const updatePath = useCallback((path: string, replace = false) => {
    if (typeof window === "undefined" || window.location.pathname === path) return;
    window.history[replace ? "replaceState" : "pushState"](
      { ...window.history.state, atomsPath: path },
      "",
      path,
    );
  }, []);

  const goHome = useCallback(() => {
    setLandingView("home");
    updatePath("/");
  }, [updatePath]);

  const goProjects = useCallback(() => {
    setLandingView("projects");
    updatePath("/projects");
  }, [updatePath]);

  const resumeWorkspace = useCallback(() => {
    setLandingView("project");
    if (activeProject) {
      updatePath(`/${activeProject.kind === "chat" ? "chat" : "apps"}/${encodeURIComponent(activeProject.id)}`);
    } else if (pendingBuild) {
      updatePath("/apps/draft");
    }
  }, [activeProject, pendingBuild, updatePath]);

  const activeVersion = useMemo(
    () => versions.find((version) => version.id === activeVersionId) ?? versions[0] ?? null,
    [activeVersionId, versions],
  );

  const latestVersion = versions[0] ?? null;
  const isHistoricalVersion = Boolean(
    activeVersion && latestVersion && activeVersion.id !== latestVersion.id,
  );

  const previewHtml = useMemo(
    () => safeCompile(activeVersion?.artifact ?? null, records, activeProject?.id ?? "draft"),
    [activeProject?.id, activeVersion?.artifact, records],
  );

  const showNotice = useCallback((text: string, tone: Notice["tone"] = "success") => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setNotice({ text, tone });
    noticeTimerRef.current = setTimeout(() => setNotice(null), 3600);
  }, []);

  const loadSession = useCallback(async () => {
    const identityEpoch = identityEpochRef.current;
    setSessionLoading(true);
    try {
      const payload = await requestJson("/api/auth/session", { cache: "no-store" });
      if (identityEpoch !== identityEpochRef.current) return;
      setUser(normalizeSessionUser(payload));
    } catch {
      if (identityEpoch !== identityEpochRef.current) return;
      setUser(null);
      showNotice("暂时无法确认登录状态，已继续使用访客工作区", "error");
    } finally {
      if (identityEpoch === identityEpochRef.current) {
        setSessionLoading(false);
      }
    }
  }, [showNotice]);

  const loadProjects = useCallback(async (silent = false) => {
    const identityEpoch = identityEpochRef.current;
    if (!silent) setProjectsLoading(true);
    setErrorMessage(null);
    try {
      const payload = await requestJson("/api/projects", { cache: "no-store" });
      if (identityEpoch !== identityEpochRef.current) return;
      const nextProjects = unwrapArray(payload, ["projects", "items", "data"])
        .map(normalizeProject)
        .filter((item): item is ProjectItem => Boolean(item));
      setProjects(nextProjects);
      setRetryAction(null);
    } catch (error) {
      if (identityEpoch !== identityEpochRef.current) return;
      setErrorMessage(getErrorMessage(error, "暂时无法读取最近项目。"));
      setRetryAction("projects");
    } finally {
      if (!silent && identityEpoch === identityEpochRef.current) {
        setProjectsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadSession();
      void loadProjects();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadProjects, loadSession]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authResult = params.get("auth");
    if (!authResult) return;

    const claimed = Math.max(0, Number.parseInt(params.get("claimed") ?? "0", 10) || 0);
    const noticeTimer = window.setTimeout(() => {
      if (authResult === "success") {
        showNotice(
          claimed > 0
            ? `登录成功，已将 ${claimed} 个访客项目同步到账号`
            : "GitHub 登录成功，项目已同步至账号",
        );
      } else {
        showNotice("GitHub 登录未完成，请重试", "error");
      }
    }, 0);

    params.delete("auth");
    params.delete("claimed");
    const search = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`,
    );
    return () => window.clearTimeout(noticeTimer);
  }, [showNotice]);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    };
  }, []);

  const openProject = useCallback(async (
    project: ProjectItem,
    options?: { updateUrl?: boolean },
  ) => {
    if (
      mutationInFlightRef.current
      || chatSendInFlightRef.current
      || chatCreateInFlightRef.current
    ) {
      showNotice("请等待当前写入完成后再切换项目", "error");
      return;
    }
    const identityEpoch = identityEpochRef.current;
    const requestId = openProjectRequestRef.current + 1;
    openProjectRequestRef.current = requestId;
    planRequestRef.current += 1;
    workspaceEpochRef.current += 1;
    chatRequestRef.current += 1;
    chatSendInFlightRef.current = false;
    setLandingView("project");
    if (options?.updateUrl !== false) {
      updatePath(`/${project.kind === "chat" ? "chat" : "apps"}/${encodeURIComponent(project.id)}`);
    }
    setActiveProject(project);
    setVersions([]);
    setActiveVersionId(null);
    setRecords([]);
    setPendingBuild(null);
    setPlan(null);
    setReasoningSummary([]);
    setPlanProvider(null);
    setPlanModel(null);
    setPlanFeedback("");
    setPlanningLoading(false);
    setBuildLog([]);
    setPhase("ready");
    setErrorMessage(null);
    setChatMessages([]);
    setChatInput("");
    setChatSending(false);
    setChatMemory({ enabled: false, content: "" });
    setChatLoading(project.kind === "chat");
    setVersionsLoading(project.kind === "web_app");
    if (project.kind === "chat") {
      try {
        const payload = await requestJson(
          `/api/projects/${encodeURIComponent(project.id)}/chat`,
          { cache: "no-store" },
        );
        if (
          identityEpoch !== identityEpochRef.current
          || requestId !== openProjectRequestRef.current
        ) return;
        const row = isRecord(payload) ? payload : {};
        const memory = isRecord(row.memory) ? row.memory : {};
        setChatMemory({
          enabled: memory.enabled === true,
          content: readString(memory.content),
        });
        setChatMessages(
          (Array.isArray(row.messages) ? row.messages : [])
            .map(normalizeChatMessage)
            .filter((item): item is ChatMessage => Boolean(item)),
        );
        setRetryAction(null);
      } catch (error) {
        if (
          identityEpoch !== identityEpochRef.current
          || requestId !== openProjectRequestRef.current
        ) return;
        setErrorMessage(getErrorMessage(error, "暂时无法读取对话记录。"));
      } finally {
        if (
          identityEpoch === identityEpochRef.current
          && requestId === openProjectRequestRef.current
        ) {
          setChatLoading(false);
        }
      }
      return;
    }
    setMessages([
      {
        id: makeId("message"),
        role: "agent",
        text: `已打开「${project.name}」。你可以直接操作预览，或者告诉我下一步要怎么调整。`,
      },
    ]);
    try {
      const payload = await requestJson(
        `/api/projects/${encodeURIComponent(project.id)}/versions`,
        { cache: "no-store" },
      );
      if (
        identityEpoch !== identityEpochRef.current
        || requestId !== openProjectRequestRef.current
      ) return;
      const normalized = unwrapArray(payload, ["versions", "items", "data"])
        .map((item, index) => normalizeVersion(item, project.id, index + 1))
        .filter((item): item is VersionItem => Boolean(item));
      const sorted = sortVersions(normalized);
      const firstVersion = sorted[0];
      setVersions(sorted);
      setActiveVersionId(firstVersion?.id ?? null);
      setRecords(firstVersion?.records ?? []);
      if (!sorted.length) {
        setErrorMessage("这个项目还没有可预览的版本。可以返回首页重新创建。 ");
      }
      setRetryAction(null);
    } catch (error) {
      if (
        identityEpoch !== identityEpochRef.current
        || requestId !== openProjectRequestRef.current
      ) return;
      setErrorMessage(getErrorMessage(error, "暂时无法读取项目版本。"));
      setRetryAction("versions");
    } finally {
      if (
        identityEpoch === identityEpochRef.current
        && requestId === openProjectRequestRef.current
      ) {
        setVersionsLoading(false);
      }
    }
  }, [showNotice, updatePath]);

  useEffect(() => {
    if (
      initialProjectOpenedRef.current
      || initialView !== "project"
      || !initialProjectId
      || projectsLoading
    ) return;
    const project = projects.find((item) => (
      item.id === initialProjectId
      && (!initialProjectKind || item.kind === initialProjectKind)
    ));
    initialProjectOpenedRef.current = true;
    const timer = window.setTimeout(() => {
      if (project) {
        void openProject(project, { updateUrl: false });
        return;
      }
      setLandingView("projects");
      setErrorMessage("没有找到这个项目，它可能已经被删除。 ");
      setRetryAction("projects");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    initialProjectId,
    initialProjectKind,
    initialView,
    openProject,
    projects,
    projectsLoading,
  ]);

  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname;
      if (path === "/") {
        setLandingView("home");
        return;
      }
      if (path === "/projects") {
        setLandingView("projects");
        return;
      }
      if (path === "/apps/draft" && pendingBuild) {
        setLandingView("project");
        return;
      }
      const match = path.match(/^\/(chat|apps)\/([^/]+)$/);
      if (!match) return;
      const project = projects.find((item) => item.id === decodeURIComponent(match[2]));
      if (!project) return;
      if (activeProject?.id === project.id) setLandingView("project");
      else void openProject(project, { updateUrl: false });
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [activeProject?.id, openProject, pendingBuild, projects]);

  const resetToHome = useCallback(() => {
    openProjectRequestRef.current += 1;
    planRequestRef.current += 1;
    workspaceEpochRef.current += 1;
    chatRequestRef.current += 1;
    chatSendInFlightRef.current = false;
    setPhase("home");
    setLandingView("home");
    setVersionsLoading(false);
    setActiveProject(null);
    setVersions([]);
    setActiveVersionId(null);
    setRecords([]);
    setPendingBuild(null);
    setPlan(null);
    setReasoningSummary([]);
    setPlanProvider(null);
    setPlanModel(null);
    setPlanFeedback("");
    setPlanningLoading(false);
    setBuildLog([]);
    setMessages([]);
    setInstruction("");
    setChatMessages([]);
    setChatInput("");
    setChatLoading(false);
    setChatSending(false);
    setChatMemory({ enabled: false, content: "" });
    setErrorMessage(null);
    setRetryAction(null);
    updatePath("/");
  }, [updatePath]);

  const requestBuildPlan = useCallback(async (
    build: PendingBuild,
    revision?: { currentPlan: BuildPlan; feedback: string },
  ) => {
    const requestId = planRequestRef.current + 1;
    planRequestRef.current = requestId;
    setPlanningLoading(true);
    if (!revision) {
      setPlan(null);
      setReasoningSummary([]);
      setPlanProvider(null);
      setPlanModel(null);
    }
    setErrorMessage(null);
    setRetryAction(null);
    setMessages((current) =>
      current.map((message) =>
        message.meta === "规划失败"
          ? {
              ...message,
              text: "正在重新调用模型生成 BuildPlan。",
              meta: "正在规划",
            }
          : message,
      ),
    );

    try {
      let planned: PlanResponse;
      try {
        const payload = await requestJson("/api/plan", {
          method: "POST",
          body: JSON.stringify({
            prompt: build.prompt,
            ...(build.instruction ? { instruction: build.instruction } : {}),
            ...(build.previousArtifact
              ? { previousArtifact: build.previousArtifact }
              : {}),
            ...(revision
              ? {
                  currentPlan: revision.currentPlan,
                  planFeedback: revision.feedback,
                }
              : {}),
          }),
        });
        planned = parsePlanResponse(payload);
      } catch (error) {
        const shouldUseLocalBridge =
          error instanceof ResponseError
          && error.status === 503
          && error.code === "OPENAI_NOT_CONFIGURED";
        if (!shouldUseLocalBridge) throw error;

        try {
          planned = await planWithLocalCodex(
            build,
            revision?.currentPlan,
            revision?.feedback,
          );
        } catch (bridgeError) {
          throw bridgeError;
        }
      }

      if (requestId !== planRequestRef.current) return;
      setPlan(planned.plan);
      setReasoningSummary(planned.reasoningSummary);
      setPlanProvider(planned.provider);
      setPlanModel(planned.model);
      setPlanFeedback("");
      setMessages((current) =>
        revision
          ? [
              ...current,
              {
                id: makeId("message"),
                role: "agent",
                text: "已经根据你的反馈调整 BuildPlan。你可以继续修改，或确认后开始构建。",
                meta: `${providerLabel(planned.provider)} · 等待确认`,
              },
            ]
          : current.map((message) =>
              message.meta === "正在规划"
                ? {
                    ...message,
                    text: "模型已经完成需求分析。请检查下面的 BuildPlan，确认后才会开始生成代码。",
                    meta: `${providerLabel(planned.provider)} · 等待确认`,
                  }
                : message,
            ),
      );
    } catch (error) {
      if (requestId !== planRequestRef.current) return;
      setErrorMessage(getErrorMessage(error, "规划过程中出现问题，请重试。"));
      setRetryAction("plan");
      setMessages((current) =>
        current.map((message) =>
          message.meta === "正在规划"
            ? { ...message, text: "规划请求没有完成。可以直接重试。", meta: "规划失败" }
            : message,
        ),
      );
    } finally {
      if (requestId === planRequestRef.current) setPlanningLoading(false);
    }
  }, []);

  const beginNewPlan = useCallback(() => {
    if (accountSwitchingRef.current) return;
    const cleanPrompt = prompt.trim();
    if (cleanPrompt.length < 4) {
      setErrorMessage("再多描述一点吧，例如玩法、交互和完成条件。 ");
      setRetryAction(null);
      return;
    }
    const build: PendingBuild = {
      kind: "new",
      prompt: cleanPrompt,
    };
    openProjectRequestRef.current += 1;
    workspaceEpochRef.current += 1;
    setActiveProject(null);
    setVersions([]);
    setActiveVersionId(null);
    setRecords([]);
    setPendingBuild(build);
    setPlanFeedback("");
    setMessages([
      { id: makeId("message"), role: "user", text: cleanPrompt },
      {
        id: makeId("message"),
        role: "agent",
        text: "正在调用模型理解目标、交互和实现边界。规划完成后会先由你确认。",
        meta: "正在规划",
      },
    ]);
    setErrorMessage(null);
    setRetryAction(null);
    setPhase("planning");
    setLandingView("project");
    updatePath("/apps/draft");
    void requestBuildPlan(build);
  }, [prompt, requestBuildPlan, updatePath]);

  const beginRefinePlan = useCallback(() => {
    if (accountSwitchingRef.current) return;
    const cleanInstruction = instruction.trim();
    if (!activeProject || !activeVersion) return;
    if (cleanInstruction.length < 2) {
      setErrorMessage("请告诉我希望调整什么。 ");
      setRetryAction(null);
      return;
    }
    const build: PendingBuild = {
      kind: "refine",
      prompt:
        activeProject.prompt
        || activeVersion.prompt
        || getArtifactTitle(activeVersion.artifact),
      instruction: cleanInstruction,
      previousArtifact: activeVersion.artifact,
    };
    setPendingBuild(build);
    setPlanFeedback("");
    setMessages((current) => [
      ...current,
      { id: makeId("message"), role: "user", text: cleanInstruction },
      {
        id: makeId("message"),
        role: "agent",
        text: "正在让模型基于当前版本规划这次调整，旧版本会继续保留。",
        meta: "正在规划",
      },
    ]);
    setErrorMessage(null);
    setRetryAction(null);
    setPhase("planning");
    void requestBuildPlan(build);
  }, [activeProject, activeVersion, instruction, requestBuildPlan]);

  const adjustBuildPlan = useCallback(() => {
    if (!pendingBuild || !plan || planningLoading) return;
    const feedback = planFeedback.trim();
    if (feedback.length < 2) {
      setErrorMessage("请说明希望怎样调整当前方案。");
      return;
    }
    setMessages((current) => [
      ...current,
      { id: makeId("message"), role: "user", text: feedback, meta: "调整 BuildPlan" },
    ]);
    void requestBuildPlan(pendingBuild, { currentPlan: plan, feedback });
  }, [pendingBuild, plan, planFeedback, planningLoading, requestBuildPlan]);

  const persistVersion = useCallback(
    async (
      project: ProjectItem,
      generated: GenerateResponse,
      build: PendingBuild,
      confirmedPlan: BuildPlan,
      confirmedReasoningSummary: string[],
    ): Promise<VersionItem> => {
      const payload = await requestJson(
        `/api/projects/${encodeURIComponent(project.id)}/versions`,
        {
          method: "POST",
          body: JSON.stringify({
            artifact: generated.artifact,
            spec: generated.artifact,
            records: [],
            prompt: build.prompt,
            instruction: build.instruction ?? null,
            provider: generated.provider,
            model: generated.model,
            warning: generated.warning,
            stages: generated.stages,
            buildPlan: confirmedPlan,
            reasoningSummary: confirmedReasoningSummary,
          }),
        },
      );
      const normalized = normalizeVersion(payload, project.id, (latestVersion?.ordinal ?? 0) + 1);
      if (normalized) {
        return {
          ...normalized,
          prompt: build.prompt,
          records: [],
          provider: generated.provider,
          model: generated.model,
          warning: generated.warning,
          stages: generated.stages,
          buildPlan: confirmedPlan,
          reasoningSummary: confirmedReasoningSummary,
        };
      }
      return {
        id: makeId("version"),
        projectId: project.id,
        ordinal: (latestVersion?.ordinal ?? 0) + 1,
        prompt: build.prompt,
        instruction: build.instruction ?? null,
        artifact: generated.artifact,
        records: [],
        provider: generated.provider,
        model: generated.model,
        warning: generated.warning,
        stages: generated.stages,
        buildPlan: confirmedPlan,
        reasoningSummary: confirmedReasoningSummary,
        createdAt: new Date().toISOString(),
      };
    },
    [latestVersion?.ordinal],
  );

  const executeBuild = useCallback(async () => {
    if (!pendingBuild || !plan) return;
    if (accountSwitchingRef.current) {
      showNotice("账号切换完成后再开始构建", "error");
      return;
    }
    if (mutationInFlightRef.current) return;
    mutationInFlightRef.current = true;
    const workspaceEpoch = workspaceEpochRef.current;
    const isCurrentWorkspace = () => workspaceEpoch === workspaceEpochRef.current;
    const build = pendingBuild;
    const confirmedPlan = plan;
    const confirmedReasoningSummary = reasoningSummary;
    setBuildLog(["BuildPlan 已确认", "正在请求线上生成服务"]);
    setPhase("building");
    setErrorMessage(null);
    setRetryAction(null);
    setInspectorTab("preview");
    try {
      let project = activeProject;
      if (build.kind === "new" && !project) {
        if (isCurrentWorkspace()) {
          setBuildLog((current) => [...current, "正在创建可恢复的项目草稿"]);
        }
        const projectPayload = await requestJson("/api/projects", {
          method: "POST",
          body: JSON.stringify({
            name: deriveProjectName(build.prompt),
            prompt: build.prompt,
          }),
        });
        project = normalizeProject(projectPayload);
        if (!project) throw new Error("创建项目草稿失败，请重试。 ");
        if (isCurrentWorkspace()) {
          setActiveProject(project);
          setProjects((current) => [
            project as ProjectItem,
            ...current.filter((item) => item.id !== project?.id),
          ]);
          if (window.location.pathname === "/apps/draft") {
            updatePath(`/apps/${encodeURIComponent(project.id)}`, true);
          }
        }
      }

      let generated: GenerateResponse;
      try {
        const generatedPayload = await requestJson("/api/generate", {
          method: "POST",
          body: JSON.stringify({
            prompt: build.prompt,
            ...(build.previousArtifact
              ? { previousArtifact: build.previousArtifact }
              : {}),
            ...(build.instruction ? { instruction: build.instruction } : {}),
            plan: confirmedPlan,
          }),
        });
        if (!isRecord(generatedPayload)) {
          throw new Error("生成结果缺少可运行的应用描述，请重试。 ");
        }
        const artifact = parseArtifact(generatedPayload.artifact ?? generatedPayload.spec);
        if (!artifact) {
          throw new Error("生成结果缺少可运行的应用描述，请重试。 ");
        }
        if (!isWebAppArtifact(artifact)) {
          throw new Error("生成结果不是可运行的 Web App，请重试。 ");
        }
        const rawProvider = readString(generatedPayload.provider);
        generated = {
          artifact,
          provider:
            rawProvider === "openai"
              ? "openai"
              : rawProvider === "codex_session"
                ? "codex_session"
                : "local",
          model: readNullableString(generatedPayload.model),
          warning: readNullableString(generatedPayload.warning),
          stages: Array.isArray(generatedPayload.stages)
            ? generatedPayload.stages.filter(
                (item: unknown): item is string => typeof item === "string",
              )
            : [],
        };
      } catch (error) {
        const shouldUseLocalBridge =
          error instanceof ResponseError
          && error.status === 503
          && error.code === "OPENAI_NOT_CONFIGURED";
        if (!shouldUseLocalBridge) throw error;

        if (isCurrentWorkspace()) {
          setBuildLog((current) => [
            ...current,
            "线上未配置 API Key，正在请求本机 Codex",
          ]);
        }
        try {
          generated = await generateWithLocalCodex(build, confirmedPlan);
        } catch (bridgeError) {
          throw bridgeError;
        }
      }

      if (isCurrentWorkspace()) {
        setBuildLog((current) => [
          ...current,
          `${providerLabel(generated.provider)} 已返回可运行 Web App`,
        ]);
      }

      if (!project) throw new Error("找不到要更新的项目，请返回首页重试。 ");

      if (isCurrentWorkspace()) {
        setBuildLog((current) => [...current, "正在保存应用版本"]);
      }
      const version = await persistVersion(
        project,
        generated,
        build,
        confirmedPlan,
        confirmedReasoningSummary,
      );
      if (isCurrentWorkspace()) {
        const nextVersions = sortVersions([
          version,
          ...versions.filter((item) => item.id !== version.id),
        ]);
        setActiveProject(project);
        setVersions(nextVersions);
        setActiveVersionId(version.id);
        setRecords([]);
        setInstruction("");
        setPendingBuild(null);
        setPlan(null);
        setReasoningSummary([]);
        setPlanProvider(null);
        setPlanModel(null);
        setMessages((current) => [
          ...current.filter((message) => !message.meta?.includes("等待确认")),
          {
            id: makeId("message"),
            role: "agent",
            text:
              build.kind === "new"
                ? `「${project.name}」已经生成。右侧是本次生成的完整 Web App，可以直接操作。`
                : `调整完成，已保存为 v${version.ordinal}。旧版本仍在左侧，可以随时查看或恢复。`,
            meta: `${providerLabel(generated.provider)} 生成`,
          },
        ]);
        setPhase("ready");
        setRetryAction(null);
        if (generated.warning) showNotice(generated.warning);
        else showNotice(build.kind === "new" ? "应用已准备好" : `已创建 v${version.ordinal}`);
      }
      void loadProjects(true);
    } catch (error) {
      if (isCurrentWorkspace()) {
        setErrorMessage(getErrorMessage(error, "生成过程中出现问题，请重试。"));
        setRetryAction("build");
        setPhase("planning");
      }
    } finally {
      mutationInFlightRef.current = false;
    }
  }, [
    activeProject,
    loadProjects,
    pendingBuild,
    plan,
    persistVersion,
    reasoningSummary,
    showNotice,
    updatePath,
    versions,
  ]);

  const chooseVersion = useCallback(
    (version: VersionItem) => {
      setActiveVersionId(version.id);
      setRecords(version.records);
      setInspectorTab("preview");
      setErrorMessage(null);
      setRetryAction(null);
    },
    [],
  );

  const rollbackVersion = useCallback(async () => {
    if (!activeProject || !activeVersion || !isHistoricalVersion) return;
    if (accountSwitchingRef.current) {
      showNotice("账号切换完成后再恢复版本", "error");
      return;
    }
    if (mutationInFlightRef.current) return;
    mutationInFlightRef.current = true;
    const workspaceEpoch = workspaceEpochRef.current;
    const isCurrentWorkspace = () => workspaceEpoch === workspaceEpochRef.current;
    setRollbackLoading(true);
    setErrorMessage(null);
    setRetryAction(null);
    try {
      const payload = await requestJson(
        `/api/projects/${encodeURIComponent(activeProject.id)}/versions`,
        {
          method: "POST",
          body: JSON.stringify({
            action: "rollback",
            sourceVersionId: activeVersion.id,
            artifact: activeVersion.artifact,
            spec: activeVersion.artifact,
            records: [],
            prompt: activeVersion.prompt || activeProject.prompt,
            instruction: `恢复 v${activeVersion.ordinal}`,
            provider: activeVersion.provider ?? "local",
            model: activeVersion.model,
            warning: null,
            stages: ["恢复历史版本"],
            buildPlan: activeVersion.buildPlan,
            reasoningSummary: activeVersion.reasoningSummary,
          }),
        },
      );
      const normalized = normalizeVersion(
        payload,
        activeProject.id,
        (latestVersion?.ordinal ?? 0) + 1,
      );
      const restored = normalized
        ? {
            ...normalized,
            records: [],
            buildPlan: activeVersion.buildPlan,
            reasoningSummary: activeVersion.reasoningSummary,
          }
        : {
          ...activeVersion,
          id: makeId("version"),
          ordinal: (latestVersion?.ordinal ?? 0) + 1,
          instruction: `恢复 v${activeVersion.ordinal}`,
          records: [],
          createdAt: new Date().toISOString(),
          };
      if (isCurrentWorkspace()) {
        setVersions((current) => sortVersions([restored, ...current]));
        setActiveVersionId(restored.id);
        setRecords([]);
        setMessages((current) => [
          ...current,
          {
            id: makeId("message"),
            role: "agent",
            text: `已把 v${activeVersion.ordinal} 恢复为新的 v${restored.ordinal}，原有版本没有被覆盖。`,
            meta: "版本恢复",
          },
        ]);
        showNotice(`已恢复为 v${restored.ordinal}`);
      }
      void loadProjects(true);
    } catch (error) {
      if (isCurrentWorkspace()) {
        setErrorMessage(getErrorMessage(error, "暂时无法恢复这个版本。"));
        setRetryAction("rollback");
      }
    } finally {
      mutationInFlightRef.current = false;
      if (isCurrentWorkspace()) setRollbackLoading(false);
    }
  }, [
    activeProject,
    activeVersion,
    isHistoricalVersion,
    latestVersion,
    loadProjects,
    showNotice,
  ]);

  const sendChatMessage = useCallback(async (options?: {
    project?: ProjectItem;
    text?: string;
    history?: ChatMessage[];
    memory?: ChatMemory;
    allowWhileLoading?: boolean;
  }) => {
    const project = options?.project ?? activeProject;
    const text = (options?.text ?? chatInput).trim();
    const history = options?.history ?? chatMessages;
    const memory = options?.memory ?? chatMemory;
    if (
      !project
      || project.kind !== "chat"
      || !text
      || chatSending
      || Boolean(deletingProjectId)
      || chatSendInFlightRef.current
      || (chatLoading && !options?.allowWhileLoading)
    ) return;

    const workspaceEpoch = workspaceEpochRef.current;
    const requestId = chatRequestRef.current + 1;
    chatRequestRef.current = requestId;
    chatSendInFlightRef.current = true;
    const isCurrentChat = () =>
      workspaceEpoch === workspaceEpochRef.current
      && requestId === chatRequestRef.current;

    const userMessage: ChatMessage = {
      id: makeId("chat-user"),
      role: "user",
      content: text,
      provider: null,
      model: null,
      createdAt: new Date().toISOString(),
    };
    setChatMessages([...history, userMessage]);
    setChatInput("");
    setChatSending(true);
    setErrorMessage(null);

    try {
      const requestBody = {
        message: text,
        history: history
          .slice(-40)
          .map((item) => ({ role: item.role, content: item.content })),
        memory: memory.enabled ? memory.content : "",
      };
      let result: ChatResponse;
      try {
        result = parseChatResponse(await requestJson("/api/chat", {
          method: "POST",
          body: JSON.stringify(requestBody),
        }));
      } catch (error) {
        const shouldUseLocalBridge =
          error instanceof ResponseError
          && error.status === 503
          && error.code === "OPENAI_NOT_CONFIGURED";
        if (!shouldUseLocalBridge) throw error;
        result = await chatWithLocalCodex(requestBody);
      }

      const assistantMessage: ChatMessage = {
        id: makeId("chat-assistant"),
        role: "assistant",
        content: result.reply,
        provider: result.provider,
        model: result.model,
        createdAt: new Date().toISOString(),
      };
      if (isCurrentChat()) {
        setChatMessages((current) => [...current, assistantMessage]);
      }

      await requestJson(`/api/projects/${encodeURIComponent(project.id)}/chat`, {
        method: "POST",
        body: JSON.stringify({
          userMessage: text,
          assistantMessage: result.reply,
          provider: result.provider,
          model: result.model,
        }),
      });
      void loadProjects(true);
    } catch (error) {
      if (isCurrentChat()) {
        setChatMessages(history);
        setChatInput(text);
        setErrorMessage(getErrorMessage(error, "对话没有完成，请重试。"));
      }
    } finally {
      if (requestId === chatRequestRef.current) {
        chatSendInFlightRef.current = false;
        if (isCurrentChat()) setChatSending(false);
      }
    }
  }, [
    activeProject,
    chatInput,
    chatLoading,
    chatMemory,
    chatMessages,
    chatSending,
    deletingProjectId,
    loadProjects,
  ]);

  const beginNewChat = useCallback(async () => {
    const cleanPrompt = prompt.trim();
    if (
      cleanPrompt.length < 2
      || accountSwitchingRef.current
      || chatCreateInFlightRef.current
    ) {
      setErrorMessage("请输入你想和 Agent 讨论的问题。");
      return;
    }
    chatCreateInFlightRef.current = true;
    setErrorMessage(null);
    setChatLoading(true);
    try {
      const payload = await requestJson("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          kind: "chat",
          title: deriveProjectName(cleanPrompt),
          name: deriveProjectName(cleanPrompt),
          prompt: cleanPrompt,
        }),
      });
      const normalized = normalizeProject(payload);
      if (!normalized) throw new Error("创建对话项目失败，请重试。");
      const project: ProjectItem = { ...normalized, kind: "chat" };
      workspaceEpochRef.current += 1;
      chatRequestRef.current += 1;
      setActiveProject(project);
      setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)]);
      setVersions([]);
      setActiveVersionId(null);
      setPhase("ready");
      setLandingView("project");
      updatePath(`/chat/${encodeURIComponent(project.id)}`);
      setChatMessages([]);
      setChatMemory({ enabled: true, content: "" });
      setPrompt("");
      await sendChatMessage({
        project,
        text: cleanPrompt,
        history: [],
        memory: { enabled: true, content: "" },
        allowWhileLoading: true,
      });
    } catch (error) {
      setErrorMessage(getErrorMessage(error, "创建对话项目失败，请重试。"));
    } finally {
      chatCreateInFlightRef.current = false;
      setChatLoading(false);
    }
  }, [prompt, sendChatMessage, setPrompt, updatePath]);

  const saveChatMemory = useCallback(async () => {
    if (!activeProject || activeProject.kind !== "chat") return;
    setMemorySaving(true);
    setErrorMessage(null);
    try {
      await requestJson(`/api/projects/${encodeURIComponent(activeProject.id)}/chat`, {
        method: "PATCH",
        body: JSON.stringify({
          memoryEnabled: chatMemory.enabled,
          memoryContent: chatMemory.content,
        }),
      });
      showNotice("长期记忆配置已保存");
    } catch (error) {
      setErrorMessage(getErrorMessage(error, "长期记忆保存失败，请重试。"));
    } finally {
      setMemorySaving(false);
    }
  }, [activeProject, chatMemory, showNotice]);

  const deleteProject = useCallback(async (project: ProjectItem) => {
    if (deletingProjectId || accountSwitchingRef.current) return;
    if (
      mutationInFlightRef.current
      || chatSendInFlightRef.current
      || chatCreateInFlightRef.current
    ) {
      showNotice("请等待当前写入完成后再删除项目", "error");
      return;
    }
    if (!window.confirm(`确定删除「${project.name}」吗？此操作无法撤销。`)) return;
    setDeletingProjectId(project.id);
    setErrorMessage(null);
    try {
      await requestJson(`/api/projects/${encodeURIComponent(project.id)}`, {
        method: "DELETE",
      });
      setProjects((current) => current.filter((item) => item.id !== project.id));
      if (activeProject?.id === project.id) resetToHome();
      showNotice(`已删除「${project.name}」`);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, "删除项目失败，请重试。"));
    } finally {
      setDeletingProjectId(null);
    }
  }, [activeProject, deletingProjectId, resetToHome, showNotice]);

  const beginLogin = useCallback(async () => {
    if (accountSwitchingRef.current) return;
    if (
      phase === "building"
      || mutationInFlightRef.current
      || chatSendInFlightRef.current
      || chatCreateInFlightRef.current
    ) {
      showNotice("请等待当前写入完成后再登录", "error");
      return;
    }

    accountSwitchingRef.current = true;
    identityEpochRef.current += 1;
    openProjectRequestRef.current += 1;
    setLoginLoading(true);
    setErrorMessage(null);
    window.location.assign("/api/auth/github");
  }, [phase, showNotice]);

  const handleLogout = useCallback(async () => {
    if (accountSwitchingRef.current) return;
    if (
      phase === "building"
      || mutationInFlightRef.current
      || chatSendInFlightRef.current
      || chatCreateInFlightRef.current
    ) {
      showNotice("请等待当前写入完成后再退出", "error");
      return;
    }

    accountSwitchingRef.current = true;
    identityEpochRef.current += 1;
    openProjectRequestRef.current += 1;
    setLogoutLoading(true);
    setErrorMessage(null);
    try {
      await requestJson("/api/auth/logout", { method: "POST" });
      setUser(null);
      resetToHome();
      setProjects([]);
      setProjectsLoading(true);
      await loadProjects();
      showNotice("已退出，已切换回访客工作区");
    } catch (error) {
      setErrorMessage(getErrorMessage(error, "退出失败，请稍后再试。"));
      setVersionsLoading(false);
      void loadProjects();
    } finally {
      accountSwitchingRef.current = false;
      setLogoutLoading(false);
    }
  }, [loadProjects, phase, resetToHome, showNotice]);

  const exportProject = useCallback(async () => {
    if (!activeProject || !activeVersion) return;
    setExportLoading(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/export", {
        method: "POST",
        headers: { Accept: "application/zip", "Content-Type": "application/json" },
        body: JSON.stringify({
          artifact: activeVersion.artifact,
          spec: activeVersion.artifact,
          records,
          projectId: activeProject.id,
        }),
      });
      if (!response.ok) {
        const payload = await readResponse(response);
        const message = isRecord(payload)
          ? readString(payload.error ?? payload.message, "导出失败，请稍后再试。")
          : readString(payload, "导出失败，请稍后再试。");
        throw new Error(message);
      }

      const disposition = response.headers.get("content-disposition") ?? "";
      const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const quotedName = disposition.match(/filename="([^"]+)"/i)?.[1];
      let fileName = `${getArtifactTitle(activeVersion.artifact, "atoms-app")}.zip`;
      try {
        fileName = encodedName ? decodeURIComponent(encodedName) : quotedName || fileName;
      } catch {
        fileName = quotedName || fileName;
      }

      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      showNotice("独立项目包已导出");
    } catch (error) {
      setErrorMessage(getErrorMessage(error, "导出失败，请稍后再试。"));
    } finally {
      setExportLoading(false);
    }
  }, [activeProject, activeVersion, records, showNotice]);

  const handleRetry = useCallback(() => {
    if (retryAction === "projects") void loadProjects();
    if (retryAction === "versions" && activeProject) void openProject(activeProject);
    if (retryAction === "plan" && pendingBuild) {
      const feedback = planFeedback.trim();
      void requestBuildPlan(
        pendingBuild,
        plan && feedback ? { currentPlan: plan, feedback } : undefined,
      );
    }
    if (retryAction === "build") void executeBuild();
    if (retryAction === "rollback") void rollbackVersion();
  }, [
    activeProject,
    executeBuild,
    loadProjects,
    openProject,
    pendingBuild,
    plan,
    planFeedback,
    requestBuildPlan,
    retryAction,
    rollbackVersion,
  ]);

  const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      if (capability === "chat") void beginNewChat();
      else beginNewPlan();
    }
  };

  const handlePromptChange = (value: string) => {
    setPrompt(value);
  };

  const submitNewProject = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (capability === "chat") void beginNewChat();
    else beginNewPlan();
  };

  const submitRefinement = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    beginRefinePlan();
  };

  const startPaneResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const container = splitContainerRef.current;
    if (!container) return;
    event.preventDefault();
    const previousCursor = document.body.style.cursor;
    const previousSelection = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMove = (moveEvent: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const next = ((moveEvent.clientX - rect.left) / rect.width) * 100;
      setAgentPanePercent(Math.min(62, Math.max(32, next)));
    };
    const handleUp = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelection;
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  const cancelPlan = () => {
    planRequestRef.current += 1;
    setErrorMessage(null);
    setRetryAction(null);
    setPendingBuild(null);
    setPlan(null);
    setReasoningSummary([]);
    setPlanProvider(null);
    setPlanModel(null);
    setPlanFeedback("");
    setPlanningLoading(false);
    setMessages((current) =>
      current.filter(
        (message) =>
          message.meta !== "正在规划"
          && !message.meta?.includes("等待确认"),
      ),
    );
    setPhase(activeProject ? "ready" : "home");
    if (!activeProject) {
      setLandingView("home");
      updatePath("/");
    }
  };

  if (landingView === "projects") {
    return (
      <main className="atoms-shell">
        <AtomsSidebar
          active="projects"
          projects={recentProjects}
          projectCount={projects.length}
          activeProjectId={activeProject?.id ?? null}
          hasDraft={Boolean(pendingBuild && !activeProject)}
          draftName={pendingBuild ? deriveProjectName(pendingBuild.prompt) : null}
          user={user}
          sessionLoading={sessionLoading}
          loginLoading={loginLoading}
          logoutLoading={logoutLoading}
          busy={accountSwitching}
          workspaceBusy={workspaceWriteBusy}
          onHome={goHome}
          onProjects={goProjects}
          onOpenProject={(project) => void openProject(project)}
          onOpenDraft={resumeWorkspace}
          onLogin={() => void beginLogin()}
          onLogout={() => void handleLogout()}
        />

        <section className="atoms-page atoms-projects-page" aria-labelledby="atoms-projects-title">
          <header className="atoms-page-header">
            <div>
              <span>{workspaceOwner} 的工作区</span>
              <h1 id="atoms-projects-title">我的项目</h1>
              <p>管理已经保存的 Web App 和对话，随时继续上一次工作。</p>
            </div>
            <button
              className="atoms-primary-action"
              type="button"
              onClick={goHome}
              disabled={accountSwitching || workspaceWriteBusy}
            >
              <UiIcon name="plus" />
              创建新项目
            </button>
          </header>

          <div className="atoms-project-summary" role="tablist" aria-label="按项目类型筛选">
            {([
              ["all", "全部项目", projects.length, "folder"],
              ["chat", "对话", projects.filter((item) => item.kind === "chat").length, "message"],
              ["web_app", "Web App", projects.filter((item) => item.kind === "web_app").length, "panels"],
            ] as const).map(([filter, label, count, icon]) => (
              <button
                key={filter}
                type="button"
                role="tab"
                aria-selected={projectFilter === filter}
                className={projectFilter === filter ? "is-active" : ""}
                onClick={() => setProjectFilter(filter)}
              >
                <UiIcon name={icon} />
                <strong>{label}</strong>
                <small>{count}</small>
              </button>
            ))}
          </div>

          <div className="atoms-sync-note" role="status" aria-live="polite">
            <span><UiIcon name={user ? "github" : "folder-heart"} /></span>
            <div>
              <strong>{user ? `已同步至 ${user.login} 的 GitHub 账号` : "当前为访客工作区"}</strong>
              <p>{user ? "登录后可以在其他设备继续使用这些项目。" : "项目会保存在当前浏览器，登录 GitHub 后可跨设备访问。"}</p>
            </div>
          </div>

          {errorMessage ? <ErrorBanner message={errorMessage} onRetry={retryAction ? handleRetry : undefined} /> : null}

          {projectsLoading ? (
            <div className="atoms-project-grid" role="status" aria-label="正在载入项目" aria-busy="true">
              {[0, 1, 2].map((item) => <div className="atoms-project-card atoms-project-card--skeleton" key={item} />)}
            </div>
          ) : errorMessage && retryAction === "projects" ? null : projects.length && filteredProjects.length ? (
            <div className="atoms-project-grid">
              {filteredProjects.map((project, index) => (
                <article className={`atoms-project-card atoms-project-card--tone-${(index % 3) + 1}`} key={project.id}>
                  <button
                    className={`atoms-project-card__cover atoms-project-card__cover--${project.kind}`}
                    type="button"
                    onClick={() => void openProject(project)}
                    disabled={accountSwitching || workspaceWriteBusy}
                    aria-label={`打开项目 ${project.name}`}
                  >
                    <span className="atoms-project-card__visual" aria-hidden="true">
                      <UiIcon name={project.kind === "chat" ? "message" : "gamepad"} />
                      <i /><i /><i />
                    </span>
                    <span className="atoms-project-card__cover-label">
                      <UiIcon name={project.kind === "chat" ? "brain" : "play"} />
                      {project.kind === "chat" ? "可继续对话" : "可运行预览"}
                    </span>
                  </button>
                  <div className="atoms-project-card__body">
                    <div className="atoms-project-card__heading">
                      <span>
                        <strong>{project.name}</strong>
                        <small>{project.kind === "chat" ? "对话项目" : `Web App · v${project.currentVersion || 1}`}</small>
                      </span>
                      <button
                        className="atoms-icon-action atoms-icon-action--danger"
                        type="button"
                        onClick={() => void deleteProject(project)}
                        disabled={accountSwitching || workspaceWriteBusy}
                        aria-label={`删除项目 ${project.name}`}
                      >
                        {deletingProjectId === project.id ? "…" : <UiIcon name="trash" />}
                      </button>
                    </div>
                    <p>{project.prompt || (project.kind === "chat" ? "继续这段对话，并使用项目级长期记忆。" : "打开并继续完善这个应用。")}</p>
                    <div className="atoms-project-card__footer">
                      <span><UiIcon name="clock" />{formatRelativeDate(project.updatedAt ?? project.createdAt)}</span>
                      <button
                        type="button"
                        onClick={() => void openProject(project)}
                        disabled={accountSwitching || workspaceWriteBusy}
                      >
                        {project.kind === "chat" ? "继续对话" : "继续构建"}
                        <UiIcon name="arrow-right" />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : projects.length ? (
            <div className="atoms-project-empty">
              <span><UiIcon name={projectFilter === "chat" ? "message" : "panels"} /></span>
              <strong>这个分类还没有项目</strong>
              <p>切换到“全部”，或者从首页创建一个新项目。</p>
              <button type="button" className="atoms-primary-action" onClick={goHome}>
                <UiIcon name="plus" />去首页创建
              </button>
            </div>
          ) : (
            <div className="atoms-project-empty">
              <span><UiIcon name="folder" /></span>
              <strong>还没有项目</strong>
              <p>从一次对话或一个 Web App 想法开始。</p>
              <button type="button" className="atoms-primary-action" onClick={goHome}>
                <UiIcon name="plus" />创建第一个项目
              </button>
            </div>
          )}
        </section>
        <NoticeToast notice={notice} />
      </main>
    );
  }

  if (landingView === "home") {
    const suggestions = HOME_SUGGESTIONS[capability];
    const guides = HOME_GUIDES[capability];

    return (
      <main className="atoms-shell">
        <AtomsSidebar
          active="home"
          projects={recentProjects}
          projectCount={projects.length}
          activeProjectId={activeProject?.id ?? null}
          hasDraft={Boolean(pendingBuild && !activeProject)}
          draftName={pendingBuild ? deriveProjectName(pendingBuild.prompt) : null}
          user={user}
          sessionLoading={sessionLoading}
          loginLoading={loginLoading}
          logoutLoading={logoutLoading}
          busy={accountSwitching}
          workspaceBusy={workspaceWriteBusy}
          onHome={goHome}
          onProjects={goProjects}
          onOpenProject={(project) => void openProject(project)}
          onOpenDraft={resumeWorkspace}
          onLogin={() => void beginLogin()}
          onLogout={() => void handleLogout()}
        />

        <section className="atoms-page atoms-home-page" aria-labelledby="atoms-home-title">
          <header className="atoms-home-topbar">
            <span className="atoms-provider-status"><span className="status-dot status-dot--live" aria-hidden="true" />模型自动路由</span>
          </header>

          <div className="atoms-home-hero">
            <div className="atoms-orbit" aria-hidden="true">
              <span><UiIcon name="message" /></span>
              <span><UiIcon name="code" /></span>
              <span><UiIcon name="brain" /></span>
              <span><UiIcon name="sparkles" /></span>
            </div>
            <span className="atoms-eyebrow">AI 创作工作台</span>
            <h1 id="atoms-home-title">{capability === "chat" ? "今天想聊点什么？" : "今天想创造什么？"}</h1>
            <p>
              {capability === "chat"
                ? "创建一个持续对话，历史消息和你配置的长期记忆都会保存在当前项目。"
                : "描述你的想法，生成可运行、可继续修改并保留历史版本的 Web App。"}
            </p>

            <div className="atoms-capability-switch" role="tablist" aria-label="选择能力">
              <button
                type="button"
                role="tab"
                aria-selected={capability === "chat"}
                className={capability === "chat" ? "is-active is-chat" : "is-chat"}
                onClick={() => setCapability("chat")}
                disabled={accountSwitching || workspaceWriteBusy}
              >
                <span><UiIcon name="message" /></span>
                <span><strong>对话</strong><small>围绕一个主题持续交流，随时接着聊</small></span>
                <UiIcon name="check-circle" />
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={capability === "web_app"}
                className={capability === "web_app" ? "is-active is-web" : "is-web"}
                onClick={() => setCapability("web_app")}
                disabled={accountSwitching || workspaceWriteBusy}
              >
                <span><UiIcon name="panels" /></span>
                <span><strong>Web App 构建</strong><small>描述页面或游戏，生成并持续修改应用</small></span>
                <UiIcon name="check-circle" />
              </button>
            </div>

            <form className="atoms-composer" onSubmit={submitNewProject}>
              <label className="sr-only" htmlFor="atoms-prompt">
                {capability === "web_app" ? "描述你想创建的应用" : "输入第一条对话消息"}
              </label>
              <textarea
                id="atoms-prompt"
                value={prompt}
                onChange={(event) => handlePromptChange(event.target.value)}
                onKeyDown={handlePromptKeyDown}
                placeholder={
                  capability === "web_app"
                    ? "例如：做一个支持键盘和触屏操作的俄罗斯方块……"
                    : "输入问题、想法，或者一段需要继续讨论的内容……"
                }
                rows={4}
                maxLength={1200}
                autoFocus
                disabled={accountSwitching || workspaceWriteBusy}
              />
              <div className="atoms-composer__footer">
                <span className="atoms-mode-note">
                  <span><UiIcon name={capability === "chat" ? "brain" : "history"} /></span>
                  {capability === "chat" ? "长期记忆可配置" : "支持持续修改与版本回退"}
                </span>
                <span className="atoms-composer__actions">
                  <small>{capability === "chat" ? "开始对话" : "开始构建"}</small>
                  <button type="submit" aria-label={capability === "chat" ? "开始对话" : "开始构建"} disabled={accountSwitching || workspaceWriteBusy}>
                    <UiIcon name="arrow-up" />
                  </button>
                </span>
              </div>
            </form>

            <div className="atoms-suggestions" aria-label="推荐输入">
              <small>可以试试</small>
              {suggestions.map((suggestion) => (
                <button
                  type="button"
                  key={suggestion.label}
                  onClick={() => {
                    setPrompt(suggestion.prompt);
                    document.getElementById("atoms-prompt")?.focus();
                  }}
                >
                  <UiIcon name={suggestion.icon} />
                  {suggestion.label}
                </button>
              ))}
            </div>

            <div className="atoms-guide-grid" aria-label="功能引导">
              {guides.map((guide) => (
                <div className={`atoms-guide-item atoms-guide-item--${guide.tone}`} key={guide.title}>
                  <span><UiIcon name={guide.icon} /></span>
                  <span><strong>{guide.title}</strong><small>{guide.copy}</small></span>
                </div>
              ))}
            </div>

            <button className="atoms-project-handoff" type="button" onClick={goProjects}>
              <span><UiIcon name="folder-heart" /></span>
              <span>
                <strong>创作内容会自动保存</strong>
                <small>对话和 Web App 可在「我的项目」中继续查看、编辑或删除</small>
              </span>
              <UiIcon name="arrow-right" />
            </button>

            {errorMessage ? <ErrorBanner message={errorMessage} onRetry={retryAction ? handleRetry : undefined} /> : null}
          </div>
        </section>
        <NoticeToast notice={notice} />
      </main>
    );
  }

  const workspaceName = activeProject?.name ?? deriveProjectName(pendingBuild?.prompt ?? prompt);

  if (activeProject?.kind === "chat") {
    return (
      <main className="studio-shell chat-shell">
        <header className="studio-topbar">
          <button
            className="forge-brand forge-brand--button"
            type="button"
            onClick={goHome}
            disabled={accountSwitching}
          >
            <span className="atoms-logo-mark" aria-hidden="true"><UiIcon name="atom" /></span>
            <span className="forge-brand__word">Atoms</span>
          </button>
          <span className="studio-topbar__divider" aria-hidden="true">/</span>
          <div className="studio-topbar__project">
            <strong>{workspaceName}</strong>
            <span>对话项目</span>
          </div>
          <div className="studio-topbar__actions">
            <span className="save-indicator save-indicator--saved">
              <span className="status-dot" aria-hidden="true" />
              {user ? "云端已同步" : "访客工作区"}
            </span>
            <button
              className="chat-delete-project"
              type="button"
              onClick={() => void deleteProject(activeProject)}
              disabled={accountSwitching || workspaceWriteBusy}
            >
              {deletingProjectId === activeProject.id ? "删除中…" : "删除项目"}
            </button>
            <AccountControl
              user={user}
              loading={sessionLoading}
              loginLoading={loginLoading}
              logoutLoading={logoutLoading}
              onLogin={() => void beginLogin()}
              onLogout={() => void handleLogout()}
              compact
            />
          </div>
        </header>

        <div className={`chat-layout${memoryPanelOpen ? "" : " chat-layout--memory-hidden"}`}>
          <section className="chat-workspace" aria-labelledby="chat-title">
            <header className="chat-workspace__header">
              <div>
                <span className="agent-avatar" aria-hidden="true"><UiIcon name="sparkles" /></span>
                <div><strong id="chat-title">Atoms Agent</strong><span>连续对话</span></div>
              </div>
              <div className="chat-workspace__tools">
                <button
                  type="button"
                  className={memoryPanelOpen ? "is-active" : ""}
                  onClick={() => setMemoryPanelOpen((current) => !current)}
                  aria-expanded={memoryPanelOpen}
                  aria-controls="chat-memory-panel"
                >
                  <UiIcon name="brain" />
                  {memoryPanelOpen ? "隐藏长期记忆" : "显示长期记忆"}
                </button>
                <span className="agent-status"><i aria-hidden="true" /> 在线</span>
              </div>
            </header>

            <div className="chat-thread" aria-live="polite">
              {errorMessage ? <ErrorBanner message={errorMessage} /> : null}
              {chatLoading ? (
                <div className="chat-empty" role="status"><span><UiIcon name="message" /></span><strong>正在读取对话…</strong></div>
              ) : chatMessages.length ? (
                chatMessages.map((message) => (
                  <article className={`chat-message chat-message--${message.role}`} key={message.id}>
                    <span className="chat-message__avatar" aria-hidden="true">
                      {message.role === "assistant" ? <UiIcon name="sparkles" /> : "你"}
                    </span>
                    <div>
                      <strong>{message.role === "assistant" ? "Atoms Agent" : "你"}</strong>
                      <p>{message.content}</p>
                      {message.role === "assistant" && message.provider ? (
                        <small>{providerLabel(message.provider)}{message.model ? ` · ${message.model}` : ""}</small>
                      ) : null}
                    </div>
                  </article>
                ))
              ) : (
                <div className="chat-empty"><span><UiIcon name="message" /></span><strong>开始这段对话</strong><p>输入消息，模型会结合当前记录和已启用的长期记忆回复。</p></div>
              )}
              {chatSending ? (
                <article className="chat-message chat-message--assistant chat-message--typing">
                  <span className="chat-message__avatar" aria-hidden="true"><UiIcon name="sparkles" /></span>
                  <div><strong>Atoms Agent</strong><p>正在思考并回复…</p></div>
                </article>
              ) : null}
            </div>

            <form
              className="chat-composer"
              onSubmit={(event) => {
                event.preventDefault();
                void sendChatMessage();
              }}
            >
              <label className="sr-only" htmlFor="chat-input">发送消息</label>
              <textarea
                id="chat-input"
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendChatMessage();
                  }
                }}
                placeholder="输入消息，Enter 发送，Shift + Enter 换行…"
                rows={3}
                maxLength={4000}
                disabled={chatLoading || chatSending || Boolean(deletingProjectId) || accountSwitching}
              />
              <div>
                <span>当前上下文 {chatMessages.length} 条</span>
                <button type="submit" disabled={!chatInput.trim() || chatLoading || chatSending || Boolean(deletingProjectId) || accountSwitching}>
                  {chatSending ? "回复中…" : "发送"} <span aria-hidden="true">↑</span>
                </button>
              </div>
            </form>
          </section>

          {memoryPanelOpen ? <aside id="chat-memory-panel" className="memory-panel" aria-labelledby="memory-title">
            <header>
              <span className="section-heading__kicker">CONVERSATION MEMORY</span>
              <h2 id="memory-title">长期记忆</h2>
              <p>记录希望 Agent 在这个对话中持续参考的信息。</p>
            </header>
            <label className="memory-toggle">
              <input
                type="checkbox"
                checked={chatMemory.enabled}
                onChange={(event) => setChatMemory((current) => ({ ...current, enabled: event.target.checked }))}
              />
              <span aria-hidden="true"><i /></span>
              <strong>在回复中启用</strong>
            </label>
            <label className="memory-editor">
              <span>记忆内容</span>
              <textarea
                value={chatMemory.content}
                onChange={(event) => setChatMemory((current) => ({ ...current, content: event.target.value }))}
                placeholder="例如：我的目标、偏好、项目背景，以及希望 Agent 长期遵循的约定……"
                rows={12}
                maxLength={6000}
              />
              <small>{chatMemory.content.length} / 6000</small>
            </label>
            <button
              className="forge-button forge-button--primary memory-save"
              type="button"
              onClick={() => void saveChatMemory()}
              disabled={memorySaving}
            >
              {memorySaving ? "保存中…" : "保存记忆配置"}
            </button>
            <p className="memory-note">记忆按对话项目分别保存，只在启用后随新消息发送给模型。</p>
          </aside> : null}
        </div>
        <NoticeToast notice={notice} />
      </main>
    );
  }

  return (
    <main className="studio-shell">
      <header className="studio-topbar">
        <button
          className="forge-brand forge-brand--button"
          type="button"
          onClick={goHome}
          disabled={accountSwitching}
        >
          <span className="atoms-logo-mark" aria-hidden="true"><UiIcon name="atom" /></span>
          <span className="forge-brand__word">Atoms</span>
        </button>
        <span className="studio-topbar__divider" aria-hidden="true">/</span>
        <div className="studio-topbar__project">
          <strong>{workspaceName}</strong>
          <span>
            {phase === "building"
              ? "正在构建"
              : phase === "planning"
                ? planningLoading ? "模型规划中" : "等待确认"
                : activeVersion ? "已保存" : "等待描述"}
          </span>
        </div>
        <div className="studio-topbar__actions">
          <span
            className="save-indicator save-indicator--saved"
            role="status"
            aria-live="polite"
          >
            <span className="status-dot" aria-hidden="true" />
            {sessionLoading
              ? "正在确认工作区"
              : user
                ? "云端已同步"
                : "已保存到访客工作区"}
          </span>
          <AccountControl
            user={user}
            loading={sessionLoading}
            loginLoading={loginLoading}
            logoutLoading={logoutLoading}
            onLogin={() => void beginLogin()}
            onLogout={() => void handleLogout()}
            compact
          />
        </div>
      </header>

      <div className="version-strip" aria-label="项目版本">
        <span className="version-strip__label"><UiIcon name="history" />版本</span>
        <div className="version-strip__list">
          {versionsLoading ? <span className="version-strip__loading">正在读取版本…</span> : null}
          {!versionsLoading && !versions.length ? <span className="version-strip__empty">确认方案后将生成 v1</span> : null}
          {versions.map((version, index) => (
            <button
              className={version.id === activeVersion?.id ? "is-active" : ""}
              type="button"
              key={version.id}
              onClick={() => chooseVersion(version)}
              aria-current={version.id === activeVersion?.id ? "true" : undefined}
              disabled={accountSwitching || workspaceWriteBusy}
            >
              <strong>v{version.ordinal}</strong>
              <small>{index === 0 ? "当前" : "历史"}</small>
              <time dateTime={version.createdAt ?? undefined}>{formatRelativeDate(version.createdAt)}</time>
            </button>
          ))}
        </div>
        {isHistoricalVersion ? (
          <button
            className="version-strip__restore"
            type="button"
            onClick={() => void rollbackVersion()}
            disabled={rollbackLoading || accountSwitching}
          >
            {rollbackLoading ? "正在恢复…" : `恢复 v${activeVersion?.ordinal}`}
          </button>
        ) : (
          <span className="version-strip__saved">
            <span className="status-dot" />
            {activeVersion ? "当前版本已保存" : pendingBuild ? "构建草稿已保留" : "尚未生成版本"}
          </span>
        )}
      </div>

      <div
        className="studio-layout studio-layout--split"
        ref={splitContainerRef}
        style={{ gridTemplateColumns: `minmax(360px, ${agentPanePercent}%) 10px minmax(480px, 1fr)` }}
      >
        <section className="agent-panel" aria-labelledby="agent-title">
          <header className="panel-header">
            <div>
              <span className="agent-avatar" aria-hidden="true"><UiIcon name="sparkles" /></span>
              <div>
                <strong id="agent-title">Atoms Agent</strong>
                <span>{phase === "building" ? "正在执行计划" : "与你一起构建"}</span>
              </div>
            </div>
            <span className="agent-status"><i aria-hidden="true" /> 在线</span>
          </header>

          <div className="agent-scroll">
            {errorMessage ? (
              <ErrorBanner message={errorMessage} onRetry={retryAction ? handleRetry : undefined} />
            ) : null}

            <div className="conversation" aria-live="polite">
              {messages.map((message) => (
                <article
                  className={`message message--${message.role}`}
                  key={message.id}
                >
                  <div className="message__identity" aria-hidden="true">
                    {message.role === "agent" ? <UiIcon name="sparkles" /> : "你"}
                  </div>
                  <div className="message__body">
                    <span className="message__author">
                      {message.role === "agent" ? "Atoms Agent" : "你"}
                    </span>
                    <p>{message.text}</p>
                    {message.meta ? <small>{message.meta}</small> : null}
                  </div>
                </article>
              ))}

            {phase === "planning" && pendingBuild ? (
              planningLoading ? (
                <section className="planning-card planning-card--inline" aria-busy="true" aria-live="polite">
                  <span className="planning-card__spinner" aria-hidden="true">✦</span>
                  <div>
                    <span className="section-heading__kicker">MODEL PLANNING</span>
                    <h2>正在生成 BuildPlan</h2>
                    <p>模型正在分析需求、交互流程、实现步骤和验收标准。</p>
                  </div>
                  <button
                    className="forge-button forge-button--ghost"
                    type="button"
                    onClick={cancelPlan}
                    disabled={accountSwitching}
                  >
                    取消
                  </button>
                </section>
              ) : plan ? (
                <section className="build-plan build-plan--inline" aria-labelledby="plan-title">
                  <div className="build-plan__header">
                    <div>
                      <span className="section-heading__kicker">MODEL BUILDPLAN</span>
                      <h2 id="plan-title">{plan.title}</h2>
                    </div>
                    <span className="plan-badge">
                      Web App · {plan.implementationSteps.length} steps
                    </span>
                  </div>
                  <p className="build-plan__brief">{plan.requestSummary}</p>

                  <div className="build-plan__reasoning">
                    <strong>模型决策摘要</strong>
                    {reasoningSummary.length ? (
                      <ul>
                        {reasoningSummary.map((item, index) => (
                          <li key={`${item}-${index}`}>{item}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>模型未提供额外决策摘要。</p>
                    )}
                  </div>

                  {plan.designDecisions.length || plan.interactionFlow.length ? (
                    <div className="plan-overview">
                      {plan.designDecisions.length ? (
                        <section>
                          <h3>设计决策</h3>
                          <ul>
                            {plan.designDecisions.map((item, index) => (
                              <li key={`${item}-${index}`}>{item}</li>
                            ))}
                          </ul>
                        </section>
                      ) : null}
                      {plan.interactionFlow.length ? (
                        <section>
                          <h3>交互流程</h3>
                          <ol>
                            {plan.interactionFlow.map((item, index) => (
                              <li key={`${item}-${index}`}>{item}</li>
                            ))}
                          </ol>
                        </section>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="plan-section-heading">
                    <h3>实现步骤</h3>
                    <small>
                      {providerLabel(planProvider)}
                      {planModel ? ` · ${planModel}` : ""}
                    </small>
                  </div>
                  <ol className="plan-steps">
                    {plan.implementationSteps.map((step, index) => (
                      <li key={`${step.title}-${index}`}>
                        <span className="plan-steps__number">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <div>
                          <strong>{step.title}</strong>
                          <p>{step.description}</p>
                        </div>
                        <span className="plan-steps__ready" aria-label="已规划">✓</span>
                      </li>
                    ))}
                  </ol>

                  <div className="plan-details">
                    <section>
                      <h3>前提假设</h3>
                      {plan.assumptions.length ? (
                        <ul>
                          {plan.assumptions.map((item, index) => (
                            <li key={`${item}-${index}`}>{item}</li>
                          ))}
                        </ul>
                      ) : <p>无额外假设</p>}
                    </section>
                    <section>
                      <h3>验收标准</h3>
                      {plan.acceptanceCriteria.length ? (
                        <ul>
                          {plan.acceptanceCriteria.map((item, index) => (
                            <li key={`${item}-${index}`}>{item}</li>
                          ))}
                        </ul>
                      ) : <p>以主要交互可完整运行作为验收标准</p>}
                    </section>
                  </div>

                  <div className="build-plan__note">
                    <span aria-hidden="true">◎</span>
                    <p>
                      <strong>版本安全</strong>
                      {pendingBuild.kind === "refine"
                        ? "这次调整会创建新版本，不会覆盖当前成果。"
                        : "生成的完整网页会保存为项目版本，并支持继续调整和导出。"}
                    </p>
                  </div>
                  <div className="plan-feedback">
                    <label htmlFor="plan-feedback-input">
                      <strong>继续调整当前方案</strong>
                      <span>告诉 Agent 要增加、删除或修改什么，它会基于当前 BuildPlan 继续优化。</span>
                    </label>
                    <div>
                      <textarea
                        id="plan-feedback-input"
                        value={planFeedback}
                        onChange={(event) => setPlanFeedback(event.target.value)}
                        placeholder="例如：不要使用 Canvas，改成 DOM 网格；再增加移动端触控方案……"
                        rows={3}
                        maxLength={1000}
                        disabled={planningLoading || accountSwitching}
                      />
                      <button
                        className="forge-button forge-button--secondary"
                        type="button"
                        onClick={adjustBuildPlan}
                        disabled={!planFeedback.trim() || planningLoading || accountSwitching}
                      >
                        <span aria-hidden="true">↻</span>
                        调整方案
                      </button>
                    </div>
                  </div>
                  <div className="build-plan__actions">
                    <button
                      className="forge-button forge-button--ghost"
                      type="button"
                      onClick={cancelPlan}
                      disabled={accountSwitching}
                    >
                      返回调整
                    </button>
                    <button
                      className="forge-button forge-button--primary"
                      type="button"
                      onClick={() => void executeBuild()}
                      disabled={accountSwitching}
                    >
                      <span aria-hidden="true">✦</span>
                      确认并构建
                    </button>
                  </div>
                </section>
              ) : null
            ) : null}

            {phase === "building" ? (
              <section className="building-card building-card--inline" aria-labelledby="building-title" aria-busy="true">
                <div className="building-card__orb" aria-hidden="true">
                  <span /><span /><i>✦</i>
                </div>
                <span className="section-heading__kicker">ATOMS IS BUILDING</span>
                <h2 id="building-title">正在把计划变成应用</h2>
                <p>正在调用真实生成服务。完成时间取决于模型响应。</p>
                <ol className="building-log">
                  {buildLog.map((entry, index) => (
                    <li className={index === buildLog.length - 1 ? "is-active" : "is-done"} key={`${entry}-${index}`}>
                      <span aria-hidden="true">{index === buildLog.length - 1 ? "·" : "✓"}</span>
                      {entry}
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            {phase === "ready" && activeVersion ? (
              <section className="build-summary build-summary--inline" aria-label="当前应用摘要">
                <div className="build-summary__topline">
                  <span className="summary-icon" aria-hidden="true">✓</span>
                  <div>
                    <strong>{getArtifactTitle(activeVersion.artifact, activeProject?.name)}</strong>
                    <p>{getArtifactDescription(activeVersion.artifact) || "应用已生成并可以直接运行。"}</p>
                  </div>
                  <span className={`provider-pill provider-pill--${activeVersion.provider ?? "local"}`}>
                    {providerLabel(activeVersion.provider)}
                  </span>
                  <span className="version-pill">v{activeVersion.ordinal}</span>
                </div>
                <div className="build-summary__stats">
                  <span>
                    <strong>{isWebAppArtifact(activeVersion.artifact) ? "Web" : "Legacy"}</strong>
                    {isWebAppArtifact(activeVersion.artifact) ? " 完整网页" : " 旧版项目兼容预览"}
                  </span>
                  <span><strong>Live</strong> 实时预览</span>
                  <span>
                    <strong>{providerLabel(activeVersion.provider)}</strong> 生成来源
                  </span>
                </div>
                {isHistoricalVersion ? (
                  <div className="history-callout">
                    <div>
                      <strong>你正在查看历史版本 v{activeVersion.ordinal}</strong>
                      <p>恢复操作会复制成一个新版本，不会删除后续改动。</p>
                    </div>
                    <button
                      className="forge-button forge-button--secondary"
                      type="button"
                      onClick={() => void rollbackVersion()}
                      disabled={rollbackLoading || accountSwitching}
                    >
                      {rollbackLoading ? "正在恢复…" : "恢复此版本"}
                    </button>
                  </div>
                ) : null}
              </section>
            ) : null}
            </div>
          </div>

          {phase === "ready" && activeVersion ? (
            <form className="refine-composer" onSubmit={submitRefinement}>
              <label htmlFor="refine-input">继续调整这个应用</label>
              <div className="refine-composer__box">
                <textarea
                  id="refine-input"
                  value={instruction}
                  onChange={(event) => setInstruction(event.target.value)}
                  placeholder="例如：增加暂停按钮，把界面改成复古像素风……"
                  rows={3}
                  maxLength={800}
                  disabled={accountSwitching}
                />
                <button
                  type="submit"
                  className="refine-composer__submit"
                  aria-label="生成调整计划"
                  disabled={!instruction.trim() || accountSwitching}
                >
                  <span aria-hidden="true">↑</span>
                </button>
              </div>
              <span>调整会创建新版本 · 原版本可随时恢复</span>
            </form>
          ) : null}
        </section>

        <div
          className="workspace-resizer"
          role="separator"
          aria-label="调整对话与预览宽度"
          aria-orientation="vertical"
          aria-valuemin={32}
          aria-valuemax={62}
          aria-valuenow={Math.round(agentPanePercent)}
          onPointerDown={startPaneResize}
        >
          <span aria-hidden="true"><i /><i /><i /></span>
        </div>

        <section className="inspector-panel" aria-labelledby="inspector-title">
          <header className="inspector-header">
            <div className="inspector-tabs" role="tablist" aria-label="输出查看方式">
              {(["preview", "code", "spec"] as const).map((tab) => (
                <button
                  id={`tab-${tab}`}
                  role="tab"
                  aria-selected={inspectorTab === tab}
                  aria-controls={`panel-${tab}`}
                  className={inspectorTab === tab ? "is-active" : ""}
                  type="button"
                  key={tab}
                  onClick={() => setInspectorTab(tab)}
                >
                  {tab === "preview" ? "预览" : tab === "code" ? "代码" : "生成详情"}
                </button>
              ))}
            </div>
            <h2 className="sr-only" id="inspector-title">应用输出</h2>
            <div className="inspector-toolbar">
              {activeVersion ? (
                <button
                  type="button"
                  className="inspector-export"
                  onClick={() => void exportProject()}
                  disabled={exportLoading}
                >
                  <UiIcon name="download" />
                  {exportLoading ? "正在导出…" : "导出项目"}
                </button>
              ) : null}
              <div className="preview-size" aria-label="预览尺寸">
                <button
                  type="button"
                  className={previewSize === "desktop" ? "is-active" : ""}
                  onClick={() => setPreviewSize("desktop")}
                  aria-pressed={previewSize === "desktop"}
                  aria-label="桌面预览"
                >
                  <span aria-hidden="true">▱</span>
                </button>
                <button
                  type="button"
                  className={previewSize === "mobile" ? "is-active" : ""}
                  onClick={() => setPreviewSize("mobile")}
                  aria-pressed={previewSize === "mobile"}
                  aria-label="移动端预览"
                >
                  <span aria-hidden="true">▯</span>
                </button>
              </div>
            </div>
          </header>

          <div className="inspector-body">
            {inspectorTab === "preview" ? (
              <div
                id="panel-preview"
                role="tabpanel"
                aria-labelledby="tab-preview"
                className={`preview-stage preview-stage--${previewSize}`}
              >
                {activeVersion && previewHtml ? (
                  <div
                    className={`preview-device${isHistoricalVersion || accountSwitching ? " preview-device--readonly" : ""}`}
                  >
                    <div className="preview-device__chrome" aria-hidden="true">
                      <span /><span /><span />
                      <div>chance-atoms.app/{activeProject?.id.slice(0, 8)}</div>
                    </div>
                    <iframe
                      ref={iframeRef}
                      title={`${activeProject?.name ?? "Atoms 应用"} 可运行预览`}
                      srcDoc={previewHtml}
                      sandbox="allow-scripts allow-forms allow-modals"
                      referrerPolicy="no-referrer"
                      tabIndex={isHistoricalVersion || accountSwitching ? -1 : 0}
                    />
                    {accountSwitching ? (
                      <div className="preview-readonly" role="status">
                        正在切换账号 · 暂停编辑
                      </div>
                    ) : isHistoricalVersion ? (
                      <div className="preview-readonly" role="status">
                        历史版本只读 · 恢复后可编辑
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <PreviewPlaceholder phase={phase} />
                )}
              </div>
            ) : inspectorTab === "code" ? (
              <div
                id="panel-code"
                role="tabpanel"
                aria-labelledby="tab-code"
                className="code-view"
              >
                <div className="code-view__header">
                  <span><i aria-hidden="true" /> index.html</span>
                  <span>{previewHtml ? `${previewHtml.split("\n").length} lines` : "等待生成"}</span>
                </div>
                <pre><code>{previewHtml || "// 确认计划后，生成的运行代码会显示在这里。"}</code></pre>
              </div>
            ) : (
              <div
                id="panel-spec"
                role="tabpanel"
                aria-labelledby="tab-spec"
                className="code-view code-view--spec"
              >
                <div className="code-view__header">
                  <span>
                    <i aria-hidden="true" />
                    version.json
                  </span>
                  <span>完整版本描述</span>
                </div>
                <pre><code>{activeVersion ? JSON.stringify({
                  artifact: activeVersion.artifact,
                  buildPlan: activeVersion.buildPlan,
                  reasoningSummary: activeVersion.reasoningSummary,
                }, null, 2) : "{}"}</code></pre>
              </div>
            )}
          </div>
        </section>
      </div>

      <NoticeToast notice={notice} />
    </main>
  );
}

function AtomsSidebar({
  active,
  projects,
  projectCount,
  activeProjectId,
  hasDraft,
  draftName,
  user,
  sessionLoading,
  loginLoading,
  logoutLoading,
  busy,
  workspaceBusy,
  onHome,
  onProjects,
  onOpenProject,
  onOpenDraft,
  onLogin,
  onLogout,
}: {
  active: "home" | "projects";
  projects: ProjectItem[];
  projectCount: number;
  activeProjectId: string | null;
  hasDraft: boolean;
  draftName: string | null;
  user: SessionUser | null;
  sessionLoading: boolean;
  loginLoading: boolean;
  logoutLoading: boolean;
  busy: boolean;
  workspaceBusy: boolean;
  onHome: () => void;
  onProjects: () => void;
  onOpenProject: (project: ProjectItem) => void;
  onOpenDraft: () => void;
  onLogin: () => void;
  onLogout: () => void;
}) {
  return (
    <aside className="atoms-sidebar" aria-label="主导航">
      <div className="atoms-sidebar__brand">
        <span className="atoms-logo-mark" aria-hidden="true"><UiIcon name="atom" /></span>
        <strong>Atoms</strong>
        <span>Demo</span>
      </div>

      <nav className="atoms-nav">
        <button
          type="button"
          className={active === "home" ? "is-active" : ""}
          aria-current={active === "home" ? "page" : undefined}
          onClick={onHome}
          disabled={busy}
        >
          <span className="atoms-nav__icon atoms-nav__icon--home"><UiIcon name="home" /></span>
          首页
        </button>
        <button
          type="button"
          className={active === "projects" ? "is-active" : ""}
          aria-current={active === "projects" ? "page" : undefined}
          onClick={onProjects}
          disabled={busy}
        >
          <span className="atoms-nav__icon atoms-nav__icon--projects"><UiIcon name="folder" /></span>
          我的项目
          <small>{projectCount}</small>
        </button>
      </nav>

      <div className="atoms-sidebar__section-label">
        <span>最近项目</span>
        <small>最近 5 个</small>
      </div>
      <div className="atoms-sidebar__recent">
        {hasDraft ? (
          <button type="button" className="is-draft" onClick={onOpenDraft} disabled={busy}>
            <span className="atoms-recent-icon atoms-recent-icon--web"><UiIcon name="panels" /></span>
            <span><strong>{draftName || "未命名 Web App"}</strong><small>构建草稿 · 点击继续</small></span>
            <i className="atoms-recent-live" aria-label="进行中" />
          </button>
        ) : null}
        {projects.map((project) => (
          <button
            type="button"
            key={project.id}
            onClick={() => onOpenProject(project)}
            disabled={busy || (workspaceBusy && project.id !== activeProjectId)}
          >
            <span className={`atoms-recent-icon atoms-recent-icon--${project.kind === "chat" ? "chat" : "web"}`}>
              <UiIcon name={project.kind === "chat" ? "message" : "panels"} />
            </span>
            <span>
              <strong>{project.name}</strong>
              <small>{project.currentVersion === 0 && project.kind === "web_app" ? "构建草稿" : project.kind === "chat" ? "对话" : `Web App · v${project.currentVersion}`}</small>
            </span>
            <UiIcon name="arrow-right" />
          </button>
        ))}
        {!hasDraft && !projects.length ? (
          <button type="button" className="atoms-sidebar__recent-empty" onClick={onHome} disabled={busy}>
            <span className="atoms-recent-icon atoms-recent-icon--empty"><UiIcon name="sparkles" /></span>
            <span><strong>还没有项目</strong><small>从首页输入一个想法开始</small></span>
            <UiIcon name="arrow-right" />
          </button>
        ) : null}
      </div>

      <div className="atoms-sidebar__bottom">
        <AccountControl
          user={user}
          loading={sessionLoading}
          loginLoading={loginLoading}
          logoutLoading={logoutLoading}
          onLogin={onLogin}
          onLogout={onLogout}
          compact
        />
      </div>
    </aside>
  );
}

function AccountControl({
  user,
  loading,
  loginLoading,
  logoutLoading,
  onLogin,
  onLogout,
  compact = false,
}: {
  user: SessionUser | null;
  loading: boolean;
  loginLoading: boolean;
  logoutLoading: boolean;
  onLogin: () => void;
  onLogout: () => void;
  compact?: boolean;
}) {
  const className = `account-control${compact ? " account-control--compact" : ""}`;

  if (loading) {
    return (
      <div className={`${className} account-control--loading`} role="status" aria-label="正在检查登录状态">
        <span className="account-control__skeleton" aria-hidden="true" />
        <span className="sr-only">正在检查登录状态</span>
      </div>
    );
  }

  if (!user) {
    return (
      <button
        className={`${className} account-control--login`}
        type="button"
        onClick={onLogin}
        disabled={loginLoading || logoutLoading}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
          <path
            fill="currentColor"
            d="M12 .7a11.5 11.5 0 0 0-3.64 22.4c.58.1.79-.25.79-.56v-2.24c-3.23.7-3.91-1.37-3.91-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.17.08 1.78 1.2 1.78 1.2 1.04 1.78 2.72 1.27 3.38.97.1-.75.4-1.27.74-1.56-2.58-.3-5.29-1.29-5.29-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.16 1.18a10.9 10.9 0 0 1 5.76 0c2.19-1.49 3.15-1.18 3.15-1.18.64 1.59.24 2.76.12 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.72 5.39-5.31 5.68.42.36.79 1.07.79 2.16v3.2c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z"
          />
        </svg>
        <span>{loginLoading || logoutLoading ? "切换中…" : "GitHub 登录"}</span>
      </button>
    );
  }

  const displayName = user.name || user.login;
  const initial = Array.from(displayName.trim())[0]?.toUpperCase() || "U";

  return (
    <div className={`${className} account-control--signed-in`}>
      <div className="account-control__identity" aria-label={`已登录为 ${displayName}，GitHub 用户名 ${user.login}`}>
        <span className="account-control__avatar" aria-hidden="true">
          {initial}
          {user.avatarUrl ? (
            // GitHub avatar domains are dynamic, so a native image keeps OAuth profiles portable.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.avatarUrl}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={(event) => {
                event.currentTarget.hidden = true;
              }}
            />
          ) : null}
        </span>
        <span className="account-control__text">
          <strong>{displayName}</strong>
          <small>@{user.login}</small>
        </span>
      </div>
      <button
        className="account-control__logout"
        type="button"
        onClick={onLogout}
        disabled={loginLoading || logoutLoading}
        aria-label={`退出 ${user.login} 的账号`}
      >
        {logoutLoading ? "退出中…" : "退出"}
      </button>
    </div>
  );
}

function NoticeToast({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  return (
    <div
      className={`forge-toast forge-toast--${notice.tone}`}
      role={notice.tone === "error" ? "alert" : "status"}
      aria-live={notice.tone === "error" ? "assertive" : "polite"}
    >
      <span aria-hidden="true">{notice.tone === "error" ? "!" : "✓"}</span>
      {notice.text}
    </div>
  );
}

function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="error-banner" role="alert">
      <span className="error-banner__icon" aria-hidden="true">!</span>
      <p>{message}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry}>重试</button>
      ) : null}
    </div>
  );
}

function PreviewPlaceholder({ phase }: { phase: StudioPhase }) {
  return (
    <div className="preview-placeholder" aria-live="polite">
      <div className="preview-placeholder__grid" aria-hidden="true" />
      <div className="preview-placeholder__content">
        <span className={phase === "building" ? "is-building" : ""} aria-hidden="true">✦</span>
        <strong>{phase === "building" ? "正在生成预览" : "预览等待构建"}</strong>
        <p>
          {phase === "building"
            ? "Atoms 正在连接数据、界面与交互。"
            : "确认左侧计划后，可运行应用会出现在这里。"}
        </p>
      </div>
    </div>
  );
}
