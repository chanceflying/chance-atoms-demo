# Security policy

## Reporting a vulnerability

Please do not disclose vulnerabilities, credentials, personal data, or working
exploits in a public issue.

Use GitHub's **Security → Report a vulnerability** flow for this repository. If
private vulnerability reporting is not available, contact the repository owner
through their GitHub profile and share only enough information to establish a
private reporting channel.

Include the affected route or component, reproduction steps, expected impact,
and any safe mitigation you have identified. Reports will be acknowledged as
soon as practical; timelines depend on severity and reproducibility.

## Supported version

This demonstration project supports only the latest revision of the `main`
branch. Secrets must be stored in GitHub or Cloudflare secret stores and must
never be committed to the repository.

## Authentication boundary

- GitHub sign-in requests no OAuth scopes beyond public identity.
- OAuth `state` and PKCE values are short-lived, single-use, and stored in
  `HttpOnly` cookies.
- GitHub access tokens are used only to fetch the authenticated profile and are
  never stored in D1, browser storage, logs, or project exports.
- Application sessions use random bearer tokens in `HttpOnly`, `Secure` (on
  HTTPS), `SameSite=Lax` cookies. D1 stores only SHA-256 token hashes.
- Project authorization is resolved on the server. Clients cannot select an
  owner or submit a trusted user ID.
- Project mutations require JSON and reject cross-origin browser requests using
  Origin and Fetch Metadata checks.
- Internal workspace owner IDs are never serialized to clients. Account and
  guest workspaces use separate namespaces, and guest resolution rejects any
  workspace already owned by an account.
- Logging out revokes the server-side session; expired or revoked sessions fall
  back to a separate anonymous workspace.

Anonymous projects remain available for frictionless evaluation. Signing in
claims only the projects associated with the current anonymous workspace
cookie; projects cannot be claimed after that cookie has been lost.
