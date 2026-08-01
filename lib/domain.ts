export const FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "date",
  "select",
  "checkbox",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export type AppValue = string | number | boolean;

/**
 * All properties are required on purpose. Besides making the local runtime
 * predictable, this shape can be represented by an OpenAI strict JSON schema.
 */
export interface FieldSpec {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  placeholder: string;
  options: string[];
}

export interface FieldValue {
  fieldId: string;
  value: AppValue;
}

/**
 * Values are an array instead of a free-form object so generated specs can use
 * `additionalProperties: false` all the way down.
 */
export interface AppRecord {
  id: string;
  values: FieldValue[];
}

export interface AppSpec {
  schemaVersion: 1;
  title: string;
  description: string;
  entityName: string;
  entityNamePlural: string;
  layout: "table" | "cards";
  theme: {
    accent: string;
    background: string;
  };
  fields: FieldSpec[];
  features: {
    search: boolean;
    stats: boolean;
    filterField: string | null;
  };
  seedData: AppRecord[];
  acceptanceCriteria: string[];
}

export type ProjectStatus = "draft" | "generating" | "ready" | "error";

export interface Project {
  id: string;
  name: string;
  prompt: string;
  status: ProjectStatus;
  currentVersionId: string | null;
  records: AppRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface Version {
  id: string;
  projectId: string;
  number: number;
  instruction: string | null;
  spec: AppSpec;
  createdAt: string;
}

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; issues: ValidationIssue[] };

export interface ValidationIssue {
  path: string;
  message: string;
}
