import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGithubAuthorizationUrl,
  constantTimeEqual,
  createAccountWorkspaceId,
  createPkcePair,
  hashSessionToken,
  isSameOriginRequest,
  parseGithubProfile,
  secureCookie,
  sha256Base64Url,
  validateOAuthCallback,
} from "../lib/auth-core";
import { serializeProject } from "../db/serializers";

test("PKCE uses an RFC 7636 compatible S256 challenge", async () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  assert.equal(
    await sha256Base64Url(verifier),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  );

  const pair = await createPkcePair();
  assert.match(pair.verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(pair.challenge, await sha256Base64Url(pair.verifier));
});

test("GitHub authorize URL requests public identity only", () => {
  const url = buildGithubAuthorizationUrl({
    clientId: "client-123",
    redirectUri: "https://demo.example/api/auth/github/callback",
    state: "state-123",
    codeChallenge: "challenge-123",
  });

  assert.equal(url.origin, "https://github.com");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_challenge"), "challenge-123");
  assert.equal(url.searchParams.has("scope"), false);
});

test("session hashing is deterministic and never stores the bearer token", async () => {
  const token = "private-session-token-that-stays-in-the-cookie";
  const first = await hashSessionToken(token);
  const second = await hashSessionToken(token);

  assert.equal(first, second);
  assert.notEqual(first, token);
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
});

test("account ownership stays outside the guest UUID and API response boundary", () => {
  const accountWorkspaceId = createAccountWorkspaceId();
  assert.match(
    accountWorkspaceId,
    /^account_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );

  const project = serializeProject({
    id: "project-1",
    workspace_id: accountWorkspaceId,
    title: "Private project",
    prompt: "test",
    current_spec: "{}",
    records: "[]",
    current_version: 1,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
  });
  assert.equal(Object.hasOwn(project, "workspaceId"), false);
  assert.equal(JSON.stringify(project).includes(accountWorkspaceId), false);
});

test("constant-time state comparison rejects mismatches", () => {
  assert.equal(constantTimeEqual("same-state", "same-state"), true);
  assert.equal(constantTimeEqual("same-state", "other-state"), false);
  assert.equal(constantTimeEqual("short", "shorter"), false);
});

test("OAuth callback accepts one well-formed code and rejects invalid state", () => {
  const valid = {
    expectedState: "expected-state",
    returnedState: "expected-state",
    verifier: "a".repeat(43),
    code: "github-code",
    providerError: null,
  };

  assert.deepEqual(validateOAuthCallback(valid), {
    code: "github-code",
    verifier: "a".repeat(43),
  });
  assert.equal(
    validateOAuthCallback({ ...valid, returnedState: "attacker-state" }),
    null,
  );
  assert.equal(validateOAuthCallback({ ...valid, providerError: "denied" }), null);
  assert.equal(validateOAuthCallback({ ...valid, verifier: "too-short" }), null);
  assert.equal(validateOAuthCallback({ ...valid, code: "x".repeat(513) }), null);
});

test("GitHub public profiles are normalized and unsafe avatars rejected", () => {
  assert.deepEqual(
    parseGithubProfile({
      id: 12345,
      login: "chanceflying",
      name: " Chance ",
      avatar_url: "https://avatars.githubusercontent.com/u/12345?v=4",
    }),
    {
      githubId: "12345",
      login: "chanceflying",
      name: "Chance",
      avatarUrl: "https://avatars.githubusercontent.com/u/12345?v=4",
    },
  );
  assert.throws(
    () =>
      parseGithubProfile({
        id: 12345,
        login: "chanceflying",
        name: null,
        avatar_url: "javascript:alert(1)",
      }),
    /HTTPS/,
  );
});

test("logout origin and authentication cookie attributes are strict", () => {
  const sameOrigin = new Request("https://demo.example/api/auth/logout", {
    method: "POST",
    headers: { Origin: "https://demo.example" },
  });
  const crossOrigin = new Request("https://demo.example/api/auth/logout", {
    method: "POST",
    headers: { Origin: "https://attacker.example" },
  });

  assert.equal(isSameOriginRequest(sameOrigin), true);
  assert.equal(isSameOriginRequest(crossOrigin), false);
  assert.equal(
    isSameOriginRequest(new Request("https://demo.example/api/auth/logout")),
    false,
  );
  assert.match(
    secureCookie(sameOrigin, "atoms_session", "secret", { maxAge: 60 }),
    /Path=\/; Max-Age=60; HttpOnly; SameSite=Lax; Secure$/,
  );
});
