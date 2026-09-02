import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return drizzle(env.DB, { schema });
}

export function getD1(): D1Database {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` before using account or project storage."
    );
  }
  return env.DB;
}

export function getAgentMedia(): R2Bucket {
  const bucket = (env as unknown as { AGENT_MEDIA?: R2Bucket }).AGENT_MEDIA;
  if (!bucket) throw new Error("Cloudflare R2 binding `AGENT_MEDIA` is unavailable.");
  return bucket;
}
