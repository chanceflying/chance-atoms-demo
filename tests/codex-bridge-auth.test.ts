import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import test from "node:test";
import {
  RemoteCodexError,
  requestRemoteCodex,
} from "../lib/remote-codex";

async function availablePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

async function waitUntilReady(url: string, child: ChildProcess, diagnostics: () => string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Bridge exited before startup.\n${diagnostics()}`);
    }
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch {
      // The process can take a moment to bind its local port.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for Bridge startup.\n${diagnostics()}`);
}

async function startBridge(token?: string) {
  const port = await availablePort();
  const environment = { ...process.env };
  delete environment.CODEX_BRIDGE_TOKEN;
  const child = spawn(process.execPath, ["scripts/codex-session-bridge.mjs"], {
    cwd: process.cwd(),
    env: {
      ...environment,
      CODEX_BRIDGE_PORT: String(port),
      ...(token ? { CODEX_BRIDGE_TOKEN: token } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    output += chunk.toString();
  });
  const url = `http://127.0.0.1:${port}`;
  await waitUntilReady(url, child, () => output);

  return {
    url,
    async stop() {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    },
  };
}

test("Codex Bridge optionally protects model routes with a bearer token", async () => {
  const token = "test-bridge-token";
  const protectedBridge = await startBridge(token);
  try {
    const health = await fetch(`${protectedBridge.url}/health`);
    assert.equal(health.status, 200);

    const preflight = await fetch(`${protectedBridge.url}/plan`, {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:3000" },
    });
    assert.equal(preflight.status, 204);
    assert.match(
      preflight.headers.get("access-control-allow-headers") ?? "",
      /Authorization/i,
    );

    for (const path of ["plan", "generate", "chat"]) {
      const missing = await fetch(`${protectedBridge.url}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      assert.equal(missing.status, 401);
      assert.deepEqual(await missing.json(), { error: "未授权。" });

      const wrong = await fetch(`${protectedBridge.url}/${path}`, {
        method: "POST",
        headers: {
          Authorization: "Bearer wrong-token",
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      assert.equal(wrong.status, 401);
    }

    const authorized = await fetch(`${protectedBridge.url}/plan`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(authorized.status, 400);

    await assert.rejects(
      requestRemoteCodex(
        {
          baseUrl: protectedBridge.url,
          token,
          e2ee: true,
        },
        "plan",
        {},
        2_000,
      ),
      (error: unknown) =>
        error instanceof RemoteCodexError && error.upstreamStatus === 400,
    );
    await assert.rejects(
      requestRemoteCodex(
        {
          baseUrl: protectedBridge.url,
          token: "wrong-token",
          e2ee: true,
        },
        "plan",
        {},
        2_000,
      ),
      (error: unknown) =>
        error instanceof RemoteCodexError && error.upstreamStatus === 401,
    );
  } finally {
    await protectedBridge.stop();
  }

  const localBridge = await startBridge();
  try {
    const response = await fetch(`${localBridge.url}/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, 400);
  } finally {
    await localBridge.stop();
  }
});
