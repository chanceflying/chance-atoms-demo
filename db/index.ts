import { getCloudflareContext } from "@opennextjs/cloudflare";

export async function getDb(): Promise<D1Database> {
  const { env } = await getCloudflareContext({ async: true });
  const db = env.DB;

  if (!db) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Define it in wrangler.jsonc and run the local or remote D1 migrations before using the application.",
    );
  }

  return db;
}

export async function ensureDatabase() {
  return getDb();
}
