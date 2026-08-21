import { getD1 } from "../db";
import { ensureDatabase } from "../db/runtime";
import { isDevelopmentAccountUsername } from "./developmentAccount";
import { isDevelopmentAccountRequest } from "./developmentAccountGate.server";

export const SESSION_COOKIE = "agentic_analog_ic_schematic_editor_session";
const LEGACY_SESSION_COOKIE = "analog_studio_session";
const SESSION_SECONDS = 60 * 60 * 24 * 14;
const PASSWORD_ITERATIONS = 600_000;

export interface AuthUser {
  id: string;
  username: string;
  createdAt: number;
}

type UserRow = {
  id: string;
  username: string;
  normalized_username: string;
  created_at: number;
};

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function digest(value: string): Promise<string> {
  const result = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(result));
}

export function normalizeUsername(username: string): string {
  return username.trim().toLocaleLowerCase("zh-CN");
}

export function rejectCrossOriginWrite(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  if (origin === new URL(request.url).origin) return null;
  return json({ error: "跨站请求已被拒绝" }, { status: 403 });
}

export function validateCredentials(username: unknown, password: unknown): string | null {
  if (typeof username !== "string" || typeof password !== "string") return "请输入用户名和密码";
  const trimmed = username.trim();
  if (trimmed.length < 3 || trimmed.length > 32) return "用户名需为 3–32 个字符";
  if (!/^[\p{L}\p{N}_.-]+$/u.test(trimmed)) return "用户名只能包含文字、数字、点、短横线或下划线";
  if (password.length < 8 || password.length > 128) return "密码需为 8–128 个字符";
  return null;
}

export async function passwordRecord(password: string): Promise<{
  hash: string;
  salt: string;
  iterations: number;
}> {
  const salt = randomToken(18);
  return {
    hash: await derivePasswordHash(password, salt, PASSWORD_ITERATIONS),
    salt,
    iterations: PASSWORD_ITERATIONS,
  };
}

export async function derivePasswordHash(password: string, salt: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: base64UrlToBytes(salt) as BufferSource,
      iterations,
    },
    key,
    256,
  );
  return bytesToBase64Url(new Uint8Array(bits));
}

export function equalPasswordHash(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function cookieValue(request: Request, name: string): string | null {
  const source = request.headers.get("cookie") ?? "";
  for (const part of source.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

function namedSessionCookie(name: string, token: string, request: Request, maxAge: number): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function sessionCookie(token: string, request: Request, maxAge = SESSION_SECONDS): string {
  return namedSessionCookie(SESSION_COOKIE, token, request, maxAge);
}

function requestSessionTokens(request: Request): string[] {
  const tokens = [
    cookieValue(request, SESSION_COOKIE),
    cookieValue(request, LEGACY_SESSION_COOKIE),
  ].filter((token): token is string => Boolean(token));
  return [...new Set(tokens)];
}

export async function createSession(request: Request, userId: string): Promise<string> {
  await ensureDatabase();
  const token = randomToken();
  const now = Date.now();
  await getD1().prepare(
    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
  ).bind(await digest(token), userId, now, now + SESSION_SECONDS * 1000).run();
  return sessionCookie(token, request);
}

export async function getSessionUser(request: Request): Promise<AuthUser | null> {
  const tokens = requestSessionTokens(request);
  if (tokens.length === 0) return null;
  await ensureDatabase();
  for (const token of tokens) {
    const row = await getD1().prepare(`SELECT users.id, users.username, users.normalized_username, users.created_at
      FROM sessions
      INNER JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ?`)
      .bind(await digest(token), Date.now())
      .first<UserRow>();
    if (!row) continue;
    if (
      isDevelopmentAccountUsername(row.normalized_username)
      && !isDevelopmentAccountRequest(request)
    ) {
      return null;
    }
    return { id: row.id, username: row.username, createdAt: row.created_at };
  }
  return null;
}

export async function destroySession(request: Request): Promise<string[]> {
  const tokens = requestSessionTokens(request);
  if (tokens.length > 0) {
    await ensureDatabase();
    for (const token of tokens) {
      await getD1().prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await digest(token)).run();
    }
  }
  return [
    sessionCookie("", request, 0),
    namedSessionCookie(LEGACY_SESSION_COOKIE, "", request, 0),
  ];
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}
