import assert from "node:assert/strict";
import test from "node:test";

import { withHierarchyCellView } from "../lib/hierarchy";
import { createDeviceNode, createEmptyDocument } from "../lib/schematic";
import { inspectSchematicProvenance } from "../lib/schematicProvenance";

function withOneDevice(document: ReturnType<typeof createEmptyDocument>) {
  return {
    ...document,
    nodes: [
      createDeviceNode("nmos4", 100, 100, []),
    ],
  };
}

test("demo seed documents cannot claim converted schematic provenance", () => {
  const document = withOneDevice({
    ...createEmptyDocument("demo", "cdac_demo"),
    properties: {
      generatedBy: "analog_studio_seed_project",
      sourceFlow: "editable_template_cellview",
      evidenceLevel: "demo_seed_not_signoff",
    },
  });

  const provenance = inspectSchematicProvenance(document);

  assert.equal(provenance.kind, "demo_seed");
  assert.equal(provenance.canClaimConvertedSchematic, false);
  assert.match(provenance.reasons.join("\n"), /demo_seed_not_signoff/);
});

test("Cadence routed documents can claim converted schematic provenance", () => {
  const document = withOneDevice({
    ...createEmptyDocument("backend", "generated_top"),
    properties: {
      generatedBy: "cadence_schematic_convertor_backend",
      routedBy: "cadence_schematic_convertor_backend",
      routingStatus: "pass",
    },
  });

  const provenance = inspectSchematicProvenance(document);

  assert.equal(provenance.kind, "cadence_backend_routed");
  assert.equal(provenance.canClaimConvertedSchematic, true);
});

test("demo root blocks child cellviews from masquerading as backend conversion", () => {
  const child = withOneDevice({
    ...createEmptyDocument("demo", "cdac_bit_child"),
    properties: {
      generatedBy: "cadence_schematic_convertor",
      sourceServer: "configured_cadence_backend",
    },
  });
  const root = withHierarchyCellView({
    ...createEmptyDocument("demo", "sar_adc_seed"),
    properties: {
      evidenceLevel: "demo_seed_not_signoff",
    },
  }, child, false);

  const provenance = inspectSchematicProvenance(child, root);

  assert.equal(provenance.kind, "demo_seed");
  assert.equal(provenance.canClaimConvertedSchematic, false);
  assert.match(provenance.reasons.join("\n"), /sar_adc_seed: evidenceLevel=demo_seed_not_signoff/);
});
