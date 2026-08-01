# Cloudflare deployment

Production deployment is intentionally manual. Run the **Deploy to Cloudflare**
workflow from the repository's Actions tab after CI is green.

## Required GitHub environment

Create a GitHub environment named `production`. Adding required reviewers is
recommended so deployment always has an explicit approval step.

Configure these environment secrets:

| Secret | Required | Purpose |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Yes | Deploy Workers and apply D1 migrations. Scope it to the target account and grant only Workers Scripts and D1 edit access. |
| `CLOUDFLARE_ACCOUNT_ID` | Yes | Select the Cloudflare account that owns the Worker and D1 database. |
| `OPENAI_API_KEY` | No | Enables server-side model planning, generation, and chat. Without it, those routes return `503 + OPENAI_NOT_CONFIGURED`; a browser on the demo operator's machine can then use the separately started local Codex Bridge. |

Never add secret values to `wrangler.jsonc`, `.env.example`, workflow YAML, an
issue, or a pull request. Local `.env*` files are ignored by Git.

## GitHub sign-in

Register a separate production GitHub OAuth App using the actual deployed
domain. The current demo uses:

```text
Homepage URL:
https://chance-atoms-demo.chanceflying1.workers.dev

Authorization callback URL:
https://chance-atoms-demo.chanceflying1.workers.dev/api/auth/github/callback
```

The application requests no OAuth scopes and uses only the public GitHub
identity returned by `/user`. Store both runtime values directly as Cloudflare
Worker secrets:

```bash
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
```

These secrets are intentionally not synchronized by the deploy workflow.
Wrangler deployments preserve Worker secrets that are already configured. When
the values are absent, anonymous workspaces continue to work and the sign-in
route returns a controlled configuration error.

## Before the first deployment

Create and migrate D1 before the Worker can receive traffic:

```bash
npx wrangler login
npx wrangler d1 create chance-atoms-demo-db
```

Copy the returned `database_id` into the existing `d1_databases[0]` entry in
`wrangler.jsonc`, keep its binding name as `DB`, and then run:

```bash
npm run db:migrate:remote
npm run build:worker
npm run deploy:worker
```

Do not use `--update-config` while the checked-in config already contains a
`DB` entry: it can append a second binding with the same name. Commit the
updated `database_name` and `database_id`; neither value is a secret. If the
fork changes the Worker name, update both `name` and
`WORKER_SELF_REFERENCE.service` in `wrangler.jsonc`.

After the first deployment, run CI and confirm lint, typecheck, tests, and the
Cloudflare Worker build pass. Then configure the `production` environment and
use the manual workflow for later deployments.

The workflow builds the complete Worker before applying migrations, then uploads
that exact build. Disable the migration input only when migrations were applied
separately. OpenAI secret sync is opt-in: select `sync_openai_secret` when
manually running the workflow if the GitHub secret should be copied to the
Worker. Leaving the GitHub Actions
`OPENAI_API_KEY` secret empty does not remove a secret that already exists on
Cloudflare; delete or rotate that secret explicitly in Cloudflare when needed.

## Rotation and recovery

- Rotate a leaked token immediately in the provider dashboard, then update the
  matching GitHub environment secret.
- Rotate a leaked GitHub OAuth client secret in GitHub, then replace
  `GITHUB_CLIENT_SECRET` in the Cloudflare Worker secret store.
- Cloudflare deployment history can roll back application code. Database
  migrations must be designed to remain backward compatible; do not assume a
  Worker rollback also rolls back D1 data.
