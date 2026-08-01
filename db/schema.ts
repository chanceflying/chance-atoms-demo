import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    title: text("title").notNull(),
    prompt: text("prompt").notNull().default(""),
    currentSpec: text("current_spec").notNull().default("{}"),
    records: text("records").notNull().default("[]"),
    currentVersion: integer("current_version").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_projects_workspace_updated").on(
      table.workspaceId,
      table.updatedAt,
    ),
  ],
);

export const versions = sqliteTable(
  "versions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    instruction: text("instruction").notNull().default(""),
    spec: text("spec").notNull(),
    records: text("records").notNull().default("[]"),
    prompt: text("prompt").notNull().default(""),
    provider: text("provider"),
    model: text("model"),
    warning: text("warning"),
    stages: text("stages").notNull().default("[]"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_versions_project_version").on(
      table.projectId,
      table.version,
    ),
  ],
);
