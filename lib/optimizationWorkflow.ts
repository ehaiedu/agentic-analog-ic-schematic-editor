import type { CompileResult, NetlistDialect } from "./netlist";
import type { PdkRequestContract } from "./pdkRegistry";
import { getDeviceDefinition, type SchematicDocument } from "./schematic";

export type OptimizationWorkflowKind =
  | "end_to_end_generate_optimize"
  | "prompt_directed_modify_optimize";

export type OptimizationWorkflowMode = "auto" | OptimizationWorkflowKind;

export interface ExtractedTargetMetrics {
  enob_min?: number;
  sndr_db_min?: number;
  snr_db_min?: number;
  sfdr_db_min?: number;
  power_uw_max?: number;
  resolution_bits?: number;
}

export interface OptimizationRunRequest {
  schema: "analog_studio.optimization_run_request.v1";
  run_id: string;
  created_at: string;
  prompt_text: string;
  workflow_kind: OptimizationWorkflowKind;
  resource_id: "configured_optimization_backend";
  simulator_engine: "configured_simulator_backend";
  max_rounds: number;
  spec: {
    target_metrics: ExtractedTargetMetrics;
    constraints: {
      design_source_kind: "prompt_only" | "analog_studio_seed_netlist";
      seed_available: boolean;
      netlist_dialect: NetlistDialect;
      evidence_level_required: "transistor_nominal";
      pdk_profile_id: string;
    };
    active_pdk?: PdkRequestContract;
  };
  seed_netlist?: {
    dialect: NetlistDialect;
    text: string;
    erc_issue_count: number;
    cell: string;
    library: string;
  };
  prompt_trace_seed: {
    prompt_hash: string;
    source_cell: string;
    source_library: string;
    document_revision: number;
    netlistable_instance_count: number;
  };
  artifact_contract: {
    prompt_original: "prompts/prompt_original.txt";
    prompt_trace: "prompts/prompt_trace.json";
    per_round_metrics: "artifacts/per_round_metrics.json";
    round_artifacts: "rounds/<round>/";
  };
  tags: string[];
}

function hashText(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function readMetric(prompt: string, names: readonly string[]): number | undefined {
  const escapedNames = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const patterns = [
    new RegExp(`(?:${escapedNames})\\s*(?:>=|>|不低于|大于|达到|至少|目标|为)?\\s*([0-9]+(?:\\.[0-9]+)?)`, "i"),
    new RegExp(`([0-9]+(?:\\.[0-9]+)?)\\s*(?:dB|db|bit|bits|位)?\\s*(?:以上|左右|的)?\\s*(?:${escapedNames})`, "i"),
  ];
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (match) return Number(match[1]);
  }
  return undefined;
}

function readPowerUw(prompt: string): number | undefined {
  const match = prompt.match(/(?:power|功耗)\s*(?:<=|<|不超过|低于|小于|目标|为)?\s*([0-9]+(?:\.[0-9]+)?)\s*(uw|µw|mw|w)?/i)
    ?? prompt.match(/([0-9]+(?:\.[0-9]+)?)\s*(uw|µw|mw|w)\s*(?:以内|以下|左右)?\s*(?:power|功耗)?/i);
  if (!match) return undefined;
  const value = Number(match[1]);
  const unit = (match[2] ?? "uw").toLowerCase();
  if (unit === "mw") return value * 1000;
  if (unit === "w") return value * 1_000_000;
  return value;
}

export function extractTargetMetrics(promptText: string): ExtractedTargetMetrics {
  const prompt = promptText.trim();
  const metrics: ExtractedTargetMetrics = {};
  const resolution = readMetric(prompt, ["resolution", "分辨率", "bits", "bit", "位"]);
  const enob = readMetric(prompt, ["ENOB", "有效位"]);
  const sndr = readMetric(prompt, ["SNDR"]);
  const snr = readMetric(prompt, ["SNR"]);
  const sfdr = readMetric(prompt, ["SFDR"]);
  const power = readPowerUw(prompt);

  if (resolution !== undefined) metrics.resolution_bits = resolution;
  if (enob !== undefined) metrics.enob_min = enob;
  if (sndr !== undefined) metrics.sndr_db_min = sndr;
  if (snr !== undefined) metrics.snr_db_min = snr;
  if (sfdr !== undefined) metrics.sfdr_db_min = sfdr;
  if (power !== undefined) metrics.power_uw_max = power;
  return metrics;
}

