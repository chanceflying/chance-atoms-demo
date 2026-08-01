import { parseStoredJson } from "./http";
import { isBuildPlan, isWebAppArtifact } from "../lib/validation";

export type DatabaseRow = Record<string, unknown>;

export function serializeProject(row: DatabaseRow) {
  const artifact = parseStoredJson(row.current_spec, {});
  const kind = row.kind === "chat" ? "chat" : "web_app";
  const records = isWebAppArtifact(artifact)
    ? []
    : parseStoredJson(row.records, []);
  return {
    id: row.id,
    kind,
    title: row.title,
    name: row.title,
    prompt: row.prompt,
    artifact,
    spec: artifact,
    currentSpec: artifact,
    records,
    memoryEnabled: Boolean(row.memory_enabled),
    memoryContent:
      typeof row.memory_content === "string" ? row.memory_content : "",
    currentVersion: row.current_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function serializeVersion(row: DatabaseRow) {
  const artifact = parseStoredJson(row.spec, {});
  const rawBuildPlan = parseStoredJson(row.build_plan, null);
  const rawReasoningSummary = parseStoredJson(row.reasoning_summary, []);
  return {
    id: row.id,
    versionId: row.id,
    projectId: row.project_id,
    version: row.version,
    instruction: row.instruction,
    artifact,
    spec: artifact,
    records: isWebAppArtifact(artifact) ? [] : parseStoredJson(row.records, []),
    prompt: row.prompt,
    provider: row.provider,
    model: row.model,
    warning: row.warning,
    buildPlan: isBuildPlan(rawBuildPlan) ? rawBuildPlan : null,
    reasoningSummary: Array.isArray(rawReasoningSummary)
      ? rawReasoningSummary.filter((item): item is string => typeof item === "string")
      : [],
    stages: parseStoredJson(row.stages, []),
    createdAt: row.created_at,
  };
}

export function serializeChatMessage(row: DatabaseRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    role: row.role === "assistant" ? "assistant" : "user",
    content: typeof row.content === "string" ? row.content : "",
    provider: typeof row.provider === "string" ? row.provider : null,
    model: typeof row.model === "string" ? row.model : null,
    createdAt: row.created_at,
  };
}
