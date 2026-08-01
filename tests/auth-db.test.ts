import assert from "node:assert/strict";
import test from "node:test";

import { claimGuestWorkspaceAndCreateSession } from "../db/auth";

type Prepared = {
  sql: string;
  values: unknown[];
  bind: (...values: unknown[]) => Prepared;
};

test("guest claim and session creation stay atomic and reject account sources", async () => {
  const prepared: Prepared[] = [];
  let batchCalls = 0;
  const db = {
    prepare(sql: string) {
      const statement: Prepared = {
        sql,
        values: [],
        bind(...values: unknown[]) {
          statement.values = values;
          return statement;
        },
      };
      prepared.push(statement);
      return statement;
    },
    async batch(statements: Prepared[]) {
      batchCalls += 1;
      assert.deepEqual(statements, prepared);
      return [{ results: [{ id: "project-1" }] }, { results: [] }];
    },
  } as unknown as D1Database;

  const claimed = await claimGuestWorkspaceAndCreateSession({
    db,
    guestWorkspaceId: "11111111-1111-4111-8111-111111111111",
    accountWorkspaceId: "account_22222222-2222-4222-8222-222222222222",
    userId: "user-1",
    sessionId: "session-1",
    tokenHash: "token-hash",
    expiresAt: "2026-09-01T00:00:00.000Z",
    now: "2026-08-01T00:00:00.000Z",
  });

  assert.equal(batchCalls, 1);
  assert.equal(prepared.length, 2);
  assert.match(prepared[0].sql, /NOT EXISTS\s*\(\s*SELECT 1 FROM users/);
  assert.equal(prepared[0].values.at(-1), "11111111-1111-4111-8111-111111111111");
  assert.match(prepared[1].sql, /INSERT INTO sessions/);
  assert.equal(claimed, 1);
});
