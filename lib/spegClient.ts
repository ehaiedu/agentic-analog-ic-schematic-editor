import type { ReleaseFamily } from "./analogweaveAgent";

export type SpegJobState =
  | "created"
  | "validated"
  | "queued"
  | "leased"
  | "staging"
  | "running"
  | "cancel_requested"
  | "collecting"
  | "verifying"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "cancelled"
  | "blocked"
  | "orphaned";

export interface PublicSpegJob {
  job_id: string;
  family: ReleaseFamily;
  operation: "nominal_signoff" | "full_signoff";
  status: SpegJobState;
  project_id: string;
  input_revision: string;
  spec_hash: string;
  attempt: number;
  error?: string;
}

export interface SubmitSpegJobRequest {
  projectId: string;
  family: ReleaseFamily;
  promptText: string;
  netlistText: string;
  inputRevision: string;
  pdkProfileId: string;
  idempotencyKey: string;
  targets: Record<string, number>;
  parameters?: Record<string, number | string | boolean>;
  operation?: "nominal_signoff" | "full_signoff";
}

const TERMINAL_STATES = new Set<SpegJobState>([
  "succeeded",
  "failed",
  "timed_out",
  "cancelled",
  "blocked",
]);

async function responseJson<T>(response: Response): Promise<T> {
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "SPEG request failed");
  return payload;
}

export async function submitSpegJob(request: SubmitSpegJobRequest): Promise<PublicSpegJob> {
  const response = await fetch("/api/speg/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  return (await responseJson<{ job: PublicSpegJob }>(response)).job;
}

export async function getSpegJob(jobId: string): Promise<PublicSpegJob> {
  const response = await fetch(`/api/speg/jobs/${encodeURIComponent(jobId)}`, { cache: "no-store" });
  return (await responseJson<{ job: PublicSpegJob }>(response)).job;
}

export async function waitForSpegJob(
  jobId: string,
  options: { intervalMs?: number; timeoutMs?: number; onUpdate?: (job: PublicSpegJob) => void } = {},
): Promise<PublicSpegJob> {
  const deadline = Date.now() + (options.timeoutMs ?? 4 * 60 * 60_000);
  while (Date.now() < deadline) {
    const job = await getSpegJob(jobId);
    options.onUpdate?.(job);
    if (TERMINAL_STATES.has(job.status)) return job;
    await new Promise((resolve) => window.setTimeout(resolve, options.intervalMs ?? 1_000));
  }
  throw new Error("等待 SPEG 任务超时，任务仍保留在服务器中");
}

export async function getSpegResult(jobId: string): Promise<unknown> {
  const response = await fetch(`/api/speg/jobs/${encodeURIComponent(jobId)}/result`, { cache: "no-store" });
  return (await responseJson<{ result: unknown }>(response)).result;
}

export async function cancelSpegJob(jobId: string): Promise<PublicSpegJob> {
  const response = await fetch(`/api/speg/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
  return (await responseJson<{ job: PublicSpegJob }>(response)).job;
}
