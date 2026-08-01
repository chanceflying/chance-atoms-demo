"use client";

import {
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { AppRecord, AppSpec } from "@/lib/app-spec";
import { compileAppToHtml } from "@/lib/generator";
import { reconcileRecordsForSpec } from "@/lib/reconcile-records";

type StudioPhase = "home" | "planning" | "building" | "ready";
type InspectorTab = "preview" | "code" | "spec";
type PreviewSize = "desktop" | "mobile";
type PersistStatus = "idle" | "saving" | "saved" | "error";
type RetryAction = "projects" | "versions" | "build" | "rollback" | null;

type ProjectItem = {
  id: string;
  name: string;
  prompt: string;
  records: AppRecord[];
  currentVersion: number;
  createdAt: string | null;
  updatedAt: string | null;
};

type VersionItem = {
  id: string;
  projectId: string;
  ordinal: number;
  prompt: string;
  instruction: string | null;
  spec: AppSpec;
  records: AppRecord[];
  provider: string | null;
  model: string | null;
  warning: string | null;
  stages: string[];
  createdAt: string | null;
};

type PendingBuild = {
  kind: "new" | "refine";
  prompt: string;
  instruction?: string;
  previousSpec?: AppSpec;
  projectId?: string;
};

type PendingPersistence = {
  records: AppRecord[];
  projectId: string;
  versionId: string;
};

type PlanStep = {
  title: string;
  detail: string;
};

type ConversationMessage = {
  id: string;
  role: "user" | "agent";
  text: string;
  meta?: string;
};

type GenerateResponse = {
  spec: AppSpec;
  provider: "openai" | "local";
  model: string | null;
  warning: string | null;
  stages: string[];
};

type SessionUser = {
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
};

type Notice = {
  text: string;
  tone: "success" | "error";
};

const STARTERS = [
  {
    eyebrow: "销售 · CRM",
    title: "客户线索看板",
    description: "收集客户、标记跟进阶段，并按负责人快速筛选。",
    prompt:
      "做一个客户线索管理工具，包含客户名称、联系人、手机号、意向产品、跟进阶段和负责人，支持按跟进阶段筛选，并提供 4 条示例数据。",
    accent: "violet",
  },
  {
    eyebrow: "内容 · 协作",
    title: "内容发布日历",
    description: "管理选题、渠道和发布时间，清楚看到制作进度。",
    prompt:
      "做一个内容发布计划工具，包含选题、发布渠道、负责人、计划日期和制作状态，支持按制作状态筛选，并提供 5 条示例数据。",
    accent: "cyan",
  },
  {
    eyebrow: "运营 · 巡检",
    title: "设备巡检台",
    description: "登记巡检结果、风险等级与处理状态，减少遗漏。",
    prompt:
      "做一个设备巡检记录工具，包含设备名称、区域、巡检人、巡检日期、风险等级、处理状态和备注，支持按处理状态筛选，并提供 4 条示例数据。",
    accent: "amber",
  },
] as const;

const BUILDING_STAGES = [
  "理解业务目标",
  "设计数据结构",
  "组装页面与交互",
  "准备可运行预览",
];

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

function parseAppSpec(value: unknown): AppSpec | null {
  const parsed = parseJson(value);
  return isRecord(parsed) ? (parsed as unknown as AppSpec) : null;
}

function parseRecords(value: unknown): AppRecord[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? (parsed as AppRecord[]) : [];
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
    name: readString(row.name ?? row.title, "未命名应用"),
    prompt: readString(row.prompt ?? row.originalPrompt ?? row.description),
    records: parseRecords(row.records),
    currentVersion: readNumber(row.currentVersion ?? row.current_version, 0),
    createdAt: readNullableString(row.createdAt ?? row.created_at),
    updatedAt: readNullableString(row.updatedAt ?? row.updated_at),
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
  };
}

function normalizeVersion(
  value: unknown,
  fallbackProjectId: string,
  fallbackOrdinal = 1,
): VersionItem | null {
  const row = unwrapObject(value, ["version", "data"]);
  if (!row) return null;
  const spec = parseAppSpec(row.spec ?? row.appSpec ?? row.app_spec);
  if (!spec) return null;
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
    spec,
    records: parseRecords(row.records ?? row.recordsJson ?? row.records_json),
    provider: readNullableString(row.provider),
    model: readNullableString(row.model),
    warning: readNullableString(row.warning),
    stages: Array.isArray(stagesValue)
      ? stagesValue.filter((item): item is string => typeof item === "string")
      : [],
    createdAt: readNullableString(row.createdAt ?? row.created_at),
  };
}

function sortVersions(items: VersionItem[]): VersionItem[] {
  return [...items].sort((a, b) => {
    if (b.ordinal !== a.ordinal) return b.ordinal - a.ordinal;
    return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
  });
}

