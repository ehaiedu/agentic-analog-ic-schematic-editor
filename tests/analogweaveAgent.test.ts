import assert from "node:assert/strict";
import test from "node:test";

import {
  agentTimeline,
  metricsFromAgentTrace,
  parseAgentTrace,
} from "../lib/analogweaveAgent";

function trace() {
  return {
    schema: "analogweave.agent_trace_export.v1",
    conversation: {
      conversation_id: "conv_cmp",
      project_id: "project_cmp",
      active_family: "comparator",
      analogweave_version: "0.1",
      speg_version: "0.1",
    },
    events: [
      { sequence: 1, record_kind: "user_message", event_hash: "h1", payload: { exact_text: "Build comparator" } },
      {
        sequence: 2,
        record_kind: "model_response",
        event_hash: "h2",
        payload: { visible_answer_markdown: "Complete answer", generated_code: "from analogweave import Design" },
      },
      {
        sequence: 3,
        record_kind: "code_artifact",
        event_hash: "h3",
        payload: { complete_source: "from analogweave import Design", analog_ir_hash: "abc123" },
      },
      {
        sequence: 4,
        record_kind: "tool_result",
        event_hash: "h4",
        payload: {
          job_id: "job_before",
          status: "needs_repair",
          evidence_level: "transistor_nominal",
          metrics: { tpd_avg_ns: 5.4, output_swing_v: 1.8, power_mw: 0.1 },
          failure_labels: ["delay_failed"],
          result_summary: "Valid run requires repair.",
        },
      },
      {
        sequence: 5,
        record_kind: "tool_result",
        event_hash: "h5",
        payload: {
          job_id: "job_after",
          status: "succeeded",
          evidence_level: "transistor_nominal",
          metrics: { tpd_avg_ns: 5.2, output_swing_v: 1.82, power_mw: 0.105 },
          failure_labels: [],
          result_summary: "Typed repair passed.",
        },
      },
    ],
  };
}

test("agent trace preserves full visible model response and builds timeline", () => {
  const parsed = parseAgentTrace(trace());
  const timeline = agentTimeline(parsed);
  assert.equal(timeline[1].body, "Complete answer");
  assert.equal(timeline[1].code, undefined);
  assert.equal(timeline[2].code, "from analogweave import Design");
  assert.equal(timeline[3].status, "failed");
  assert.equal(timeline[4].status, "passed");
});

test("agent trace maps comparator results into existing metric views", () => {
  const rows = metricsFromAgentTrace(parseAgentTrace(trace()));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].delayPs, 5400);
  assert.equal(rows[1].powerUw, 105);
  assert.equal(rows[0].specPassed, false);
  assert.equal(rows[1].specPassed, true);
});

test("browser boundary rejects unredacted private runtime details", () => {
  const unsafe = trace() as unknown as { events: Array<{ payload: Record<string, unknown> }> };
  unsafe.events[3].payload = {
    ...unsafe.events[3].payload,
    remote_workdir: "/home/example-user/private/run",
  };
  assert.throws(() => parseAgentTrace(unsafe), /Unsafe agent trace/);
});
