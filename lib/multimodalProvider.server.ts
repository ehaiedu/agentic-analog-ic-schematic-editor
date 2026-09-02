import { env } from "cloudflare:workers";

import {
  buildPrimaryMessages,
  buildVisionMessages,
  type MultimodalHistoryMessage,
  type MultimodalInputFile,
  type MultimodalInputImage,
} from "./multimodalMessages";
import {
  AGENT_MODEL_LABELS,
  AGENT_MODEL_ROUTES,
  type AgentModelCatalogItem,
  type AgentModelRoute,
} from "./agentModels";

export type { MultimodalHistoryMessage, MultimodalInputFile, MultimodalInputImage } from "./multimodalMessages";

export interface MultimodalResponse {
  text: string;
  code: string;
  modelId: string;
  outputImages: Array<{ mediaType: string; bytes: Uint8Array }>;
}

export class MultimodalProviderError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

interface ProviderConfig {
  baseUrl: string;
  model: string;
  token: string;
}

interface ProviderRuntimeConfig {
  agents: Record<Exclude<AgentModelRoute, "auto">, ProviderConfig | null>;
  vision: ProviderConfig | null;
}

function parseProviderConfig(options: {
  baseUrl: string | undefined;
  model: string | undefined;
  token: string | undefined;
  required: boolean;
  label: string;
}): ProviderConfig | null {
  const baseUrl = options.baseUrl?.trim();
  const model = options.model?.trim();
  if (!baseUrl && !model && !options.required) return null;
  if (!baseUrl || !model) throw new MultimodalProviderError(`${options.label}服务配置不完整`, 503);
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new MultimodalProviderError(`${options.label}服务配置无效`, 503);
  }
  return {
    baseUrl: parsed.toString().replace(/\/$/u, ""),
    model,
    token: options.token?.trim() ?? "",
  };
}

function runtimeConfig(): ProviderRuntimeConfig {
  const bindings = env as unknown as Record<string, string | undefined>;
  const fallback = parseProviderConfig({
    baseUrl: bindings.SPEG_AGENT_BASE_URL ?? bindings.SPEG_MULTIMODAL_BASE_URL,
    model: bindings.SPEG_AGENT_MODEL ?? bindings.SPEG_MULTIMODAL_MODEL,
    token: bindings.SPEG_AGENT_API_TOKEN ?? bindings.SPEG_MULTIMODAL_API_TOKEN,
    required: false,
    label: "默认电路 Agent",
  });
  return {
    agents: {
      qwen38: parseProviderConfig({
        baseUrl: bindings.SPEG_QWEN38_BASE_URL,
        model: bindings.SPEG_QWEN38_MODEL,
        token: bindings.SPEG_QWEN38_API_TOKEN,
        required: false,
        label: "Qwen3.8 Agent",
      }) ?? fallback,
      qwen36: parseProviderConfig({
        baseUrl: bindings.SPEG_QWEN36_BASE_URL,
        model: bindings.SPEG_QWEN36_MODEL,
        token: bindings.SPEG_QWEN36_API_TOKEN,
        required: false,
        label: "Qwen3.6 Agent",
      }),
      qwen35: parseProviderConfig({
        baseUrl: bindings.SPEG_QWEN35_BASE_URL,
        model: bindings.SPEG_QWEN35_MODEL,
        token: bindings.SPEG_QWEN35_API_TOKEN,
        required: false,
        label: "Qwen3.5 Agent",
      }),
    },
    vision: parseProviderConfig({
      baseUrl: bindings.SPEG_VISION_BASE_URL,
      model: bindings.SPEG_VISION_MODEL,
      token: bindings.SPEG_VISION_API_TOKEN,
      required: false,
      label: "视觉模型",
    }),
  };
}

function selectPrimary(config: ProviderRuntimeConfig, requested: AgentModelRoute): ProviderConfig {
  if (requested !== "auto") {
    const selected = config.agents[requested];
    if (!selected) throw new MultimodalProviderError(`${AGENT_MODEL_LABELS[requested]} 当前未上线`, 503);
    return selected;
  }
  for (const route of ["qwen38", "qwen36", "qwen35"] as const) {
    if (config.agents[route]) return config.agents[route]!;
  }
  throw new MultimodalProviderError("没有可用的电路 Agent 模型", 503);
}

