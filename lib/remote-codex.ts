const DEFAULT_REMOTE_MODEL = "Codex subscription";
const E2EE_VERSION = 1;
const E2EE_MAX_CLOCK_SKEW_MS = 120_000;
const E2EE_CONTEXT = "chance-atoms-bridge:v1";
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export type RemoteCodexEndpoint = "plan" | "generate" | "chat";

export type RemoteCodexConfig = {
  baseUrl: string;
  token: string;
  e2ee: boolean;
};

type E2EEEnvelope = {
  v: 1;
  ts: number;
  nonce: string;
  ciphertext: string;
};

export class RemoteCodexError extends Error {
  readonly upstreamStatus: number | null;

  constructor(message: string, upstreamStatus: number | null = null) {
    super(message);
    this.name = "RemoteCodexError";
    this.upstreamStatus = upstreamStatus;
  }
}

export function getRemoteCodexConfig(): RemoteCodexConfig | null {
  const baseUrl = process.env.REMOTE_CODEX_BRIDGE_URL?.trim();
  const token = process.env.REMOTE_CODEX_BRIDGE_TOKEN?.trim();
  const e2ee = process.env.REMOTE_CODEX_BRIDGE_E2EE?.trim() === "1";
  if (!baseUrl && !token) return null;
  if (!baseUrl || !token) {
    throw new RemoteCodexError(
      "REMOTE_CODEX_BRIDGE_URL and REMOTE_CODEX_BRIDGE_TOKEN must be configured together",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new RemoteCodexError("REMOTE_CODEX_BRIDGE_URL is invalid");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new RemoteCodexError("REMOTE_CODEX_BRIDGE_URL must use HTTP or HTTPS");
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/u, ""),
    token,
    e2ee,
  };
}

export async function requestRemoteCodex(
  config: RemoteCodexConfig,
  endpoint: RemoteCodexEndpoint,
  body: unknown,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const requestBody = config.e2ee
      ? await encryptPayload(config.token, endpoint, "request", body)
      : body;
    if (config.e2ee) {
      headers["X-Chance-Atoms-E2EE"] = "1";
    } else {
      headers.Authorization = `Bearer ${config.token}`;
    }

    const response = await fetch(`${config.baseUrl}/${endpoint}`, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new RemoteCodexError(
        `Remote Codex returned ${response.status}`,
        response.status,
      );
    }

    const responseBody = (await response.json()) as unknown;
    const payload = config.e2ee
      ? await decryptPayload(config.token, endpoint, "response", responseBody)
      : responseBody;
    if (!isRecord(payload)) {
      throw new RemoteCodexError("Remote Codex returned an invalid response");
    }
    return payload;
  } catch (error) {
    if (error instanceof RemoteCodexError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new RemoteCodexError("Remote Codex request timed out");
    }
    throw new RemoteCodexError("Remote Codex request failed");
  } finally {
    clearTimeout(timeout);
  }
}

async function encryptPayload(
  token: string,
  endpoint: RemoteCodexEndpoint,
  direction: "request" | "response",
  payload: unknown,
): Promise<E2EEEnvelope> {
  const ts = Date.now();
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveEncryptionKey(token);
  const plaintext = textEncoder.encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: e2eeAad(direction, endpoint, ts),
    },
    key,
    plaintext,
  );

  return {
    v: E2EE_VERSION,
    ts,
    nonce: toBase64Url(nonce),
    ciphertext: toBase64Url(new Uint8Array(ciphertext)),
  };
}

async function decryptPayload(
  token: string,
  endpoint: RemoteCodexEndpoint,
  direction: "request" | "response",
  envelope: unknown,
): Promise<unknown> {
  if (!isE2EEEnvelope(envelope)) {
    throw new RemoteCodexError("Remote Codex returned an invalid encrypted response");
  }
  if (Math.abs(Date.now() - envelope.ts) > E2EE_MAX_CLOCK_SKEW_MS) {
    throw new RemoteCodexError("Remote Codex returned a stale encrypted response");
  }

  try {
    const nonce = fromBase64Url(envelope.nonce);
    if (nonce.byteLength !== 12) throw new Error("Invalid nonce length");
    const ciphertext = fromBase64Url(envelope.ciphertext);
    const key = await deriveEncryptionKey(token);
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: nonce,
        additionalData: e2eeAad(direction, endpoint, envelope.ts),
      },
      key,
      ciphertext,
    );
    return JSON.parse(textDecoder.decode(plaintext)) as unknown;
  } catch {
    throw new RemoteCodexError("Remote Codex returned an invalid encrypted response");
  }
}

async function deriveEncryptionKey(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(token));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

function e2eeAad(
  direction: "request" | "response",
  endpoint: RemoteCodexEndpoint,
  ts: number,
) {
  return textEncoder.encode(`${E2EE_CONTEXT}:${direction}:${endpoint}:${ts}`);
}

function isE2EEEnvelope(value: unknown): value is E2EEEnvelope {
  return (
    isRecord(value) &&
    value.v === E2EE_VERSION &&
    Number.isSafeInteger(value.ts) &&
    typeof value.nonce === "string" &&
    typeof value.ciphertext === "string"
  );
}

function toBase64Url(value: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < value.length; offset += 32_768) {
    binary += String.fromCharCode(...value.subarray(offset, offset + 32_768));
  }
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string) {
  if (!value || !/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("Invalid base64url");
  const base64 = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const result = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    result[index] = binary.charCodeAt(index);
  }
  if (toBase64Url(result) !== value) throw new Error("Non-canonical base64url");
  return result;
}

export function remoteCodexModel(payload: Record<string, unknown>): string {
  if (typeof payload.model !== "string") return DEFAULT_REMOTE_MODEL;
  const model = payload.model.trim();
  return model && model.length <= 120 ? model : DEFAULT_REMOTE_MODEL;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
