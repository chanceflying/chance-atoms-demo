import { parseStoredJson } from "./http";
import { isWebAppArtifact } from "../lib/validation";

export type DatabaseRow = Record<string, unknown>;

export function serializeProject(row: DatabaseRow) {
  const artifact = parseStoredJson(row.current_spec, {});
  const records = isWebAppArtifact(artifact)
    ? []
    : parseStoredJson(row.records, []);
  return {
    id: row.id,
    title: row.title,
    name: row.title,
    prompt: row.prompt,
    artifact,
    spec: artifact,
    currentSpec: artifact,
    records,
    currentVersion: row.current_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function serializeVersion(row: DatabaseRow) {
  const artifact = parseStoredJson(row.spec, {});
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
    stages: parseStoredJson(row.stages, []),
    createdAt: row.created_at,
  };
}
