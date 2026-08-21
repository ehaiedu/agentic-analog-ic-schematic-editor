import { getD1 } from "@/db";
import { ensureDatabase } from "@/db/runtime";
import {
  derivePasswordHash,
  equalPasswordHash,
  passwordRecord,
} from "@/lib/auth";
import { DEVELOPMENT_ACCOUNT_USERNAME } from "@/lib/developmentAccount";
import type { DevelopmentAccountCredentials } from "@/lib/developmentAccountGate.server";
import { createDemoDocument } from "@/lib/schematic";
import { serializeSchematic } from "@/lib/persistence";

export type DevelopmentLoginRow = {
  id: string;
  username: string;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  created_at: number;
};

async function findDevelopmentAccount(): Promise<DevelopmentLoginRow | null> {
  return getD1().prepare(`SELECT id, username, password_hash, password_salt,
      password_iterations, created_at
    FROM users WHERE normalized_username = ?`)
    .bind(DEVELOPMENT_ACCOUNT_USERNAME)
    .first<DevelopmentLoginRow>();
}

async function synchronizeDevelopmentPassword(
  row: DevelopmentLoginRow,
  password: string,
): Promise<DevelopmentLoginRow> {
  const candidate = await derivePasswordHash(
    password,
    row.password_salt,
    row.password_iterations,
  );
  if (equalPasswordHash(candidate, row.password_hash)) return row;

  const replacement = await passwordRecord(password);
  await getD1().prepare(`UPDATE users
    SET password_hash = ?, password_salt = ?, password_iterations = ?
    WHERE id = ?`).bind(
      replacement.hash,
      replacement.salt,
      replacement.iterations,
      row.id,
    ).run();
  return {
    ...row,
    password_hash: replacement.hash,
    password_salt: replacement.salt,
    password_iterations: replacement.iterations,
  };
}

export async function ensureDevelopmentAccount(
  credentials: DevelopmentAccountCredentials,
): Promise<DevelopmentLoginRow> {
  await ensureDatabase();
  const existing = await findDevelopmentAccount();
  if (existing) return synchronizeDevelopmentPassword(existing, credentials.password);

  const db = getD1();
  const userId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const now = Date.now();
  const passwordData = await passwordRecord(credentials.password);
  const starterName = "CMOS 反相器示例";
  const starter = { ...createDemoDocument(), project: starterName };

  try {
    await db.batch([
      db.prepare(`INSERT INTO users
        (id, username, normalized_username, password_hash, password_salt, password_iterations, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
          userId,
          credentials.username,
          DEVELOPMENT_ACCOUNT_USERNAME,
          passwordData.hash,
          passwordData.salt,
          passwordData.iterations,
          now,
        ),
      db.prepare(`INSERT INTO projects
        (id, owner_id, name, description, document_json, revision, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(
          projectId,
          userId,
          starterName,
          "本地开发账号自动创建的可编辑示例",
          serializeSchematic(starter),
          1,
          now,
          now,
        ),
    ]);
  } catch (error) {
    const concurrentlyCreated = await findDevelopmentAccount();
    if (concurrentlyCreated) {
      return synchronizeDevelopmentPassword(concurrentlyCreated, credentials.password);
    }
    throw error;
  }

  const created = await findDevelopmentAccount();
  if (!created) throw new Error("Development account creation did not persist.");
  return created;
}
