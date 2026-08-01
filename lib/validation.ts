import {
  FIELD_TYPES,
  type AppRecord,
  type AppSpec,
  type AppValue,
  type FieldSpec,
  type FieldType,
  type Project,
  type ProjectStatus,
  type StoredArtifact,
  type ValidationIssue,
  type ValidationResult,
  type Version,
  type WebAppArtifact,
} from "./domain";

const FIELD_TYPE_SET = new Set<string>(FIELD_TYPES);
const PROJECT_STATUSES = new Set<ProjectStatus>([
  "draft",
  "generating",
  "ready",
  "error",
]);
const FIELD_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const RESERVED_FIELD_IDS = new Set(["__proto__", "prototype", "constructor"]);
export const MAX_WEB_APP_HTML_LENGTH = 500_000;

type UnknownRecord = Record<string, unknown>;

export class AppSpecValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super(
      `Invalid AppSpec: ${issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("; ")}`,
    );
    this.name = "AppSpecValidationError";
    this.issues = issues;
  }
}

export class StoredArtifactValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super(
      `Invalid stored artifact: ${issues
        .map((entry) => `${entry.path}: ${entry.message}`)
        .join("; ")}`,
    );
    this.name = "StoredArtifactValidationError";
    this.issues = issues;
  }
}

