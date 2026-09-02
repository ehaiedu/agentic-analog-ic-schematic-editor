import type { OptimizationRoundMetric } from "./optimizationMetrics";

export type ReleaseFamily = "comparator" | "opamp";

export interface ReleaseFamilyProfile {
  family: ReleaseFamily;
  label: string;
  metricCards: string[];
  waveformPresets: string[];
}

export const RELEASE_FAMILY_PROFILES: Record<ReleaseFamily, ReleaseFamilyProfile> = {
  comparator: {
    family: "comparator",
    label: "Comparator",
    metricCards: ["tpd_avg_ns", "output_swing_v", "input_offset_mv", "power_mw"],
    waveformPresets: ["input_differential", "clock", "latch_differential", "output", "supply_current"],
  },
  opamp: {
    family: "opamp",
    label: "OTA / OpAmp",
    metricCards: ["gain_db", "ugbw_hz", "pm_deg", "settling_time_ns", "power_mw"],
    waveformPresets: ["ac_gain", "ac_phase", "step_input", "step_output", "compensation_node", "supply_current"],
  },
};

export interface AgentTraceEvent {
  sequence: number;
  record_kind: string;
  event_hash: string;
  payload: Record<string, unknown>;
}

export interface AgentTraceExport {
  schema: "analogweave.agent_trace_export.v1";
  conversation: {
    conversation_id: string;
    project_id: string;
    active_family: ReleaseFamily;
    analogweave_version: string;
    speg_version: string;
    [key: string]: unknown;
  };
  events: AgentTraceEvent[];
}

export interface AgentTimelineItem {
  id: string;
  sequence: number;
  kind: string;
  title: string;
  status: "info" | "proposed" | "approved" | "running" | "passed" | "failed";
  body: string;
  code?: string;
  metrics?: Record<string, unknown>;
  evidenceLevel?: string;
}

const SUSPICIOUS_KEYS = [
  "absolute_path",
  "remote_path",
  "remote_workdir",
  "pdk_include",
  "model_path",
  "license",
  "password",
  "api_key",
  "secret",
  "ssh_command",
  "ssh_user",
  "ssh_host",
];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | undefined {
  const valueNumber = typeof value === "number" ? value : Number(value);
  return Number.isFinite(valueNumber) ? valueNumber : undefined;
}

