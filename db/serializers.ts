import { parseStoredJson } from "./http";

export type DatabaseRow = Record<string, unknown>;

export function serializeProject(row: DatabaseRow) {
  const spec = parseStoredJson(row.current_spec, {});
  return {
    id: row.id,
    title: row.title,
    name: row.title,
    prompt: row.prompt,
    spec,
    currentSpec: spec,
    records: parseStoredJson(row.records, []),
    currentVersion: row.current_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function serializeVersion(row: DatabaseRow) {
  return {
    id: row.id,
    versionId: row.id,
    projectId: row.project_id,
    version: row.version,
    instruction: row.instruction,
    spec: parseStoredJson(row.spec, {}),
    records: parseStoredJson(row.records, []),
    prompt: row.prompt,
    provider: row.provider,
    model: row.model,
    warning: row.warning,
    stages: parseStoredJson(row.stages, []),
    createdAt: row.created_at,
  };
}
