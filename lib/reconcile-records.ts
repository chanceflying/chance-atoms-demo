import type { AppRecord, AppSpec, AppValue, FieldSpec } from "./domain";
import { parseAppSpec, parseRecords } from "./validation";

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function normalizeValue(value: unknown, field: FieldSpec): AppValue | undefined {
  if (field.type === "number") {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
  }

  if (field.type === "checkbox") {
    if (typeof value === "boolean") return value;
    if (value === 1 || value === "true") return true;
    if (value === 0 || value === "false") return false;
    return undefined;
  }

  const normalized =
    typeof value === "string"
      ? value.slice(0, 2_000)
      : typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : undefined;
  if (normalized === undefined) return undefined;
  if (field.type === "select" && normalized && !field.options.includes(normalized)) {
    return undefined;
  }
  return normalized;
}

/**
 * Carries user data into a newly generated schema without letting stale field
 * ids or incompatible values make the next preview uncompilable.
 */
export function reconcileRecordsForSpec(
  input: unknown,
  specInput: AppSpec,
): AppRecord[] {
  const spec = parseAppSpec(specInput);
  if (!Array.isArray(input)) return [];

  const fields = new Map(spec.fields.map((field) => [field.id, field]));
  const recordIds = new Set<string>();
  const records: AppRecord[] = [];

  for (const candidate of input.slice(0, 100)) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const record = candidate as { id?: unknown; values?: unknown };
    if (
      typeof record.id !== "string" ||
      !SAFE_ID_PATTERN.test(record.id) ||
      recordIds.has(record.id)
    ) {
      continue;
    }
    recordIds.add(record.id);

    const seenFields = new Set<string>();
    const values: AppRecord["values"] = [];
    if (Array.isArray(record.values)) {
      for (const candidateValue of record.values) {
        if (
          !candidateValue ||
          typeof candidateValue !== "object" ||
          Array.isArray(candidateValue)
        ) {
          continue;
        }
        const entry = candidateValue as { fieldId?: unknown; value?: unknown };
        if (typeof entry.fieldId !== "string" || seenFields.has(entry.fieldId)) continue;
        const field = fields.get(entry.fieldId);
        if (!field) continue;
        const value = normalizeValue(entry.value, field);
        if (value === undefined) continue;
        seenFields.add(entry.fieldId);
        values.push({ fieldId: entry.fieldId, value });
      }
    }
    records.push({ id: record.id, values });
  }

  return parseRecords(records, spec);
}
