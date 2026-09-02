import type { ReleaseFamily } from "./analogweaveAgent";
import type { AgentModelCatalogItem, AgentModelRoute } from "./agentModels";

export interface PersistedAgentAttachment {
  id: string;
  direction: "input" | "output";
  name: string;
  mediaType: string;
  sizeBytes: number;
  width: number;
  height: number;
  sha256: string;
  createdAt: number;
  url: string;
}

export interface AgentConversationSummary {
  id: string;
  title: string;
  activeFamily: ReleaseFamily | "";
  modelRoute: AgentModelRoute;
  createdAt: number;
  updatedAt: number;
}

export interface PersistedAgentMessage {
  id: string;
  sequence: number;
  role: "user" | "assistant";
  kind: string;
  status: "info" | "proposed" | "approved" | "running" | "passed" | "failed";
  title: string;
  text: string;
  code?: string;
  metrics?: Record<string, unknown>;
  evidenceLevel?: string;
  modelId?: string;
  createdAt: number;
  attachments: PersistedAgentAttachment[];
}

async function jsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "Agent history request failed");
  return payload;
}

function base(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/agent`;
}

export async function listAgentConversations(projectId: string): Promise<AgentConversationSummary[]> {
  const response = await fetch(`${base(projectId)}/conversations`, { cache: "no-store" });
  return (await jsonResponse<{ conversations: AgentConversationSummary[] }>(response)).conversations;
}

export async function createPersistedConversation(
  projectId: string,
  options: { title?: string; activeFamily?: ReleaseFamily | ""; modelRoute?: AgentModelRoute } = {},
): Promise<AgentConversationSummary> {
  const response = await fetch(`${base(projectId)}/conversations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(options),
  });
  return (await jsonResponse<{ conversation: AgentConversationSummary }>(response)).conversation;
}

export async function loadAgentConversation(
  projectId: string,
  conversationId: string,
): Promise<{ conversation: AgentConversationSummary; messages: PersistedAgentMessage[] }> {
  const response = await fetch(`${base(projectId)}/conversations/${encodeURIComponent(conversationId)}`, { cache: "no-store" });
  return jsonResponse(response);
}

export async function updatePersistedConversation(
  projectId: string,
  conversationId: string,
  patch: { title?: string; activeFamily?: ReleaseFamily | ""; modelRoute?: AgentModelRoute },
): Promise<void> {
  const response = await fetch(`${base(projectId)}/conversations/${encodeURIComponent(conversationId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  await jsonResponse(response);
}

export async function uploadAgentFile(
  projectId: string,
  conversationId: string,
  file: { blob: Blob; name: string; mediaType?: string; width?: number; height?: number },
): Promise<PersistedAgentAttachment> {
  const form = new FormData();
  form.set("file", file.blob, file.name);
  form.set("width", String(file.width ?? 0));
  form.set("height", String(file.height ?? 0));
  form.set("direction", "input");
  const response = await fetch(`${base(projectId)}/conversations/${encodeURIComponent(conversationId)}/media`, {
    method: "POST",
    body: form,
  });
  return (await jsonResponse<{ attachment: PersistedAgentAttachment }>(response)).attachment;
}

export const uploadAgentImage = uploadAgentFile;

export async function deleteUnboundAgentFile(projectId: string, attachmentId: string): Promise<void> {
  const response = await fetch(`${base(projectId)}/media/${encodeURIComponent(attachmentId)}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) await jsonResponse(response);
}

export const deleteUnboundAgentImage = deleteUnboundAgentFile;

export async function appendAgentMessage(
  projectId: string,
  conversationId: string,
  message: Omit<PersistedAgentMessage, "sequence" | "createdAt" | "attachments"> & { attachmentIds?: string[] },
): Promise<{ id: string; sequence: number; createdAt: number; title?: string }> {
  const response = await fetch(`${base(projectId)}/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(message),
  });
  return (await jsonResponse<{ message: { id: string; sequence: number; createdAt: number; title?: string } }>(response)).message;
}

export async function requestProjectModelResponse(
  projectId: string,
  conversationId: string,
  userMessageId: string,
  modelRoute: AgentModelRoute,
): Promise<PersistedAgentMessage> {
  const response = await fetch(`${base(projectId)}/conversations/${encodeURIComponent(conversationId)}/respond`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userMessageId, modelRoute }),
  });
  return (await jsonResponse<{ message: PersistedAgentMessage }>(response)).message;
}

export async function listAgentModels(projectId: string): Promise<AgentModelCatalogItem[]> {
  const response = await fetch(`${base(projectId)}/models`, { cache: "no-store" });
  return (await jsonResponse<{ models: AgentModelCatalogItem[] }>(response)).models;
}
