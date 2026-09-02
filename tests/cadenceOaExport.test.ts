import assert from "node:assert/strict";
import test from "node:test";

import { buildCadenceOaExportPackage } from "../lib/cadenceOaExport";
import { compileNetlist } from "../lib/netlist";
import { buildPdkRequestContract, resolvePdkRegistryEntry } from "../lib/pdkRegistry";
import { createDemoDocument } from "../lib/schematic";
import { buildCadenceSchematicConvertorRequest } from "../lib/schematicConvertor";

test("Cadence OA handoff package exposes supported Cadence artifacts without faking OA", () => {
  const document = createDemoDocument();
  const pdk = buildPdkRequestContract(resolvePdkRegistryEntry("smic180_smic18mmrf"));
  const request = buildCadenceSchematicConvertorRequest({
    document,
    compiled: compileNetlist(document, "spectre"),
    dialect: "spectre",
    pdkContract: pdk,
    now: new Date("2026-08-22T10:00:00.000Z"),
  });
  const handoff = buildCadenceOaExportPackage({
    document,
    rootDocument: document,
    request,
    pdk,
    now: new Date("2026-08-22T10:00:00.000Z"),
  });
  const paths = handoff.files.map((file) => file.path);
  const openAccessCellview = handoff.files.find((file) => file.path.endsWith("/schematic/sch.oa"));
  const openAccessArchive = handoff.files.find((file) => file.path === "openaccess/cadence_openaccess_library.tar.gz");
  const routingReport = handoff.files.find((file) => file.path === "reports/cadence_schematic_routing_report.json");

  assert.equal(handoff.policy.browser_generates_binary_oa, false);
  assert.equal(handoff.policy.backend_generates_real_openaccess, true);
  assert.equal(handoff.policy.editable_document_is_source_of_truth, true);
  assert.equal(handoff.policy.backend_rebuild_required_after_editor_changes, true);
  assert.equal(handoff.editable_round_trip.final_oa_reflects_editor_state, true);
  assert.equal(openAccessCellview?.generated_by_backend, true);
  assert.equal(openAccessArchive?.generated_by_backend, true);
  assert.equal(routingReport?.generated_by_backend, true);
  assert.ok(paths.some((path) => path.endsWith(".il")));
  assert.ok(paths.some((path) => path.endsWith(".cdl")));
  assert.ok(paths.some((path) => path.endsWith(".oa.json")));
  assert.ok(paths.some((path) => path.endsWith(".editable-roundtrip.json")));
  assert.ok(paths.some((path) => path.endsWith("/schematic/sch.oa")));
  assert.ok(paths.includes("openaccess/cadence_openaccess_library.tar.gz"));
  assert.ok(paths.includes("reports/cadence_schematic_routing_report.json"));
  assert.ok(paths.includes("reports/cadence_routed_schematic_preview.png"));
  assert.doesNotMatch(JSON.stringify(handoff), /\/home\/|\/opt\/|C:\\|I:\\|192\.168\.|token|license|password/i);
});