export function publicAgentModelCatalog(): AgentModelCatalogItem[] {
  const config = runtimeConfig();
  const anyConfigured = Object.values(config.agents).some(Boolean);
  return AGENT_MODEL_ROUTES.map((route) => ({
    route,
    label: AGENT_MODEL_LABELS[route],
    description: route === "auto"
      ? "优先 Qwen3.8，并按服务可用性回退"
      : route === "qwen38"
        ? "主电路推理、代码与工具计划"
        : route === "qwen36"
          ? "复杂生成与修复候选"
          : "轻量诊断与备用",
    configured: route === "auto" ? anyConfigured : Boolean(config.agents[route]),
  }));
}

function dataImage(value: unknown): { mediaType: string; bytes: Uint8Array } | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/u);
  if (!match) return null;
  const binary = atob(match[2]);
  if (binary.length > 5_000_000) return null;
  return { mediaType: match[1], bytes: Uint8Array.from(binary, (character) => character.charCodeAt(0)) };
}

function responseContent(payload: unknown): { text: string; images: Array<{ mediaType: string; bytes: Uint8Array }> } {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const choice = choices[0] && typeof choices[0] === "object" ? choices[0] as Record<string, unknown> : {};
  const message = choice.message && typeof choice.message === "object" ? choice.message as Record<string, unknown> : {};
  const content = message.content;
  const texts: string[] = [];
  const images: Array<{ mediaType: string; bytes: Uint8Array }> = [];
  if (typeof content === "string") texts.push(content);
  if (Array.isArray(content)) {
    content.forEach((part) => {
      if (!part || typeof part !== "object") return;
      const item = part as Record<string, unknown>;
      if ((item.type === "text" || item.type === "output_text") && typeof item.text === "string") texts.push(item.text);
      const rawUrl = typeof item.image_url === "string"
        ? item.image_url
        : item.image_url && typeof item.image_url === "object"
          ? (item.image_url as Record<string, unknown>).url
          : item.data;
      const image = dataImage(rawUrl);
      if (image) images.push(image);
    });
  }
  if (Array.isArray(message.images)) {
    message.images.forEach((value) => {
      const raw = value && typeof value === "object" ? (value as Record<string, unknown>).url : value;
      const image = dataImage(raw);
      if (image) images.push(image);
    });
  }
  return { text: texts.join("\n\n").trim(), images: images.slice(0, 4) };
}

function splitCode(text: string): { text: string; code: string } {
  const match = text.match(/```(?:python|py)\s*\n([\s\S]*?)```/iu);
  return {
    text: text.trim(),
    code: match?.[1]?.trim() ?? "",
  };
}

async function callProvider(config: ProviderConfig, messages: Array<Record<string, unknown>>, maxTokens: number): Promise<{
  text: string;
  images: Array<{ mediaType: string; bytes: Uint8Array }>;
}> {
  const headers = new Headers({ "content-type": "application/json", accept: "application/json" });
  if (config.token) headers.set("authorization", `Bearer ${config.token}`);
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0.2,
        max_tokens: maxTokens,
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new MultimodalProviderError("无法连接模型服务", 503);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new MultimodalProviderError("模型请求失败", response.status >= 400 && response.status < 500 ? response.status : 502);
  const parsed = responseContent(payload);
  if (!parsed.text && !parsed.images.length) throw new MultimodalProviderError("模型返回为空");
  return parsed;
}

export async function requestMultimodalResponse(options: {
  history: MultimodalHistoryMessage[];
  prompt: string;
  images: MultimodalInputImage[];
  files?: MultimodalInputFile[];
  family: string;
  requestedModel?: AgentModelRoute;
}): Promise<MultimodalResponse> {
  const config = runtimeConfig();
  const primary = selectPrimary(config, options.requestedModel ?? "auto");
  const visionEvidence = options.images.length && config.vision
    ? await callProvider(config.vision, buildVisionMessages(options), 1536).then((result) => ({
        modelId: config.vision!.model,
        text: result.text,
      }))
    : null;
  const parsed = await callProvider(primary, buildPrimaryMessages({ ...options, visionEvidence }), 4096);
  const separated = splitCode(parsed.text);
  return { text: separated.text, code: separated.code, modelId: primary.model, outputImages: parsed.images };
}
