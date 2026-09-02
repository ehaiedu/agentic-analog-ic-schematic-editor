import assert from "node:assert/strict";
import test from "node:test";
import { compileNetlist } from "../lib/netlist";
import { createEmptyDocument, type DeviceKind } from "../lib/schematic";
import { parseSchematicDocument } from "../lib/schematicValidation";
import {
  placeSubcircuitTemplate,
  SUBCIRCUIT_TEMPLATES,
  type PlacedSubcircuitTemplateRecord,
  type SubcircuitTemplateKind,
} from "../lib/subcircuitTemplates";
import {
  DEMO_OPTIMIZATION_METRICS,
  summarizeOptimizationMetrics,
  waveformTracesForRound,
} from "../lib/optimizationMetrics";

const MACRO_KINDS = new Set<DeviceKind>([
  "transmission_gate",
  "sampling_switch",
  "cdac_array",
  "sar_logic",
  "dynamic_comparator",
  "diff_pair",
  "current_mirror",
  "bias_current",
  "gain_stage",
  "latch",
  "opamp3",
  "subckt4",
  "subckt5",
  "subckt6",
  "subckt7",
  "subckt8",
  "subckt9",
  "subckt10",
  "subckt11",
  "subckt12",
]);

const MINIMUM_MOS_COUNT: Record<SubcircuitTemplateKind, number> = {
  transmission_gate_cmos: 2,
  sample_hold_cmos: 2,
  cdac_bit_slice_cmos: 6,
  strongarm_comparator_cmos: 9,
  nmos_diff_pair_cmos: 3,
  pmos_current_mirror_cmos: 2,
  ota_5t_cmos: 5,
};

function records(document: ReturnType<typeof createEmptyDocument>): PlacedSubcircuitTemplateRecord[] {
  return Array.isArray(document.extensions?.subcircuitTemplates)
    ? document.extensions.subcircuitTemplates as PlacedSubcircuitTemplateRecord[]
    : [];
}

test("all analog subcircuit templates flatten to editable MOS-level primitives", () => {
  for (const template of SUBCIRCUIT_TEMPLATES) {
    const document = parseSchematicDocument(placeSubcircuitTemplate(
      createEmptyDocument("template_test", template.kind),
      template.kind,
      { x: 420, y: 320 },
    ));
    const mosNodes = document.nodes.filter((node) => node.kind === "nmos4" || node.kind === "pmos4");
    const primitiveKinds = new Set(document.nodes.map((node) => node.kind));
    const templateRecords = records(document);

    assert.equal(templateRecords.length, 1);
    assert.equal(templateRecords[0].flattened, true);
    assert.equal(templateRecords[0].editable, true);
    assert.ok(mosNodes.length >= MINIMUM_MOS_COUNT[template.kind], template.kind);
    assert.equal([...primitiveKinds].some((kind) => MACRO_KINDS.has(kind)), false, template.kind);
    assert.ok(mosNodes.every((node) => node.properties.editablePrimitive === "true"));
    assert.ok(mosNodes.every((node) => node.properties.templateKind === template.kind));

    const compiled = compileNetlist(document, "spectre");
    assert.deepEqual(compiled.issues.filter((issue) => issue.severity === "error"), []);
    assert.match(compiled.text, /\bM\w+\s+/);
  }
});

test("template instances use separate editable signal names until the designer renames them", () => {
  const first = placeSubcircuitTemplate(
    createEmptyDocument("template_test", "two_transmission_gates"),
    "transmission_gate_cmos",
    { x: 260, y: 250 },
  );
  const second = parseSchematicDocument(placeSubcircuitTemplate(first, "transmission_gate_cmos", { x: 720, y: 250 }));
  const instanceNames = records(second).map((record) => record.instanceName);
  const topPinNames = second.nodes
    .filter((node) => node.kind === "input" || node.kind === "output" || node.kind === "bidir")
    .map((node) => node.properties.netName)
    .sort();

  assert.deepEqual(instanceNames, ["XTG1", "XTG2"]);
  assert.equal(new Set(topPinNames).size, topPinNames.length);
  assert.deepEqual(compileNetlist(second, "spectre").issues.filter((issue) => issue.severity === "error"), []);
});

test("strongarm comparator template can drive the waveform viewer demo path", () => {
  const comparator = parseSchematicDocument(placeSubcircuitTemplate(
    createEmptyDocument("template_test", "strongarm_waveform_smoke"),
    "strongarm_comparator_cmos",
    { x: 520, y: 360 },
  ));
  const compiled = compileNetlist(comparator, "spectre");
  const summary = summarizeOptimizationMetrics(DEMO_OPTIMIZATION_METRICS);
  const traces = waveformTracesForRound(summary.latest, DEMO_OPTIMIZATION_METRICS);

  assert.deepEqual(compiled.issues.filter((issue) => issue.severity === "error"), []);
  assert.ok(compiled.text.includes("nmos"));
  assert.ok(compiled.text.includes("pmos"));
  assert.ok(summary.latest);
  assert.ok(traces.length >= 3);
  assert.ok(traces.every((trace) => trace.points.length > 20));
});

test("MOS-level templates omit confusing flight routing guides by default", () => {
  const comparator = parseSchematicDocument(placeSubcircuitTemplate(
    createEmptyDocument("template_test", "strongarm_no_flight_guides"),
    "strongarm_comparator_cmos",
    { x: 520, y: 360 },
  ));
  const flightEdges = comparator.edges.filter((edge) => edge.style === "FLIGHT");
  const normalEdges = comparator.edges.filter((edge) => edge.style !== "FLIGHT");

  assert.equal(flightEdges.length, 0);
  assert.ok(normalEdges.length >= 30);
  assert.deepEqual(compileNetlist(comparator, "spectre").issues.filter((issue) => issue.severity === "error"), []);
});