function hasNetlistableSeed(document: SchematicDocument): boolean {
  return document.nodes.some((node) => getDeviceDefinition(node.kind).netlistable);
}

export function chooseOptimizationWorkflow(
  mode: OptimizationWorkflowMode,
  seedAvailable: boolean,
  promptText: string,
): OptimizationWorkflowKind {
  if (mode !== "auto") return mode;
  if (!seedAvailable) return "end_to_end_generate_optimize";
  if (/(重新生成|从零|新建|end\s*to\s*end|e2e|生成.*电路)/i.test(promptText)) {
    return "end_to_end_generate_optimize";
  }
  return "prompt_directed_modify_optimize";
}

export function buildOptimizationRunRequest(options: {
  promptText: string;
  document: SchematicDocument;
  compiled: CompileResult;
  dialect: NetlistDialect;
  workflowMode?: OptimizationWorkflowMode;
  maxRounds?: number;
  pdkProfile?: string;
  pdkContract?: PdkRequestContract;
  now?: Date;
}): OptimizationRunRequest {
  const promptText = options.promptText.trim();
  const seedAvailable = hasNetlistableSeed(options.document);
  const workflowKind = chooseOptimizationWorkflow(options.workflowMode ?? "auto", seedAvailable, promptText);
  const createdAt = (options.now ?? new Date()).toISOString();
  const promptHash = hashText(`${promptText}\n${options.document.cell}\n${options.compiled.text}`);
  const designSourceKind = seedAvailable ? "analog_studio_seed_netlist" : "prompt_only";
  const pdkProfile = options.pdkProfile
    ?? options.pdkContract?.workflow_profile
    ?? "configured_default";
  const request: OptimizationRunRequest = {
    schema: "analog_studio.optimization_run_request.v1",
    run_id: `opt_${promptHash}_${createdAt.replace(/[-:.TZ]/g, "").slice(0, 14)}`,
    created_at: createdAt,
    prompt_text: promptText,
    workflow_kind: workflowKind,
    resource_id: "configured_optimization_backend",
    simulator_engine: "configured_simulator_backend",
    max_rounds: Math.max(1, Math.min(100, Math.round(options.maxRounds ?? 10))),
    spec: {
      target_metrics: extractTargetMetrics(promptText),
      constraints: {
        design_source_kind: designSourceKind,
        seed_available: seedAvailable,
        netlist_dialect: options.dialect,
        evidence_level_required: "transistor_nominal",
        pdk_profile_id: pdkProfile,
      },
      ...(options.pdkContract ? { active_pdk: options.pdkContract } : {}),
    },
    prompt_trace_seed: {
      prompt_hash: promptHash,
      source_cell: options.document.cell,
      source_library: options.document.library,
      document_revision: options.document.revisions.designRevision,
      netlistable_instance_count: options.document.nodes
        .filter((node) => getDeviceDefinition(node.kind).netlistable).length,
    },
    artifact_contract: {
      prompt_original: "prompts/prompt_original.txt",
      prompt_trace: "prompts/prompt_trace.json",
      per_round_metrics: "artifacts/per_round_metrics.json",
      round_artifacts: "rounds/<round>/",
    },
    tags: ["analog_studio", "closed_loop", workflowKind],
  };

  if (seedAvailable) {
    request.seed_netlist = {
      dialect: options.dialect,
      text: options.compiled.text,
      erc_issue_count: options.compiled.issues.length,
      cell: options.document.cell,
      library: options.document.library,
    };
  }
  return request;
}
