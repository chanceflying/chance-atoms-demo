import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  serializeChatMessage,
  serializeProject,
} from "../db/serializers";

test("project serialization exposes capability kind and chat memory", () => {
  const chat = serializeProject({
    id: "chat-1",
    workspace_id: "workspace-1",
    kind: "chat",
    title: "Interview notes",
    prompt: "",
    current_spec: "{}",
    records: "[]",
    memory_enabled: 1,
    memory_content: "Remember my preferred answer style.",
    current_version: 0,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
  });

  assert.equal(chat.kind, "chat");
  assert.equal(chat.memoryEnabled, true);
  assert.equal(chat.memoryContent, "Remember my preferred answer style.");
  assert.deepEqual(chat.records, []);

  const legacy = serializeProject({
    id: "legacy-1",
    title: "Legacy Web App",
    prompt: "Build an app",
    current_spec: "{}",
    records: "[]",
    current_version: 1,
  });
  assert.equal(legacy.kind, "web_app");
  assert.equal(legacy.memoryEnabled, false);
  assert.equal(legacy.memoryContent, "");
});

test("chat message serialization keeps model metadata on assistant replies", () => {
  const assistant = serializeChatMessage({
    id: "message-2",
    project_id: "chat-1",
    role: "assistant",
    content: "Here is the answer.",
    provider: "openai",
    model: "gpt-test",
    created_at: "2026-08-01T00:00:00.001Z",
  });
  const user = serializeChatMessage({
    id: "message-1",
    project_id: "chat-1",
    role: "user",
    content: "My question",
    provider: null,
    model: null,
    created_at: "2026-08-01T00:00:00.000Z",
  });

  assert.deepEqual(user, {
    id: "message-1",
    projectId: "chat-1",
    role: "user",
    content: "My question",
    provider: null,
    model: null,
    createdAt: "2026-08-01T00:00:00.000Z",
  });
  assert.equal(assistant.role, "assistant");
  assert.equal(assistant.provider, "openai");
  assert.equal(assistant.model, "gpt-test");
});

test("chat migration keeps legacy projects as web apps and cascades messages", async () => {
  const migration = await readFile(
    new URL("../drizzle/0004_curly_ghost_rider.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /CREATE TABLE `chat_messages`/);
  assert.match(migration, /ON DELETE cascade/);
  assert.match(migration, /ADD `kind` text DEFAULT 'web_app' NOT NULL/);
  assert.match(migration, /ADD `memory_enabled` integer DEFAULT 0 NOT NULL/);
  assert.match(migration, /ADD `memory_content` text DEFAULT '' NOT NULL/);
});
