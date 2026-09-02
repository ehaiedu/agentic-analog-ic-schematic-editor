import assert from "node:assert/strict";
import test from "node:test";

import type { CompileResult } from "../lib/netlist";
import { compileNetlist } from "../lib/netlist";
import { buildPdkRequestContract, resolvePdkRegistryEntry } from "../lib/pdkRegistry";
import { createDemoDocument } from "../lib/schematic";
import {
  buildCadenceSchematicConvertorRequest,
  parseCadenceConvertorReport,
} from "../lib/schematicConvertor";

test("Cadence schematic convertor request targets a configured backend safely", () => {
  const document = createDemoDocument();
  const request = buildCadenceSchematicConvertorRequest({
    document,
    compiled: compileNetlist(document, "spectre"),
    dialect: "spectre",
    pdkProfile: "smic18mmrf",
    now: new Date("2026-08-22T10:00:00.000Z"),
  });

  assert.equal(request.resource_id, "configured_cadence_backend");
  assert.equal(request.converter_project, "cadence_schematic_convertor");
  assert.equal(request.command_profile.cli, "cschemconv.cli");
  assert.equal(request.command_profile.entrypoint, "closed-loop");
  assert.equal(request.target.pdk_profile, "smic18mmrf");
  assert.equal(request.target.output_view, "schematic");
  assert.ok(request.target.requested_formats.includes("cadence_skill_payload"));
  assert.ok(request.target.requested_formats.includes("cadence_openaccess_cellview"));
  assert.ok(request.target.requested_formats.includes("cadence_openaccess_archive"));
  assert.ok(request.target.requested_formats.includes("cadence_routed_schematic_oa"));
  assert.ok(request.target.requested_formats.includes("schematic_routing_report_json"));
  assert.equal(request.target.routing.owner, "cadence_schematic_convertor_backend");
  assert.equal(request.target.routing.mode, "required");
  assert.equal(request.target.routing.require_real_wire_figures, true);
  assert.equal(request.target.routing.forbid_frontend_synthetic_wires, true);
  assert.equal(request.target.result_policy.visible_schematic_must_be_backend_generated, true);
  assert.equal(request.target.result_policy.reject_demo_seed_or_template_cellviews, true);
  assert.equal(request.target.result_policy.require_output_document_provenance, true);
  assert.deepEqual(request.target.result_policy.required_generators, ["cadence_schematic_convertor_backend"]);
  assert.equal(request.source.document_provenance.can_claim_converted_schematic, false);
  assert.equal(request.expected_artifacts.openaccess_cellview, "openaccess/<library>/<cell>/schematic/sch.oa");
  assert.equal(request.expected_artifacts.openaccess_archive, "openaccess/cadence_openaccess_library.tar.gz");
  assert.equal(request.expected_artifacts.routing_report, "reports/cadence_schematic_routing_report.json");
  assert.equal(request.expected_artifacts.routed_preview, "reports/cadence_routed_schematic_preview.png");
  assert.ok(request.hard_gates.includes("cadence_schematic_routing"));
  assert.ok(request.hard_gates.includes("cadence_routed_wire_connectivity"));
  assert.ok(request.hard_gates.includes("cadence_oa_connectivity"));
  assert.equal(request.security.remote_paths_hidden_in_ui, true);
});

test("Cadence schematic convertor request carries selected PDK contract", () => {
  const document = createDemoDocument();
  const pdk = buildPdkRequestContract(resolvePdkRegistryEntry("tsmc180_tsmc18rf"));
  const request = buildCadenceSchematicConvertorRequest({
    document,
    compiled: compileNetlist(document, "spectre"),
    dialect: "spectre",
    pdkContract: pdk,
    now: new Date("2026-08-22T10:00:00.000Z"),
  });
  const serialized = JSON.stringify(request);

  assert.equal(request.target.pdk_profile, "tsmc180_tsmc18rf");
  assert.equal(request.command_profile.pdk_profile_arg, "tsmc180_tsmc18rf");
  assert.equal(request.target.pdk_contract?.node_nm, 180);
  assert.equal(request.target.pdk_contract?.pdk_paths_backend_only, true);
  assert.doesNotMatch(serialized, /\/home\/|\/opt\/|C:\\|I:\\|192\.168\./);
});

test("Cadence convertor request elides include directives from visible payload", () => {
  const document = createDemoDocument();
  const compiled: CompileResult = {
    ...compileNetlist(document, "spectre"),
    text: "include /home/example-user/pdk/secret.scs\nM1 (a b c d) nch w=1u l=180n",
  };
  const request = buildCadenceSchematicConvertorRequest({
    document,
    compiled,
    dialect: "spectre",
    now: new Date("2026-08-22T10:00:00.000Z"),
  });
  const serialized = JSON.stringify(request);

  assert.match(request.source.netlist_text, /include elided/);
  assert.doesNotMatch(serialized, /\/home\/wq\/pdk/);
  assert.doesNotMatch(serialized, /token|license|password/i);
});

test("Cadence convertor report parser extracts gates and artifact references", () => {
  const summary = parseCadenceConvertorReport({
    closed_loop_report: {
      status: "pass",
      pdk_profile: "smic180_smic18mmrf",
      gates: {
        parse_static_pdk: true,
        cadence_import: true,
        visual_quality: true,
      },
      conversion_report: {
        source_instances: 5,
        cadence_cells_planned: 1,
        cadence_operations_planned: 40,
      },
      cadence_payload: {
        build_plan: "runs/out/cadence/build_plan.json",
        skill: "runs/out/cadence/scripts/build_real_schematic.il",
      },
      cadence_schematic_routing: {
        report: "runs/out/reports/cadence_schematic_routing_report.json",
        preview: "runs/out/reports/cadence_routed_schematic_preview.png",
      },
      cadence_oa_connectivity: {
        path: "runs/out/reports/cadence_oa_connectivity.tsv",
      },
      visual_quality: {
        status: "pass",
        min_graph_probability: 0.993,
        cells: [{ score: 100 }],
      },
      cadence_netlist_export: {
        report: {
          status: "pass",
          path: "runs/out/exported_netlist/cadence_si_exported.cdl",
          device_line_count: 5,
          subckt_count: 1,
        },
      },
    },
  });

  assert.equal(summary.status, "pass");
  assert.equal(summary.pdkProfile, "smic180_smic18mmrf");
  assert.equal(summary.operationsPlanned, 40);
  assert.equal(summary.gates.cadence_import, true);
  assert.equal(summary.visualQuality?.graphProbability, 0.993);
  assert.equal(summary.exportedNetlist?.deviceLineCount, 5);
  assert.equal(summary.artifactRefs.skill_payload, "cadence/scripts/build_real_schematic.il");
  assert.equal(summary.artifactRefs.routing_report, "out/reports/cadence_schematic_routing_report.json");
  assert.equal(summary.artifactRefs.routed_preview, "out/reports/cadence_routed_schematic_preview.png");
});
