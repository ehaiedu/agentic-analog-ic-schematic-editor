const SAFE_JOB_FIELDS = [
  "job_id",
  "family",
  "operation",
  "execution_backend",
  "status",
  "project_id",
  "input_revision",
  "spec_hash",
  "attempt",
  "created_at",
  "started_at",
  "finished_at",
  "returncode",
  "error",
  "status_url",
  "result_url",
] as const;

export class SpegApiError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

function apiBaseUrl(): string {
  const raw = process.env.SPEG_API_BASE_URL?.trim();
  if (!raw) throw new SpegApiError("SPEG 服务尚未配置", 503);
  const parsed = new URL(raw);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SpegApiError("SPEG 服务地址配置无效", 503);
  }
  return parsed.toString().replace(/\/$/u, "");
}

export async function spegApi(path: string, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body) headers.set("content-type", "application/json");
  const token = process.env.SPEG_API_TOKEN?.trim();
  if (token) headers.set("authorization", `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      ...init,
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    if (error instanceof SpegApiError) throw error;
    throw new SpegApiError("无法连接 SPEG 服务", 503);
  }
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Upstream HTML, logs, and paths are never reflected to the browser.
  }
  if (!response.ok) {
    const detail = payload && typeof payload === "object" && "detail" in payload
      ? String((payload as { detail?: unknown }).detail ?? "")
      : "";
    throw new SpegApiError(detail || "SPEG 请求失败", response.status >= 400 && response.status < 500 ? response.status : 502);
  }
  return payload;
}

export function publicSpegJob(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  return Object.fromEntries(SAFE_JOB_FIELDS.flatMap((key) => key in source ? [[key, source[key]]] : []));
}

export function spegBackendAlias(): string {
  return process.env.SPEG_EXECUTION_BACKEND?.trim() || "configured";
}