function isObject(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(issues: ValidationIssue[], path: string, message: string) {
  issues.push({ path, message });
}

function stringValue(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  { min = 1, max = 200 }: { min?: number; max?: number } = {},
): string {
  if (typeof value !== "string") {
    issue(issues, path, "must be a string");
    return "";
  }
  const normalized = value.trim();
  if (normalized.length < min) {
    issue(issues, path, `must contain at least ${min} character(s)`);
  }
  if (normalized.length > max) {
    issue(issues, path, `must contain at most ${max} characters`);
  }
  return normalized.slice(0, max);
}

function booleanValue(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): boolean {
  if (typeof value !== "boolean") {
    issue(issues, path, "must be a boolean");
    return false;
  }
  return value;
}

function nullableString(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  max = 200,
): string | null {
  if (value === null) return null;
  return stringValue(value, path, issues, { max });
}

function stringArray(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  { min = 0, max = 20, itemMax = 120 } = {},
): string[] {
  if (!Array.isArray(value)) {
    issue(issues, path, "must be an array");
    return [];
  }
  if (value.length < min) issue(issues, path, `must contain at least ${min} item(s)`);
  if (value.length > max) issue(issues, path, `must contain at most ${max} items`);
  return value.slice(0, max).map((item, index) =>
    stringValue(item, `${path}[${index}]`, issues, { max: itemMax }),
  );
}

function validateField(
  input: unknown,
  index: number,
  issues: ValidationIssue[],
): FieldSpec {
  const path = `fields[${index}]`;
  if (!isObject(input)) {
    issue(issues, path, "must be an object");
    return {
      id: `field${index + 1}`,
      label: "Invalid field",
      type: "text",
      required: false,
      placeholder: "",
      options: [],
    };
  }

  const id = stringValue(input.id, `${path}.id`, issues, { max: 40 });
  if (!FIELD_ID_PATTERN.test(id) || RESERVED_FIELD_IDS.has(id)) {
    issue(
      issues,
      `${path}.id`,
      "must start with a letter and contain only letters, numbers, or underscores",
    );
  }

  let type: FieldType = "text";
  if (typeof input.type !== "string" || !FIELD_TYPE_SET.has(input.type)) {
    issue(issues, `${path}.type`, `must be one of ${FIELD_TYPES.join(", ")}`);
  } else {
    type = input.type as FieldType;
  }

  const options = stringArray(input.options, `${path}.options`, issues, {
    max: 16,
    itemMax: 80,
  });
  if (type === "select" && options.length === 0) {
    issue(issues, `${path}.options`, "must contain options for a select field");
  }
  if (type !== "select" && options.length > 0) {
    issue(issues, `${path}.options`, "must be empty unless the field type is select");
  }
  if (new Set(options).size !== options.length) {
    issue(issues, `${path}.options`, "must not contain duplicate options");
  }

  return {
    id,
    label: stringValue(input.label, `${path}.label`, issues, { max: 80 }),
    type,
    required: booleanValue(input.required, `${path}.required`, issues),
    placeholder: stringValue(input.placeholder, `${path}.placeholder`, issues, {
      min: 0,
      max: 120,
    }),
    options,
  };
}

function valueMatchesField(value: unknown, field: FieldSpec): value is AppValue {
  if (field.type === "number") return typeof value === "number" && Number.isFinite(value);
  if (field.type === "checkbox") return typeof value === "boolean";
  return typeof value === "string";
}

function validateRecordsInternal(
  input: unknown,
  fields: FieldSpec[],
  path: string,
  issues: ValidationIssue[],
): AppRecord[] {
  if (!Array.isArray(input)) {
    issue(issues, path, "must be an array");
    return [];
  }
  if (input.length > 100) issue(issues, path, "must contain at most 100 records");

  const fieldMap = new Map(fields.map((field) => [field.id, field]));
  const recordIds = new Set<string>();

  return input.slice(0, 100).map((recordInput, recordIndex) => {
    const recordPath = `${path}[${recordIndex}]`;
    if (!isObject(recordInput)) {
      issue(issues, recordPath, "must be an object");
      return { id: `invalid-${recordIndex}`, values: [] };
    }

    const id = stringValue(recordInput.id, `${recordPath}.id`, issues, { max: 128 });
    if (!SAFE_ID_PATTERN.test(id)) {
      issue(issues, `${recordPath}.id`, "contains unsupported characters");
    }
    if (recordIds.has(id)) issue(issues, `${recordPath}.id`, "must be unique");
    recordIds.add(id);

    if (!Array.isArray(recordInput.values)) {
      issue(issues, `${recordPath}.values`, "must be an array");
      return { id, values: [] };
    }
    if (recordInput.values.length > fields.length) {
      issue(issues, `${recordPath}.values`, "contains more values than fields");
    }

    const valueFieldIds = new Set<string>();
    const values = recordInput.values.slice(0, fields.length).map((entry, valueIndex) => {
      const valuePath = `${recordPath}.values[${valueIndex}]`;
      if (!isObject(entry)) {
        issue(issues, valuePath, "must be an object");
        return { fieldId: "invalid", value: "" };
      }

      const fieldId = stringValue(entry.fieldId, `${valuePath}.fieldId`, issues, {
        max: 40,
      });
      const field = fieldMap.get(fieldId);
      if (!field) issue(issues, `${valuePath}.fieldId`, "does not reference a known field");
      if (valueFieldIds.has(fieldId)) {
        issue(issues, `${valuePath}.fieldId`, "must be unique within a record");
      }
      valueFieldIds.add(fieldId);

      let value: AppValue = "";
      if (field && !valueMatchesField(entry.value, field)) {
        issue(issues, `${valuePath}.value`, `does not match field type ${field.type}`);
      } else if (
        field?.type === "select" &&
        typeof entry.value === "string" &&
        entry.value !== "" &&
        !field.options.includes(entry.value)
      ) {
        issue(issues, `${valuePath}.value`, "is not one of the select field options");
        value = entry.value;
      } else if (typeof entry.value === "string") {
        if (entry.value.length > 2_000) {
          issue(issues, `${valuePath}.value`, "must contain at most 2000 characters");
        }
        value = entry.value.slice(0, 2_000);
      } else if (typeof entry.value === "number" || typeof entry.value === "boolean") {
        value = entry.value;
      }
      return { fieldId, value };
    });

    return { id, values };
  });
}

export function validateAppSpec(input: unknown): ValidationResult<AppSpec> {
  const issues: ValidationIssue[] = [];
  if (!isObject(input)) {
    return { success: false, issues: [{ path: "$", message: "must be an object" }] };
  }

  if (input.schemaVersion !== 1) {
    issue(issues, "schemaVersion", "must equal 1");
  }
  const layout = input.layout === "cards" ? "cards" : "table";
  if (input.layout !== "table" && input.layout !== "cards") {
    issue(issues, "layout", "must be table or cards");
  }

  if (!Array.isArray(input.fields)) {
    issue(issues, "fields", "must be an array");
  }
  const rawFields = Array.isArray(input.fields) ? input.fields : [];
  if (rawFields.length < 1 || rawFields.length > 12) {
    issue(issues, "fields", "must contain between 1 and 12 fields");
  }
  const fields = rawFields.slice(0, 12).map((field, index) =>
    validateField(field, index, issues),
  );
  const fieldIds = fields.map((field) => field.id);
  if (new Set(fieldIds).size !== fieldIds.length) {
    issue(issues, "fields", "field ids must be unique");
  }

  let accent = "#635bff";
  let background = "#f7f8fc";
  if (!isObject(input.theme)) {
    issue(issues, "theme", "must be an object");
  } else {
    accent = stringValue(input.theme.accent, "theme.accent", issues, { max: 7 });
    background = stringValue(input.theme.background, "theme.background", issues, {
      max: 7,
    });
    if (!HEX_COLOR_PATTERN.test(accent)) issue(issues, "theme.accent", "must be a 6-digit hex color");
    if (!HEX_COLOR_PATTERN.test(background)) {
      issue(issues, "theme.background", "must be a 6-digit hex color");
    }
  }

  let search = false;
  let stats = false;
  let filterField: string | null = null;
  if (!isObject(input.features)) {
    issue(issues, "features", "must be an object");
  } else {
    search = booleanValue(input.features.search, "features.search", issues);
    stats = booleanValue(input.features.stats, "features.stats", issues);
    filterField = nullableString(
      input.features.filterField,
      "features.filterField",
      issues,
      40,
    );
    if (filterField !== null) {
      const filter = fields.find((field) => field.id === filterField);
      if (!filter) issue(issues, "features.filterField", "must reference a known field");
      else if (filter.type !== "select") {
        issue(issues, "features.filterField", "must reference a select field");
      }
    }
  }

  const seedData = validateRecordsInternal(input.seedData, fields, "seedData", issues);
  const acceptanceCriteria = stringArray(
    input.acceptanceCriteria,
    "acceptanceCriteria",
    issues,
    { min: 1, max: 12, itemMax: 240 },
  );

  const spec: AppSpec = {
    schemaVersion: 1,
    title: stringValue(input.title, "title", issues, { max: 100 }),
    description: stringValue(input.description, "description", issues, { max: 360 }),
    entityName: stringValue(input.entityName, "entityName", issues, { max: 60 }),
    entityNamePlural: stringValue(input.entityNamePlural, "entityNamePlural", issues, {
      max: 80,
    }),
    layout,
    theme: { accent, background },
    fields,
    features: { search, stats, filterField },
    seedData,
    acceptanceCriteria,
  };

  return issues.length > 0 ? { success: false, issues } : { success: true, data: spec };
}

export function parseAppSpec(input: unknown): AppSpec {
  const result = validateAppSpec(input);
  if (!result.success) throw new AppSpecValidationError(result.issues);
  return result.data;
}

export function isAppSpec(input: unknown): input is AppSpec {
  return validateAppSpec(input).success;
}

export function validateWebAppArtifact(
  input: unknown,
): ValidationResult<WebAppArtifact> {
  const issues: ValidationIssue[] = [];
  if (!isObject(input)) {
    return { success: false, issues: [{ path: "$", message: "must be an object" }] };
  }

  if (input.schemaVersion !== 1) {
    issue(issues, "schemaVersion", "must equal 1");
  }
  if (input.kind !== "web_app") {
    issue(issues, "kind", "must equal web_app");
  }

  let html = "";
  if (typeof input.html !== "string") {
    issue(issues, "html", "must be a string");
  } else {
    html = input.html;
    if (html.trim().length === 0) {
      issue(issues, "html", "must contain a complete HTML document");
    }
    if (html.length > MAX_WEB_APP_HTML_LENGTH) {
      issue(
        issues,
        "html",
        `must contain at most ${MAX_WEB_APP_HTML_LENGTH} characters`,
      );
      html = html.slice(0, MAX_WEB_APP_HTML_LENGTH);
    }
  }

  const artifact: WebAppArtifact = {
    schemaVersion: 1,
    kind: "web_app",
    title: stringValue(input.title, "title", issues, { max: 100 }),
    description: stringValue(input.description, "description", issues, { max: 360 }),
    html,
    acceptanceCriteria: stringArray(
      input.acceptanceCriteria,
      "acceptanceCriteria",
      issues,
      { min: 1, max: 12, itemMax: 240 },
    ),
  };

  return issues.length > 0
    ? { success: false, issues }
    : { success: true, data: artifact };
}

export function isWebAppArtifact(input: unknown): input is WebAppArtifact {
  return validateWebAppArtifact(input).success;
}

export function validateStoredArtifact(
  input: unknown,
): ValidationResult<StoredArtifact> {
  if (isObject(input) && Object.hasOwn(input, "kind")) {
    if (input.kind === "web_app") return validateWebAppArtifact(input);
    return {
      success: false,
      issues: [{ path: "kind", message: "must equal web_app when provided" }],
    };
  }
  return validateAppSpec(input);
}

export function parseStoredArtifact(input: unknown): StoredArtifact {
  const result = validateStoredArtifact(input);
  if (!result.success) throw new StoredArtifactValidationError(result.issues);
  return result.data;
}

export function isStoredArtifact(input: unknown): input is StoredArtifact {
  return validateStoredArtifact(input).success;
}

/** Web apps persist generated source/version metadata, not runtime CRUD rows. */
export function parseRecordsForArtifact(
  input: unknown,
  artifactInput: StoredArtifact,
): AppRecord[] {
  const artifact = parseStoredArtifact(artifactInput);
  return isWebAppArtifact(artifact) ? [] : parseRecords(input, artifact);
}

export function validateRecords(
  input: unknown,
  specInput: AppSpec,
): ValidationResult<AppRecord[]> {
  const spec = parseAppSpec(specInput);
  const issues: ValidationIssue[] = [];
  const data = validateRecordsInternal(input, spec.fields, "records", issues);
  return issues.length > 0 ? { success: false, issues } : { success: true, data };
}

export function parseRecords(input: unknown, spec: AppSpec): AppRecord[] {
  const result = validateRecords(input, spec);
  if (!result.success) throw new AppSpecValidationError(result.issues);
  return result.data;
}

export function validateProject(input: unknown): ValidationResult<Project> {
  const issues: ValidationIssue[] = [];
  if (!isObject(input)) {
    return { success: false, issues: [{ path: "$", message: "must be an object" }] };
  }
  const id = stringValue(input.id, "id", issues, { max: 128 });
  if (!SAFE_ID_PATTERN.test(id)) issue(issues, "id", "contains unsupported characters");
  const status = typeof input.status === "string" && PROJECT_STATUSES.has(input.status as ProjectStatus)
    ? (input.status as ProjectStatus)
    : "draft";
  if (status !== input.status) issue(issues, "status", "is not a supported project status");
  const createdAt = stringValue(input.createdAt, "createdAt", issues, { max: 40 });
  const updatedAt = stringValue(input.updatedAt, "updatedAt", issues, { max: 40 });
  if (Number.isNaN(Date.parse(createdAt))) issue(issues, "createdAt", "must be an ISO date string");
  if (Number.isNaN(Date.parse(updatedAt))) issue(issues, "updatedAt", "must be an ISO date string");

  // Project records are checked structurally here; field-level checking belongs
  // to the current Version's AppSpec.
  let records: AppRecord[] = [];
  if (!Array.isArray(input.records)) {
    issue(issues, "records", "must be an array");
  } else {
    records = input.records.filter(isObject).map((record, index) => ({
      id: stringValue(record.id, `records[${index}].id`, issues, { max: 128 }),
      values: Array.isArray(record.values)
        ? record.values.filter(isObject).map((entry, valueIndex) => ({
            fieldId: stringValue(
              entry.fieldId,
              `records[${index}].values[${valueIndex}].fieldId`,
              issues,
              { max: 40 },
            ),
            value:
              typeof entry.value === "string" ||
              typeof entry.value === "number" ||
              typeof entry.value === "boolean"
                ? entry.value
                : (issue(
                    issues,
                    `records[${index}].values[${valueIndex}].value`,
                    "must be a string, number, or boolean",
                  ),
                  ""),
          }))
        : (issue(issues, `records[${index}].values`, "must be an array"), []),
    }));
    if (records.length !== input.records.length) {
      issue(issues, "records", "all records must be objects");
    }
  }

  const project: Project = {
    id,
    name: stringValue(input.name, "name", issues, { max: 100 }),
    prompt: stringValue(input.prompt, "prompt", issues, { max: 4_000 }),
    status,
    currentVersionId: nullableString(
      input.currentVersionId,
      "currentVersionId",
      issues,
      128,
    ),
    records,
    createdAt,
    updatedAt,
  };
  return issues.length > 0 ? { success: false, issues } : { success: true, data: project };
}

export function validateVersion(input: unknown): ValidationResult<Version> {
  const issues: ValidationIssue[] = [];
  if (!isObject(input)) {
    return { success: false, issues: [{ path: "$", message: "must be an object" }] };
  }
  const id = stringValue(input.id, "id", issues, { max: 128 });
  const projectId = stringValue(input.projectId, "projectId", issues, { max: 128 });
  if (!SAFE_ID_PATTERN.test(id)) issue(issues, "id", "contains unsupported characters");
  if (!SAFE_ID_PATTERN.test(projectId)) issue(issues, "projectId", "contains unsupported characters");
  const number = input.number;
  if (typeof number !== "number" || !Number.isInteger(number) || number < 1) {
    issue(issues, "number", "must be a positive integer");
  }
  const artifactResult = validateStoredArtifact(input.spec);
  if (!artifactResult.success) {
    for (const artifactIssue of artifactResult.issues) {
      issue(issues, `spec.${artifactIssue.path}`, artifactIssue.message);
    }
  }
  const createdAt = stringValue(input.createdAt, "createdAt", issues, { max: 40 });
  if (Number.isNaN(Date.parse(createdAt))) issue(issues, "createdAt", "must be an ISO date string");
  const version: Version = {
    id,
    projectId,
    number: typeof number === "number" ? number : 1,
    instruction: nullableString(input.instruction, "instruction", issues, 2_000),
    spec: artifactResult.success ? artifactResult.data : (input.spec as StoredArtifact),
    createdAt,
  };
  return issues.length > 0 ? { success: false, issues } : { success: true, data: version };
}