function getSpecTitle(spec: AppSpec, fallback = "未命名应用"): string {
  const row = spec as unknown as Record<string, unknown>;
  return readString(row.name ?? row.title ?? row.appName, fallback).trim() || fallback;
}

function getSpecDescription(spec: AppSpec): string {
  const row = spec as unknown as Record<string, unknown>;
  return readString(row.description ?? row.subtitle);
}

function getSpecSeedData(spec: AppSpec): AppRecord[] {
  const row = spec as unknown as Record<string, unknown>;
  return parseRecords(row.seedData ?? row.seed_data);
}

function deriveProjectName(prompt: string, spec?: AppSpec): string {
  if (spec) {
    const specTitle = getSpecTitle(spec, "");
    if (specTitle) return specTitle.slice(0, 32);
  }
  const clean = prompt
    .replace(/[，。！？、,.!?]/g, " ")
    .replace(/^(请|帮我|给我|做一个|创建一个|生成一个)+/g, "")
    .trim();
  return (clean.split(/\s+/).slice(0, 5).join(" ") || "我的新应用").slice(0, 32);
}

function makePlan(build: PendingBuild): PlanStep[] {
  const focus = build.kind === "new" ? "建立应用骨架" : "保留现有能力并增量调整";
  return [
    {
      title: "梳理目标与信息",
      detail: `${focus}，从描述中识别核心对象、字段与必填项。`,
    },
    {
      title: "组织数据与视图",
      detail: "生成清晰的列表、录入表单和适合当前场景的筛选方式。",
    },
    {
      title: "连接真实交互",
      detail: "让新增、编辑、删除和筛选可以直接操作，并持久保存记录。",
    },
    {
      title: "生成并检查预览",
      detail: "装入示例数据，完成桌面与移动尺寸下的可运行预览。",
    },
  ];
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
    throw new Error(message);
  }
  return payload;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function safeCompile(
  spec: AppSpec | null,
  records: AppRecord[],
  projectId: string,
): string {
  if (!spec) return "";
  try {
    return compileAppToHtml(spec, records, projectId);
  } catch (error) {
    const message = getErrorMessage(error, "预览编译失败");
    return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{font-family:system-ui;padding:40px;color:#24262b}main{max-width:560px;margin:auto;border:1px solid #ddd;border-radius:16px;padding:24px}p{color:#666}</style><main><h1>预览暂不可用</h1><p>${message.replace(/[<>&]/g, "")}</p></main></html>`;
  }
}

export default function Studio() {
  const [phase, setPhase] = useState<StudioPhase>("home");
  const [prompt, setPrompt] = useState("");
  const [instruction, setInstruction] = useState("");
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [activeProject, setActiveProject] = useState<ProjectItem | null>(null);
  const [versions, setVersions] = useState<VersionItem[]>([]);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [records, setRecords] = useState<AppRecord[]>([]);
  const [pendingBuild, setPendingBuild] = useState<PendingBuild | null>(null);
  const [plan, setPlan] = useState<PlanStep[]>([]);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("preview");
  const [previewSize, setPreviewSize] = useState<PreviewSize>("desktop");
  const [buildingStage, setBuildingStage] = useState(0);
  const [persistStatus, setPersistStatus] = useState<PersistStatus>("idle");
  const [rollbackLoading, setRollbackLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryAction, setRetryAction] = useState<RetryAction>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingPersistenceRef = useRef<PendingPersistence | null>(null);
  const persistFailedRef = useRef(false);
  const accountSwitchingRef = useRef(false);
  const mutationInFlightRef = useRef(false);
  const identityEpochRef = useRef(0);
  const openProjectRequestRef = useRef(0);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const accountSwitching = loginLoading || logoutLoading;

  const activeVersion = useMemo(
    () => versions.find((version) => version.id === activeVersionId) ?? versions[0] ?? null,
    [activeVersionId, versions],
  );

  const latestVersion = versions[0] ?? null;
  const isHistoricalVersion = Boolean(
    activeVersion && latestVersion && activeVersion.id !== latestVersion.id,
  );

  const previewHtml = useMemo(
    () => safeCompile(activeVersion?.spec ?? null, records, activeProject?.id ?? "draft"),
    [activeProject?.id, activeVersion?.spec, records],
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
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (phase !== "building") return;
    const timer = setInterval(() => {
      setBuildingStage((current) => Math.min(current + 1, BUILDING_STAGES.length - 1));
    }, 850);
    return () => clearInterval(timer);
  }, [phase]);

  const openProject = useCallback(async (project: ProjectItem) => {
    const identityEpoch = identityEpochRef.current;
    const requestId = openProjectRequestRef.current + 1;
    openProjectRequestRef.current = requestId;
    setActiveProject(project);
    setVersions([]);
    setActiveVersionId(null);
    setRecords([]);
    setPhase("ready");
    setVersionsLoading(true);
    setErrorMessage(null);
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
  }, []);

  const resetToHome = useCallback(() => {
    openProjectRequestRef.current += 1;
    setPhase("home");
    setVersionsLoading(false);
    setActiveProject(null);
    setVersions([]);
    setActiveVersionId(null);
    setRecords([]);
    setPendingBuild(null);
    setPlan([]);
    setMessages([]);
    setInstruction("");
    setErrorMessage(null);
    setRetryAction(null);
    setPersistStatus("idle");
  }, []);

  const beginNewPlan = useCallback(() => {
    if (accountSwitchingRef.current) return;
    const cleanPrompt = prompt.trim();
    if (cleanPrompt.length < 4) {
      setErrorMessage("再多描述一点吧，例如要管理什么、需要哪些信息。 ");
      setRetryAction(null);
      return;
    }
    const build: PendingBuild = { kind: "new", prompt: cleanPrompt };
    setPendingBuild(build);
    setPlan(makePlan(build));
    setMessages([
      { id: makeId("message"), role: "user", text: cleanPrompt },
      {
        id: makeId("message"),
        role: "agent",
        text: "我已经把需求拆成 4 步。确认后我才会开始生成，你也可以先返回补充描述。",
        meta: "等待确认",
      },
    ]);
    setErrorMessage(null);
    setRetryAction(null);
    setPhase("planning");
  }, [prompt]);

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
      prompt: activeProject.prompt || activeVersion.prompt || getSpecTitle(activeVersion.spec),
      instruction: cleanInstruction,
      previousSpec: activeVersion.spec,
      projectId: activeProject.id,
    };
    setPendingBuild(build);
    setPlan(makePlan(build));
    setMessages((current) => [
      ...current,
      { id: makeId("message"), role: "user", text: cleanInstruction },
      {
        id: makeId("message"),
        role: "agent",
        text: "我会在当前版本上增量调整，并保留旧版本供随时恢复。先确认一下执行计划。",
        meta: "等待确认",
      },
    ]);
    setErrorMessage(null);
    setRetryAction(null);
    setPhase("planning");
  }, [activeProject, activeVersion, instruction]);

  const persistVersion = useCallback(
    async (
      project: ProjectItem,
      generated: GenerateResponse,
      build: PendingBuild,
      nextRecords: AppRecord[],
    ): Promise<VersionItem> => {
      const payload = await requestJson(
        `/api/projects/${encodeURIComponent(project.id)}/versions`,
        {
          method: "POST",
          body: JSON.stringify({
            spec: generated.spec,
            records: nextRecords,
            prompt: build.prompt,
            instruction: build.instruction ?? null,
            provider: generated.provider,
            model: generated.model,
            warning: generated.warning,
            stages: generated.stages,
          }),
        },
      );
      const normalized = normalizeVersion(payload, project.id, (latestVersion?.ordinal ?? 0) + 1);
      if (normalized) {
        return {
          ...normalized,
          prompt: build.prompt,
          records: nextRecords,
          provider: generated.provider,
          model: generated.model,
          warning: generated.warning,
          stages: generated.stages,
        };
      }
      return {
        id: makeId("version"),
        projectId: project.id,
        ordinal: (latestVersion?.ordinal ?? 0) + 1,
        prompt: build.prompt,
        instruction: build.instruction ?? null,
        spec: generated.spec,
        records: nextRecords,
        provider: generated.provider,
        model: generated.model,
        warning: generated.warning,
        stages: generated.stages,
        createdAt: new Date().toISOString(),
      };
    },
    [latestVersion?.ordinal],
  );

  const executeBuild = useCallback(async () => {
    if (!pendingBuild) return;
    if (accountSwitchingRef.current) {
      showNotice("账号切换完成后再开始构建", "error");
      return;
    }
    if (mutationInFlightRef.current) return;
    mutationInFlightRef.current = true;
    const build = pendingBuild;
    setBuildingStage(0);
    setPhase("building");
    setErrorMessage(null);
    setRetryAction(null);
    setInspectorTab("preview");
    try {
      const generatedPayload = await requestJson("/api/generate", {
        method: "POST",
        body: JSON.stringify({
          prompt: build.prompt,
          ...(build.previousSpec ? { previousSpec: build.previousSpec } : {}),
          ...(build.instruction ? { instruction: build.instruction } : {}),
        }),
      });
      if (!isRecord(generatedPayload) || !parseAppSpec(generatedPayload.spec)) {
        throw new Error("生成结果缺少可运行的应用描述，请重试。 ");
      }
      const generated: GenerateResponse = {
        spec: parseAppSpec(generatedPayload.spec) as AppSpec,
        provider: generatedPayload.provider === "openai" ? "openai" : "local",
        model: readNullableString(generatedPayload.model),
        warning: readNullableString(generatedPayload.warning),
        stages: Array.isArray(generatedPayload.stages)
          ? generatedPayload.stages.filter(
              (item: unknown): item is string => typeof item === "string",
            )
          : [],
      };

      let project = activeProject;
      if (build.kind === "new") {
        const projectPayload = await requestJson("/api/projects", {
          method: "POST",
          body: JSON.stringify({
            name: deriveProjectName(build.prompt, generated.spec),
            prompt: build.prompt,
          }),
        });
        project = normalizeProject(projectPayload);
        if (!project) throw new Error("应用已生成，但创建项目失败，请重试。 ");
      }
      if (!project) throw new Error("找不到要更新的项目，请返回首页重试。 ");

      const generatedSeed = getSpecSeedData(generated.spec);
      const nextRecords =
        build.kind === "refine"
          ? reconcileRecordsForSpec(records, generated.spec)
          : generatedSeed;
      const version = await persistVersion(project, generated, build, nextRecords);
      const nextVersions = sortVersions([
        version,
        ...versions.filter((item) => item.id !== version.id),
      ]);
      setActiveProject(project);
      setVersions(nextVersions);
      setActiveVersionId(version.id);
      setRecords(version.records);
      setInstruction("");
      setPendingBuild(null);
      setPlan([]);
      setPersistStatus("saved");
      setMessages((current) => [
        ...current.filter((message) => message.meta !== "等待确认"),
        {
          id: makeId("message"),
          role: "agent",
          text:
            build.kind === "new"
              ? `「${project.name}」已经生成。右侧是真实可操作的应用，你可以直接新增或编辑数据。`
              : `调整完成，已保存为 v${version.ordinal}。旧版本仍在左侧，可以随时查看或恢复。`,
          meta: generated.provider === "openai" ? "AI 生成" : "本地生成",
        },
      ]);
      setPhase("ready");
      setRetryAction(null);
      if (generated.warning) showNotice(generated.warning);
      else showNotice(build.kind === "new" ? "应用已准备好" : `已创建 v${version.ordinal}`);
      void loadProjects(true);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, "生成过程中出现问题，请重试。"));
      setRetryAction("build");
      setPhase("planning");
    } finally {
      mutationInFlightRef.current = false;
    }
  }, [
    activeProject,
    loadProjects,
    pendingBuild,
    persistVersion,
    records,
    showNotice,
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
            spec: activeVersion.spec,
            records,
            prompt: activeVersion.prompt || activeProject.prompt,
            instruction: `恢复 v${activeVersion.ordinal}`,
            provider: activeVersion.provider ?? "local",
            model: activeVersion.model,
            warning: null,
            stages: ["恢复历史版本"],
          }),
        },
      );
      const normalized = normalizeVersion(
        payload,
        activeProject.id,
        (latestVersion?.ordinal ?? 0) + 1,
      );
      const restored = normalized
        ? normalized
        : {
          ...activeVersion,
          id: makeId("version"),
          ordinal: (latestVersion?.ordinal ?? 0) + 1,
          instruction: `恢复 v${activeVersion.ordinal}`,
          records,
          createdAt: new Date().toISOString(),
          };
      setVersions((current) => sortVersions([restored, ...current]));
      setActiveVersionId(restored.id);
      setRecords(restored.records);
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
      void loadProjects(true);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, "暂时无法恢复这个版本。"));
      setRetryAction("rollback");
    } finally {
      mutationInFlightRef.current = false;
      setRollbackLoading(false);
    }
  }, [
    activeProject,
    activeVersion,
    isHistoricalVersion,
    latestVersion,
    loadProjects,
    records,
    showNotice,
  ]);

  const patchRecords = useCallback(
    async (nextRecords: AppRecord[], projectId: string, versionId: string) => {
      setPersistStatus("saving");
      persistFailedRef.current = false;
      try {
        const payload = await requestJson(
          `/api/projects/${encodeURIComponent(projectId)}/versions`,
          {
          method: "PATCH",
          body: JSON.stringify({ versionId, records: nextRecords }),
          },
        );
        const updatedProject = normalizeProject(payload);
        setVersions((current) =>
          current.map((version) =>
            version.id === versionId ? { ...version, records: nextRecords } : version,
          ),
        );
        if (updatedProject) {
          setProjects((current) =>
            current.map((project) =>
              project.id === updatedProject.id ? updatedProject : project,
            ),
          );
          setActiveProject((current) =>
            current?.id === updatedProject.id ? updatedProject : current,
          );
        }
        setPersistStatus("saved");
      } catch (error) {
        persistFailedRef.current = true;
        setPersistStatus("error");
        setErrorMessage(getErrorMessage(error, "数据未能保存，请稍后再试。"));
        setRetryAction(null);
      }
    },
    [],
  );

  const enqueuePendingPersistence = useCallback(() => {
    const pending = pendingPersistenceRef.current;
    if (!pending) return persistQueueRef.current;

    pendingPersistenceRef.current = null;
    persistQueueRef.current = persistQueueRef.current.then(() =>
      patchRecords(pending.records, pending.projectId, pending.versionId),
    );
    return persistQueueRef.current;
  }, [patchRecords]);

  const flushPendingPersistence = useCallback(async () => {
    if (persistTimerRef.current) {
      window.clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    await enqueuePendingPersistence();
    if (persistFailedRef.current) {
      throw new Error("数据尚未保存成功，请先重试后再切换账号。");
    }
  }, [enqueuePendingPersistence]);

  const beginLogin = useCallback(async () => {
    if (accountSwitchingRef.current) return;
    if (phase === "building" || mutationInFlightRef.current) {
      showNotice("请等待当前写入完成后再登录", "error");
      return;
    }

    accountSwitchingRef.current = true;
    identityEpochRef.current += 1;
    openProjectRequestRef.current += 1;
    setLoginLoading(true);
    setErrorMessage(null);
    try {
      await flushPendingPersistence();
      window.location.assign("/api/auth/github");
    } catch (error) {
      accountSwitchingRef.current = false;
      setErrorMessage(getErrorMessage(error, "登录前保存失败，请稍后重试。"));
      setLoginLoading(false);
      setVersionsLoading(false);
      void loadProjects();
    }
  }, [flushPendingPersistence, loadProjects, phase, showNotice]);

  const handleLogout = useCallback(async () => {
    if (accountSwitchingRef.current) return;
    if (phase === "building" || mutationInFlightRef.current) {
      showNotice("请等待当前写入完成后再退出", "error");
      return;
    }

    accountSwitchingRef.current = true;
    identityEpochRef.current += 1;
    openProjectRequestRef.current += 1;
    setLogoutLoading(true);
    setErrorMessage(null);
    try {
      await flushPendingPersistence();
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
  }, [flushPendingPersistence, loadProjects, phase, resetToHome, showNotice]);

  const exportProject = useCallback(async () => {
    if (!activeProject || !activeVersion) return;
    setExportLoading(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/export", {
        method: "POST",
        headers: { Accept: "application/zip", "Content-Type": "application/json" },
        body: JSON.stringify({
          spec: activeVersion.spec,
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
      let fileName = `${getSpecTitle(activeVersion.spec, "forge-app")}.zip`;
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

  useEffect(() => {
    const handlePreviewMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow || !isRecord(event.data)) return;
      if (event.data.source !== "forge-preview" || event.data.type !== "records-change") return;
      if (!activeProject || !activeVersion) return;
      if (accountSwitchingRef.current) return;
      if (isHistoricalVersion) {
        showNotice("历史版本为只读，请先恢复为新版本再编辑");
        return;
      }
      const payload = isRecord(event.data.payload) ? event.data.payload : event.data;
      const nextRecords = parseRecords(payload.records);
      setRecords(nextRecords);
      pendingPersistenceRef.current = {
        records: nextRecords,
        projectId: activeProject.id,
        versionId: activeVersion.id,
      };
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      persistTimerRef.current = setTimeout(() => {
        persistTimerRef.current = null;
        void enqueuePendingPersistence();
      }, 320);
    };
    window.addEventListener("message", handlePreviewMessage);
    return () => window.removeEventListener("message", handlePreviewMessage);
  }, [activeProject, activeVersion, enqueuePendingPersistence, isHistoricalVersion, showNotice]);

  const handleRetry = useCallback(() => {
    if (retryAction === "projects") void loadProjects();
    if (retryAction === "versions" && activeProject) void openProject(activeProject);
    if (retryAction === "build") void executeBuild();
    if (retryAction === "rollback") void rollbackVersion();
  }, [
    activeProject,
    executeBuild,
    loadProjects,
    openProject,
    retryAction,
    rollbackVersion,
  ]);

  const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      beginNewPlan();
    }
  };

  const submitNewProject = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    beginNewPlan();
  };

  const submitRefinement = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    beginRefinePlan();
  };

  const cancelPlan = () => {
    setErrorMessage(null);
    setRetryAction(null);
    setPendingBuild(null);
    setPlan([]);
    setMessages((current) => current.filter((message) => message.meta !== "等待确认"));
    setPhase(activeProject ? "ready" : "home");
  };

  if (phase === "home") {
    return (
      <main className="forge-home">
        <header className="forge-home__header">
          <a className="forge-brand" href="#top" aria-label="Forge 首页">
            <span className="forge-brand__mark" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span className="forge-brand__word">Forge</span>
            <span className="forge-brand__badge">AI Builder</span>
          </a>
          <div className="forge-home__header-actions">
            <div className="forge-home__status">
              <span className="status-dot status-dot--live" aria-hidden="true" />
              Builder online
            </div>
            <AccountControl
              user={user}
              loading={sessionLoading}
              loginLoading={loginLoading}
              logoutLoading={logoutLoading}
              onLogin={() => void beginLogin()}
              onLogout={() => void handleLogout()}
            />
          </div>
        </header>

        <section className="forge-hero" id="top" aria-labelledby="forge-title">
          <div className="forge-hero__eyebrow">
            <span aria-hidden="true">✦</span>
            从一句话到可运行工具
          </div>
          <h1 id="forge-title">
            把脑海里的工具，
            <span>现在就造出来。</span>
          </h1>
          <p className="forge-hero__lead">
            描述你的工作场景。Forge 会先给出计划，确认后生成带数据与交互的应用。
          </p>

          <form className="prompt-composer" onSubmit={submitNewProject}>
            <label className="sr-only" htmlFor="forge-prompt">
              描述你想创建的应用
            </label>
            <textarea
              id="forge-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={handlePromptKeyDown}
              placeholder="例如：做一个客户线索管理工具，支持按跟进阶段筛选……"
              rows={4}
              maxLength={1200}
              autoFocus
              disabled={accountSwitching}
            />
            <div className="prompt-composer__footer">
              <span className="prompt-composer__hint">
                <kbd>⌘</kbd><kbd>↵</kbd> 提交 · 可继续补充字段和筛选方式
              </span>
              <button
                className="forge-button forge-button--primary"
                type="submit"
                disabled={accountSwitching}
              >
                <span>生成计划</span>
                <span aria-hidden="true">→</span>
              </button>
            </div>
          </form>

          {errorMessage ? (
            <ErrorBanner
              message={errorMessage}
              onRetry={retryAction ? handleRetry : undefined}
            />
          ) : null}
        </section>

        <section className="forge-starters" aria-labelledby="starters-title">
          <div className="section-heading">
            <div>
              <span className="section-heading__kicker">START WITH A BLUEPRINT</span>
              <h2 id="starters-title">选一个灵感，马上开工</h2>
            </div>
            <p>点击卡片会把完整描述放入输入框，你仍然可以继续修改。</p>
          </div>
          <div className="starter-grid">
            {STARTERS.map((starter, index) => (
              <button
                className={`starter-card starter-card--${starter.accent}`}
                type="button"
                key={starter.title}
                onClick={() => {
                  setPrompt(starter.prompt);
                  document.getElementById("forge-prompt")?.focus();
                }}
              >
                <span className="starter-card__index" aria-hidden="true">
                  0{index + 1}
                </span>
                <span className="starter-card__eyebrow">{starter.eyebrow}</span>
                <strong>{starter.title}</strong>
                <span className="starter-card__description">{starter.description}</span>
                <span className="starter-card__action">
                  使用这个蓝图 <span aria-hidden="true">↗</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="recent-projects" aria-labelledby="recent-title">
          <div className="section-heading section-heading--inline">
            <div>
              <span className="section-heading__kicker">YOUR WORKSPACE</span>
              <h2 id="recent-title">最近项目</h2>
            </div>
            {!projectsLoading && projects.length ? (
              <span>{projects.length} 个已保存项目</span>
            ) : null}
          </div>
          <div
            className={`workspace-sync-note${user ? " workspace-sync-note--account" : ""}`}
            role="status"
            aria-live="polite"
          >
            <span className="workspace-sync-note__icon" aria-hidden="true">
              {sessionLoading ? "···" : user ? "✓" : "◇"}
            </span>
            <div>
              <strong>
                {sessionLoading
                  ? "正在确认保存方式"
                  : user
                    ? `已同步至 ${user.login} 的账号`
                    : "访客工作区"}
              </strong>
              <p>
                {sessionLoading
                  ? "你的项目列表会在工作区准备好后显示。"
                  : user
                    ? "项目已绑定 GitHub 账号，可在其他设备登录后继续使用。"
                    : "项目已保存到当前浏览器，登录后可跨设备访问。"}
              </p>
            </div>
          </div>
          {projectsLoading ? (
            <div
              className="recent-grid"
              role="status"
              aria-label="正在载入最近项目"
              aria-busy="true"
            >
              {[0, 1, 2].map((item) => (
                <div className="project-card project-card--skeleton" key={item}>
                  <span />
                  <span />
                  <span />
                </div>
              ))}
            </div>
          ) : projects.length ? (
            <div className="recent-grid">
              {projects.slice(0, 6).map((project, index) => (
                <button
                  className="project-card"
                  type="button"
                  key={project.id}
                  onClick={() => void openProject(project)}
                >
                  <span className={`project-card__icon project-card__icon--${(index % 3) + 1}`}>
                    {project.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="project-card__content">
                    <strong>{project.name}</strong>
                    <span>{project.prompt || "打开并继续完善这个应用"}</span>
                  </span>
                  <span className="project-card__meta">
                    {formatRelativeDate(project.updatedAt ?? project.createdAt)}
                    <span aria-hidden="true">→</span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="recent-empty">
              <span className="recent-empty__symbol" aria-hidden="true">◇</span>
              <div>
                <strong>这里还很安静</strong>
                <p>第一个应用生成后会自动出现在这里。</p>
              </div>
            </div>
          )}
        </section>

        <footer className="forge-home__footer">
          <span>FORGE / AI APPLICATION BUILDER</span>
          <span>Plan · Build · Run · Refine</span>
        </footer>
        <NoticeToast notice={notice} />
      </main>
    );
  }

  const workspaceName = activeProject?.name ?? deriveProjectName(pendingBuild?.prompt ?? prompt);

  return (
    <main className="studio-shell">
      <header className="studio-topbar">
        <button
          className="forge-brand forge-brand--button"
          type="button"
          onClick={resetToHome}
          disabled={accountSwitching}
        >
          <span className="forge-brand__mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="forge-brand__word">Forge</span>
        </button>
        <span className="studio-topbar__divider" aria-hidden="true">/</span>
        <div className="studio-topbar__project">
          <strong>{workspaceName}</strong>
          <span>{phase === "building" ? "正在构建" : phase === "planning" ? "等待确认" : "已保存"}</span>
        </div>
        <div className="studio-topbar__actions">
          <span
            className={`save-indicator save-indicator--${persistStatus}`}
            role="status"
            aria-live="polite"
          >
            <span className="status-dot" aria-hidden="true" />
            {persistStatus === "saving"
              ? "正在保存"
              : persistStatus === "error"
                ? "保存失败"
                : sessionLoading
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
          <button
            className="icon-button"
            type="button"
            onClick={resetToHome}
            aria-label="新建应用"
            disabled={accountSwitching}
          >
            <span aria-hidden="true">＋</span>
          </button>
        </div>
      </header>

      <div className="studio-layout">
        <aside className="studio-sidebar" aria-label="项目与版本">
          <div className="sidebar-section">
            <div className="sidebar-section__heading">
              <span>项目</span>
              <button
                type="button"
                onClick={resetToHome}
                aria-label="创建新项目"
                disabled={accountSwitching}
              >＋</button>
            </div>
            <div className="sidebar-projects">
              {projects.map((project) => (
                <button
                  className={project.id === activeProject?.id ? "is-active" : ""}
                  type="button"
                  key={project.id}
                  onClick={() => void openProject(project)}
                  aria-current={project.id === activeProject?.id ? "page" : undefined}
                  disabled={accountSwitching}
                >
                  <span className="sidebar-projects__mark" aria-hidden="true">
                    {project.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span>{project.name}</span>
                  {project.id === activeProject?.id ? <i aria-hidden="true" /> : null}
                </button>
              ))}
              {!activeProject && pendingBuild ? (
                <div className="sidebar-projects__draft">
                  <span className="sidebar-projects__mark" aria-hidden="true">F</span>
                  <span>{workspaceName}</span>
                  <small>草稿</small>
                </div>
              ) : null}
            </div>
          </div>

          <div className="sidebar-section sidebar-section--versions">
            <div className="sidebar-section__heading">
              <span>版本</span>
              <span className="sidebar-section__count">{versions.length}</span>
            </div>
            {versionsLoading ? (
              <div className="version-loading" aria-label="正在载入版本" aria-busy="true">
                <span /><span /><span />
              </div>
            ) : versions.length ? (
              <div className="version-list">
                {versions.map((version, index) => (
                  <button
                    className={version.id === activeVersion?.id ? "is-active" : ""}
                    type="button"
                    key={version.id}
                    onClick={() => chooseVersion(version)}
                    aria-current={version.id === activeVersion?.id ? "true" : undefined}
                    disabled={accountSwitching}
                  >
                    <span className="version-list__rail" aria-hidden="true">
                      <i />
                      {index < versions.length - 1 ? <b /> : null}
                    </span>
                    <span className="version-list__content">
                      <strong>v{version.ordinal}</strong>
                      <small>{version.instruction || (index === 0 ? "当前版本" : "历史版本")}</small>
                      <time dateTime={version.createdAt ?? undefined}>
                        {formatRelativeDate(version.createdAt)}
                      </time>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="sidebar-empty">确认计划后，第一个版本会出现在这里。</p>
            )}
          </div>

          <div className="sidebar-footer">
            <span className="status-dot status-dot--live" aria-hidden="true" />
            Runtime ready
          </div>
        </aside>

        <section className="agent-panel" aria-labelledby="agent-title">
          <header className="panel-header">
            <div>
              <span className="agent-avatar" aria-hidden="true">✦</span>
              <div>
                <strong id="agent-title">Forge Agent</strong>
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
                    {message.role === "agent" ? "✦" : "你"}
                  </div>
                  <div className="message__body">
                    <span className="message__author">
                      {message.role === "agent" ? "Forge Agent" : "You"}
                    </span>
                    <p>{message.text}</p>
                    {message.meta ? <small>{message.meta}</small> : null}
                  </div>
                </article>
              ))}
            </div>

            {phase === "planning" && pendingBuild ? (
              <section className="build-plan" aria-labelledby="plan-title">
                <div className="build-plan__header">
                  <div>
                    <span className="section-heading__kicker">PROPOSED PLAN</span>
                    <h2 id="plan-title">执行计划</h2>
                  </div>
                  <span className="plan-badge">4 steps</span>
                </div>
                <p className="build-plan__brief">
                  {pendingBuild.kind === "new" ? pendingBuild.prompt : pendingBuild.instruction}
                </p>
                <ol className="plan-steps">
                  {plan.map((step, index) => (
                    <li key={step.title}>
                      <span className="plan-steps__number">{String(index + 1).padStart(2, "0")}</span>
                      <div>
                        <strong>{step.title}</strong>
                        <p>{step.detail}</p>
                      </div>
                      <span className="plan-steps__ready" aria-label="已准备">✓</span>
                    </li>
                  ))}
                </ol>
                <div className="build-plan__note">
                  <span aria-hidden="true">◎</span>
                  <p>
                    <strong>版本安全</strong>
                    {pendingBuild.kind === "refine"
                      ? "这次调整会创建新版本，不会覆盖当前成果。"
                      : "生成后可直接操作，所有数据变化都会自动保存。"}
                  </p>
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
            ) : null}

            {phase === "building" ? (
              <section className="building-card" aria-labelledby="building-title" aria-busy="true">
                <div className="building-card__orb" aria-hidden="true">
                  <span /><span /><i>✦</i>
                </div>
                <span className="section-heading__kicker">FORGE IS BUILDING</span>
                <h2 id="building-title">正在把计划变成应用</h2>
                <p>字段、数据与交互正在同时组装，通常只需要几秒。</p>
                <ol className="building-progress">
                  {BUILDING_STAGES.map((stage, index) => (
                    <li
                      className={
                        index < buildingStage
                          ? "is-done"
                          : index === buildingStage
                            ? "is-active"
                            : ""
                      }
                      key={stage}
                    >
                      <span aria-hidden="true">{index < buildingStage ? "✓" : index + 1}</span>
                      {stage}
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            {phase === "ready" && activeVersion ? (
              <section className="build-summary" aria-label="当前应用摘要">
                <div className="build-summary__topline">
                  <span className="summary-icon" aria-hidden="true">✓</span>
                  <div>
                    <strong>{getSpecTitle(activeVersion.spec, activeProject?.name)}</strong>
                    <p>{getSpecDescription(activeVersion.spec) || "应用已生成并可以直接运行。"}</p>
                  </div>
                  <span className="version-pill">v{activeVersion.ordinal}</span>
                </div>
                <div className="build-summary__stats">
                  <span><strong>{getSpecSeedData(activeVersion.spec).length}</strong> 示例记录</span>
                  <span><strong>Live</strong> 实时预览</span>
                  <span><strong>Auto</strong> 自动保存</span>
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

          {phase === "ready" && activeVersion ? (
            <form className="refine-composer" onSubmit={submitRefinement}>
              <label htmlFor="refine-input">继续调整这个应用</label>
              <div className="refine-composer__box">
                <textarea
                  id="refine-input"
                  value={instruction}
                  onChange={(event) => setInstruction(event.target.value)}
                  placeholder="例如：增加优先级字段，把状态筛选放到顶部……"
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
                  {tab === "preview" ? "Preview" : tab === "code" ? "Code" : "Spec"}
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
                  <span aria-hidden="true">↓</span>
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
                      <div>forge.app/{activeProject?.id.slice(0, 8)}</div>
                    </div>
                    <iframe
                      ref={iframeRef}
                      title={`${activeProject?.name ?? "Forge 应用"} 可运行预览`}
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
                  <span><i aria-hidden="true" /> app-spec.json</span>
                  <span>结构化描述</span>
                </div>
                <pre><code>{activeVersion ? JSON.stringify(activeVersion.spec, null, 2) : "{}"}</code></pre>
              </div>
            )}
          </div>
        </section>
      </div>

      <NoticeToast notice={notice} />
    </main>
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
            ? "Forge 正在连接数据、界面与交互。"
            : "确认左侧计划后，可运行应用会出现在这里。"}
        </p>
      </div>
    </div>
  );
}
