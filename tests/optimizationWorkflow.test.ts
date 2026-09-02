import assert from "node:assert/strict";
import test from "node:test";

import { compileNetlist } from "../lib/netlist";
import { buildPdkRequestContract, resolvePdkRegistryEntry } from "../lib/pdkRegistry";
import { createDemoDocument, createEmptyDocument } from "../lib/schematic";
import {
  buildOptimizationRunRequest,
  chooseOptimizationWorkflow,
  extractTargetMetrics,
} from "../lib/optimizationWorkflow";

test("optimization workflow chooses end-to-end when no schematic seed exists", () => {
  const document = createEmptyDocument("prompt_only", "adc_top");
  const request = buildOptimizationRunRequest({
    promptText: "生成一个 10 bit SAR ADC，ENOB >= 9.2，SNDR 58 dB，功耗 < 2mW",
    document,
    compiled: compileNetlist(document, "spectre"),
    dialect: "spectre",
    now: new Date("2026-08-22T10:00:00.000Z"),
  });

  assert.equal(request.workflow_kind, "end_to_end_generate_optimize");
  assert.equal(request.resource_id, "configured_optimization_backend");
  assert.equal(request.simulator_engine, "configured_simulator_backend");
  assert.equal(request.spec.constraints.design_source_kind, "prompt_only");
  assert.equal(request.seed_netlist, undefined);
  assert.deepEqual(request.artifact_contract, {
    prompt_original: "prompts/prompt_original.txt",
    prompt_trace: "prompts/prompt_trace.json",
    per_round_metrics: "artifacts/per_round_metrics.json",
    round_artifacts: "rounds/<round>/",
  });
});

test("optimization workflow chooses patch when an editable seed exists", () => {
  const document = createDemoDocument();
  const request = buildOptimizationRunRequest({
    promptText: "把反相器尺寸调大，并继续优化 SNDR >= 60 dB",
    document,
    compiled: compileNetlist(document, "spectre"),
    dialect: "spectre",
    now: new Date("2026-08-22T10:00:00.000Z"),
  });

  assert.equal(request.workflow_kind, "prompt_directed_modify_optimize");
  assert.equal(request.spec.constraints.design_source_kind, "analog_studio_seed_netlist");
  assert.ok(request.seed_netlist?.text.includes("subckt cmos_inverter"));
});

test("optimization workflow mode can be forced by the user", () => {
  assert.equal(chooseOptimizationWorkflow("end_to_end_generate_optimize", true, "修改尺寸"), "end_to_end_generate_optimize");
  assert.equal(chooseOptimizationWorkflow("prompt_directed_modify_optimize", false, "从零生成"), "prompt_directed_modify_optimize");
});

test("metric targets are extracted from mixed Chinese and English prompt text", () => {
  const metrics = extractTargetMetrics("设计 12bit ADC，ENOB 不低于 10.5，SNDR >= 65 dB，SFDR 72dB，功耗小于 850uW");

  assert.equal(metrics.resolution_bits, 12);
  assert.equal(metrics.enob_min, 10.5);
  assert.equal(metrics.sndr_db_min, 65);
  assert.equal(metrics.sfdr_db_min, 72);
  assert.equal(metrics.power_uw_max, 850);
});

test("optimization request payload does not expose backend paths or secrets", () => {
  const request = buildOptimizationRunRequest({
    promptText: "优化比较器 offset 和功耗",
    document: createDemoDocument(),
    compiled: compileNetlist(createDemoDocument(), "spectre"),
    dialect: "spectre",
    now: new Date("2026-08-22T10:00:00.000Z"),
  });
  const serialized = JSON.stringify(request);

  assert.doesNotMatch(serialized, /\/home\/|C:\\|I:\\|\/zebu_data\//);
  assert.doesNotMatch(serialized, /token|license|password/i);
});

test("optimization request carries selected PDK contract for backend routing", () => {
  const document = createDemoDocument();
  const pdk = buildPdkRequestContract(resolvePdkRegistryEntry("tsmc22_ulp"));
  const request = buildOptimizationRunRequest({
    promptText: "优化 12bit SAR ADC，功耗小于 1mW",
    document,
    compiled: compileNetlist(document, "spectre"),
    dialect: "spectre",
    pdkContract: pdk,
    now: new Date("2026-08-22T10:00:00.000Z"),
  });
  const serialized = JSON.stringify(request);

  assert.equal(request.spec.constraints.pdk_profile_id, "tsmc22_ulp");
  assert.equal(request.spec.active_pdk?.registry_profile, "tsmc22_ulp");
  assert.equal(request.spec.active_pdk?.layout_contract_status, "partial");
  assert.doesNotMatch(serialized, /\/home\/|\/opt\/|C:\\|I:\\|192\.168\./);
});
