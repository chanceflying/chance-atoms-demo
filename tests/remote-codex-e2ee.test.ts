import assert from "node:assert/strict";
import test from "node:test";

import {
  RemoteCodexError,
  requestRemoteCodex,
  type RemoteCodexConfig,
  type RemoteCodexEndpoint,
} from "../lib/remote-codex";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const token = "correct-test-token";
const config: RemoteCodexConfig = {
  baseUrl: "https://remote-codex.example",
  token,
  e2ee: true,
};

test("remote E2EE sends no bearer token and round-trips encrypted JSON", async () => {
  const originalFetch = globalThis.fetch;
  let sawRequest = false;
  globalThis.fetch = async (_input, init) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("Authorization"), null);
    assert.equal(headers.get("X-Chance-Atoms-E2EE"), "1");

    const envelope = JSON.parse(String(init?.body)) as unknown;
    const request = await decryptEnvelope(token, "chat", "request", envelope);
    assert.deepEqual(request, { message: "只在密文中出现" });
    sawRequest = true;

    return new Response(
      JSON.stringify(
        await encryptEnvelope(token, "chat", "response", {
          reply: "密文回复",
          model: "Codex subscription",
        }),
      ),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const response = await requestRemoteCodex(
      config,
      "chat",
      { message: "只在密文中出现" },
      5_000,
    );
    assert.equal(sawRequest, true);
    assert.equal(response.reply, "密文回复");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("remote E2EE rejects a successful response encrypted with the wrong key", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify(
        await encryptEnvelope("wrong-test-token", "plan", "response", {
          plan: {},
        }),
      ),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

  try {
    await assert.rejects(
      () => requestRemoteCodex(config, "plan", { prompt: "secret" }, 5_000),
      (error: unknown) =>
        error instanceof RemoteCodexError &&
        /invalid encrypted response/u.test(error.message),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

async function keyFor(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

async function encryptEnvelope(
  keyToken: string,
  endpoint: RemoteCodexEndpoint,
  direction: "request" | "response",
  payload: unknown,
) {
  const ts = Date.now();
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: encoder.encode(
        `chance-atoms-bridge:v1:${direction}:${endpoint}:${ts}`,
      ),
    },
    await keyFor(keyToken),
    encoder.encode(JSON.stringify(payload)),
  );
  return {
    v: 1,
    ts,
    nonce: toBase64Url(nonce),
    ciphertext: toBase64Url(new Uint8Array(ciphertext)),
  };
}

async function decryptEnvelope(
  keyToken: string,
  endpoint: RemoteCodexEndpoint,
  direction: "request" | "response",
  value: unknown,
) {
  assert(value && typeof value === "object" && !Array.isArray(value));
  const envelope = value as Record<string, unknown>;
  assert.equal(envelope.v, 1);
  assert.equal(typeof envelope.ts, "number");
  assert.equal(typeof envelope.nonce, "string");
  assert.equal(typeof envelope.ciphertext, "string");
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: fromBase64Url(envelope.nonce as string),
      additionalData: encoder.encode(
        `chance-atoms-bridge:v1:${direction}:${endpoint}:${envelope.ts}`,
      ),
    },
    await keyFor(keyToken),
    fromBase64Url(envelope.ciphertext as string),
  );
  return JSON.parse(decoder.decode(plaintext)) as unknown;
}

function toBase64Url(value: Uint8Array) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string) {
  const base64 = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
