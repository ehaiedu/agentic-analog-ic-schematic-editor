export const AGENT_MODEL_ROUTES = ["auto", "qwen38", "qwen36", "qwen35"] as const;

export type AgentModelRoute = typeof AGENT_MODEL_ROUTES[number];

export interface AgentModelCatalogItem {
  route: AgentModelRoute;
  label: string;
  description: string;
  configured: boolean;
}

export const AGENT_MODEL_LABELS: Record<AgentModelRoute, string> = {
  auto: "Auto",
  qwen38: "Qwen3.8-27B",
  qwen36: "Qwen3.6-35B",
  qwen35: "Qwen3.5-9B",
};

export function normalizeAgentModelRoute(value: unknown): AgentModelRoute | null {
  return typeof value === "string" && (AGENT_MODEL_ROUTES as readonly string[]).includes(value)
    ? value as AgentModelRoute
    : null;
}
