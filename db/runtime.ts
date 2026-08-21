import { getD1 } from "./index";

let ready: Promise<void> | null = null;

/**
 * Keep the LAN build self-initialising. Generated Drizzle migrations remain the
 * source of truth for managed deployments, while this idempotent bootstrap
 * makes a fresh local clone usable without a separate database command.
 */
export function ensureDatabase(): Promise<void> {
  if (ready) return ready;

  const db = getD1();
  ready = db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY NOT NULL,
      username TEXT NOT NULL,
      normalized_username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_iterations INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS users_normalized_username_unique ON users (normalized_username)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      document_json TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS projects_owner_updated_idx ON projects (owner_id, updated_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS project_recovery (
      project_id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      document_json TEXT NOT NULL,
      base_storage_revision INTEGER NOT NULL,
      design_revision INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS project_recovery_owner_idx ON project_recovery (owner_id)"),
  ]).then(async () => {
    try {
      await db.prepare("ALTER TABLE projects ADD COLUMN revision INTEGER NOT NULL DEFAULT 1").run();
    } catch (error) {
      if (!String(error).toLocaleLowerCase().includes("duplicate column")) throw error;
    }
  }).catch((error) => {
    ready = null;
    throw error;
  });

  return ready;
}