function assertSafeValue(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeValue(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      const lowered = key.toLowerCase();
      if (SUSPICIOUS_KEYS.some((part) => lowered.includes(part)) && item !== "[REDACTED]") {
        throw new Error(`Unsafe agent trace field at ${path}.${key}`);
      }
      assertSafeValue(item, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === "string") {
    const normalized = value.replaceAll("\\", "/").toLowerCase();
    if (
      normalized.includes("/home/")
      || normalized.includes("/zebu_data/")
      || /^[a-z]:\//i.test(normalized)
      || normalized.includes("bearer ")
      || /sk-[a-z0-9_-]{20,}/i.test(normalized)
    ) {
      throw new Error(`Unsafe agent trace value at ${path}`);
    }
  }
}

export function parseAgentTrace(input: unknown): AgentTraceExport {
  const root = record(input);
  if (root.schema !== "analogweave.agent_trace_export.v1") {
    throw new Error("Unsupported AnalogWeave agent trace schema");
  }
  assertSafeValue(root, "trace");
  const conversation = record(root.conversation);
  const family = text(conversation.active_family);
  if (family !== "comparator" && family !== "opamp") {
    throw new Error(`Release-1 trace family is not enabled: ${family}`);
  }
  const events = Array.isArray(root.events) ? root.events.map((value) => {
    const item = record(value);
    const payload = record(item.payload);
    return {
      sequence: numberValue(item.sequence) ?? 0,
      record_kind: text(item.record_kind),
      event_hash: text(item.event_hash),
      payload,
    };
  }) : [];
  for (let index = 1; index < events.length; index += 1) {
    if (events[index].sequence <= events[index - 1].sequence) {
      throw new Error("Agent trace sequence is not strictly increasing");
    }
  }
  return {
    schema: "analogweave.agent_trace_export.v1",
    conversation: {
      ...conversation,
      conversation_id: text(conversation.conversation_id),
      project_id: text(conversation.project_id),
      active_family: family,
      analogweave_version: text(conversation.analogweave_version),
      speg_version: text(conversation.speg_version),
    },
    events,
  };
}

function resultStatus(payload: Record<string, unknown>): AgentTimelineItem["status"] {
  if (payload.status === "succeeded") return "passed";
  if (payload.status === "needs_repair" || payload.status === "failed") return "failed";
  return "info";
}

export function agentTimeline(trace: AgentTraceExport): AgentTimelineItem[] {
  const completeSources = new Set(
    trace.events
      .filter((event) => event.record_kind === "code_artifact")
      .map((event) => text(event.payload.complete_source))
      .filter(Boolean),
  );
  return trace.events.map((event) => {
    const payload = event.payload;
    const base = { id: event.event_hash, sequence: event.sequence, kind: event.record_kind };
    if (event.record_kind === "user_message") {
      return { ...base, title: "Design request", status: "info", body: text(payload.exact_text) };
    }
    if (event.record_kind === "model_response") {
      const generatedCode = text(payload.generated_code);
      return {
        ...base,
        title: "SPEG Design Agent",
        status: "info",
        body: text(payload.visible_answer_markdown),
        code: generatedCode && !completeSources.has(generatedCode) ? generatedCode : undefined,
      };
    }
    if (event.record_kind === "code_artifact") {
      return {
        ...base,
        title: "AnalogWeave Python / AnalogIR",
        status: "info",
        body: `IR ${text(payload.analog_ir_hash).slice(0, 12)}`,
        code: text(payload.complete_source),
      };
    }
    if (event.record_kind === "agent_action") {
      return {
        ...base,
        title: text(payload.action_type) || "Agent action",
        status: "proposed",
        body: `Action ${text(payload.action_version)}`,
        code: Object.keys(record(payload.patch_ir)).length ? JSON.stringify(payload.patch_ir, null, 2) : undefined,
      };
    }
    if (event.record_kind === "approval") {
      return {
        ...base,
        title: "Approval",
        status: payload.decision === "approved" ? "approved" : "failed",
        body: `${text(payload.decision)} · ${text(payload.approval_scope)}`,
      };
    }
    if (event.record_kind === "tool_invocation") {
      return {
        ...base,
        title: text(payload.tool_name) || "Tool invocation",
        status: payload.state === "completed" ? "passed" : "running",
        body: `${text(payload.resource_id)} · ${text(payload.job_id)}`,
      };
    }
    if (event.record_kind === "tool_result") {
      return {
        ...base,
        title: "Spectre result",
        status: resultStatus(payload),
        body: text(payload.result_summary),
        metrics: record(payload.metrics),
        evidenceLevel: text(payload.evidence_level),
      };
    }
    if (event.record_kind === "repair_round") {
      return {
        ...base,
        title: `Repair round ${numberValue(payload.round_index) ?? 0}`,
        status: payload.termination === "target_achieved" ? "passed" : "failed",
        body: text(payload.termination),
        metrics: record(payload.observed_metric_delta),
      };
    }
    return { ...base, title: event.record_kind, status: "info", body: "" };
  });
}

export function metricsFromAgentTrace(trace: AgentTraceExport): OptimizationRoundMetric[] {
  let round = 0;
  return trace.events.flatMap((event): OptimizationRoundMetric[] => {
    if (event.record_kind !== "tool_result") return [];
    const payload = event.payload;
    const metrics = record(payload.metrics);
    const powerMw = numberValue(metrics.power_mw);
    const row: OptimizationRoundMetric = {
      round,
      candidateId: text(payload.job_id),
      specPassed: payload.status === "succeeded",
      failureSignature: Array.isArray(payload.failure_labels)
        ? payload.failure_labels.map(String).join("; ")
        : "",
      signoffLevel: text(payload.evidence_level),
      powerUw: powerMw === undefined ? undefined : powerMw * 1000,
      notes: [text(payload.result_summary)].filter(Boolean),
      waveforms: [],
    };
    if (trace.conversation.active_family === "comparator") {
      const delayNs = numberValue(metrics.tpd_avg_ns);
      row.delayPs = delayNs === undefined ? undefined : delayNs * 1000;
      row.offsetMv = numberValue(metrics.input_offset_mv);
      row.outputSwingV = numberValue(metrics.output_swing_v);
    } else {
      row.gainDb = numberValue(metrics.gain_db);
      const ugbwHz = numberValue(metrics.ugbw_hz);
      row.ugbwMhz = ugbwHz === undefined ? undefined : ugbwHz / 1e6;
      row.phaseMarginDeg = numberValue(metrics.pm_deg);
      row.slewVus = numberValue(metrics.slew_rate_v_per_us);
      row.settlingNs = numberValue(metrics.settling_time_ns);
    }
    round += 1;
    return [row];
  });
}
