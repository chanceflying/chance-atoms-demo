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
| `OPENAI_API_KEY` | No | Enables model-backed generation. Without it, the application uses its deterministic fallback agent. |

Never add secret values to `wrangler.jsonc`, `.env.example`, workflow YAML, an
issue, or a pull request. Local `.env*` files are ignored by Git.

## Before the first deployment

Create and migrate D1 before the Worker can receive traffic:

```bash
npx wrangler login
npx wrangler d1 create chance-atoms-demo-db --binding DB --update-config
npm run db:migrate:remote
npm run build:worker
npm run deploy:worker
```

Commit the `database_name` and `database_id` added to `wrangler.jsonc`; neither
value is a secret. Keep the binding name as `DB`.

After the first deployment, run CI and confirm lint, typecheck, tests, and the
Cloudflare Worker build pass. Then configure the `production` environment and
use the manual workflow for later deployments.

The workflow builds the complete Worker before applying migrations, then uploads
that exact build. Disable the migration input only when migrations were applied
separately. OpenAI secret sync is opt-in. Leaving the GitHub secret empty does
not remove a secret that already exists on Cloudflare; delete or rotate that
secret explicitly in Cloudflare when needed.

## Rotation and recovery

- Rotate a leaked token immediately in the provider dashboard, then update the
  matching GitHub environment secret.
- Cloudflare deployment history can roll back application code. Database
  migrations must be designed to remain backward compatible; do not assume a
  Worker rollback also rolls back D1 data.
