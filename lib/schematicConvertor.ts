import type { CompileResult, NetlistDialect } from "./netlist";
import type { PdkRequestContract } from "./pdkRegistry";
import { getDeviceDefinition, type SchematicDocument } from "./schematic";
import { inspectSchematicProvenance, type SchematicProvenanceKind } from "./schematicProvenance";

export type CadenceConvertorResourceId = "configured_cadence_backend";
export type CadenceConvertorMode = "closed_loop" | "convert_only";

export interface CadenceSchematicConvertorRequest {
  schema: "analog_studio.cadence_schematic_convertor_request.v1";
  job_id: string;
  created_at: string;
  resource_id: CadenceConvertorResourceId;
  converter_project: "cadence_schematic_convertor";
  mode: CadenceConvertorMode;
  source: {
    input_kind: "analog_studio_compiled_netlist";
    dialect: NetlistDialect;
    top_cell: string;
    source_library: string;
    netlist_text: string;
    erc_issue_count: number;
    document_profile: "VSE-Core-1";
    instance_count: number;
    net_count: number;
    document_provenance: {
      kind: SchematicProvenanceKind;
      label: string;
      can_claim_converted_schematic: boolean;
      reasons: string[];
    };
  };
  target: {
    pdk_profile: string;
    pdk_contract?: PdkRequestContract;
    output_library: string;
    output_view: "schematic";
    requested_formats: Array<
      | "schematic_plan_json"
      | "analog_studio_hierarchical_schematic_json"
      | "cadence_build_plan_json"
      | "cadence_skill_payload"
      | "oa_connectivity_report"
      | "cadence_si_exported_cdl"
      | "cadence_openaccess_cellview"
      | "cadence_openaccess_archive"
      | "cadence_routed_schematic_oa"
      | "schematic_routing_report_json"
    >;
    routing: {
      owner: "cadence_schematic_convertor_backend";
      mode: "required";
      strategy: "cadence_schematic_wire_routing";
      require_real_wire_figures: true;
      forbid_frontend_synthetic_wires: true;
      net_label_stubs_allowed_only_for_external_ports: true;
      min_routed_net_ratio: 0.98;
    };
    result_policy: {
      visible_schematic_must_be_backend_generated: true;
      reject_demo_seed_or_template_cellviews: true;
      require_output_document_provenance: true;
      required_generators: ["cadence_schematic_convertor_backend"];
      converted_view_must_not_reuse_source_seed_cellview: true;
    };
  };
  command_profile: {
    cli: "cschemconv.cli";
    entrypoint: "closed-loop" | "convert";
    top_arg: string;
    pdk_profile_arg: string;
    lib_arg: string;
  };
  expected_artifacts: {
    schematic_plan: "cadence/schematic_plan.json";
    analog_studio_hierarchy: "analog_studio/hierarchical_schematic.json";
    build_plan: "cadence/build_plan.json";
    skill_payload: "cadence/scripts/build_real_schematic.il";
    oa_connectivity: "reports/cadence_oa_connectivity.tsv";
    closed_loop_report: "reports/closed_loop_report.json";
    cadence_cdl: "exported_netlist/cadence_si_exported.cdl";
    openaccess_cellview: "openaccess/<library>/<cell>/schematic/sch.oa";
    openaccess_archive: "openaccess/cadence_openaccess_library.tar.gz";
    routing_report: "reports/cadence_schematic_routing_report.json";
    routed_preview: "reports/cadence_routed_schematic_preview.png";
  };
  hard_gates: string[];
  security: {
    frontend_payload_contains_secret: false;
    remote_paths_hidden_in_ui: true;
    pdk_paths_backend_only: true;
  };
}

export interface CadenceConvertorReportSummary {
  status: "pass" | "fail" | "blocked" | "unknown";
  pdkProfile?: string;
  sourceInstances?: number;
  cadenceCellsPlanned?: number;
  operationsPlanned?: number;
  gates: Record<string, boolean>;
  visualQuality?: {
    status: "pass" | "fail" | "blocked" | "unknown";
    score?: number;
    graphProbability?: number;
  };
  exportedNetlist?: {
    status: "pass" | "fail" | "blocked" | "unknown";
    deviceLineCount?: number;
    subcktCount?: number;
  };
  artifactRefs: Record<string, string>;
  errors: string[];
  warnings: string[];
}

function hashText(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function cleanIdentifier(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const replaced = trimmed.replace(/[^A-Za-z0-9_]/g, "_");
  return (/^[A-Za-z_]/.test(replaced) ? replaced : `_${replaced}`).slice(0, 64);
}

function stripSensitiveDirectives(netlist: string): string {
  return netlist
    .split(/\r?\n/)
    .map((line) => (/^\s*(\.?include|\.?lib|ahdl_include)\b/i.test(line)
      ? `* ${line.trim().split(/\s+/)[0]} elided: backend resolves PDK/resources by profile`
      : line))
    .join("\n");
}

function reportStatus(value: unknown): "pass" | "fail" | "blocked" | "unknown" {
  if (value === "pass" || value === true) return "pass";
  if (value === "fail" || value === false) return "fail";
  if (value === "blocked") return "blocked";
  return "unknown";
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : undefined;
}

function artifactRef(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const normalized = value.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).slice(-3).join("/");
}

export function buildCadenceSchematicConvertorRequest(options: {
  document: SchematicDocument;
  compiled: CompileResult;
  dialect: NetlistDialect;
  mode?: CadenceConvertorMode;
  pdkProfile?: string;
  pdkContract?: PdkRequestContract;
  now?: Date;
}): CadenceSchematicConvertorRequest {
  const createdAt = (options.now ?? new Date()).toISOString();
  const safeTop = cleanIdentifier(options.document.cell, "TOP");
  const safeLib = cleanIdentifier(options.document.library || options.document.project, "AI_GEN_LIB");
  const hash = hashText(`${safeTop}\n${options.dialect}\n${options.compiled.text}`);
  const pdkProfile = options.pdkProfile
    ?? options.pdkContract?.cadence_profile
    ?? "smic180_smic18mmrf";
  const provenance = inspectSchematicProvenance(options.document);
  return {
    schema: "analog_studio.cadence_schematic_convertor_request.v1",
    job_id: `cschem_${hash}_${createdAt.replace(/[-:.TZ]/g, "").slice(0, 14)}`,
    created_at: createdAt,
    resource_id: "configured_cadence_backend",
    converter_project: "cadence_schematic_convertor",
    mode: options.mode ?? "closed_loop",
    source: {
      input_kind: "analog_studio_compiled_netlist",
      dialect: options.dialect,
      top_cell: safeTop,
      source_library: safeLib,
      netlist_text: stripSensitiveDirectives(options.compiled.text),
      erc_issue_count: options.compiled.issues.length,
      document_profile: options.document.editorProfile,
      instance_count: options.document.nodes.filter((node) => getDeviceDefinition(node.kind).netlistable).length,
      net_count: options.compiled.nets.length,
      document_provenance: {
        kind: provenance.kind,
        label: provenance.label,
        can_claim_converted_schematic: provenance.canClaimConvertedSchematic,
        reasons: provenance.reasons,
      },
    },
    target: {
      pdk_profile: pdkProfile,
      ...(options.pdkContract ? { pdk_contract: options.pdkContract } : {}),
      output_library: safeLib,
      output_view: "schematic",
      requested_formats: [
        "schematic_plan_json",
        "analog_studio_hierarchical_schematic_json",
        "cadence_build_plan_json",
        "cadence_skill_payload",
        "oa_connectivity_report",
        "cadence_si_exported_cdl",
        "cadence_openaccess_cellview",
        "cadence_openaccess_archive",
        "cadence_routed_schematic_oa",
        "schematic_routing_report_json",
      ],
      routing: {
        owner: "cadence_schematic_convertor_backend",
        mode: "required",
        strategy: "cadence_schematic_wire_routing",
        require_real_wire_figures: true,
        forbid_frontend_synthetic_wires: true,
        net_label_stubs_allowed_only_for_external_ports: true,
        min_routed_net_ratio: 0.98,
      },
      result_policy: {
        visible_schematic_must_be_backend_generated: true,
        reject_demo_seed_or_template_cellviews: true,
        require_output_document_provenance: true,
        required_generators: ["cadence_schematic_convertor_backend"],
        converted_view_must_not_reuse_source_seed_cellview: true,
      },
    },
    command_profile: {
      cli: "cschemconv.cli",
      entrypoint: options.mode === "convert_only" ? "convert" : "closed-loop",
      top_arg: safeTop,
      pdk_profile_arg: pdkProfile,
      lib_arg: safeLib,
    },
    expected_artifacts: {
      schematic_plan: "cadence/schematic_plan.json",
      analog_studio_hierarchy: "analog_studio/hierarchical_schematic.json",
      build_plan: "cadence/build_plan.json",
      skill_payload: "cadence/scripts/build_real_schematic.il",
      oa_connectivity: "reports/cadence_oa_connectivity.tsv",
      closed_loop_report: "reports/closed_loop_report.json",
      cadence_cdl: "exported_netlist/cadence_si_exported.cdl",
      openaccess_cellview: "openaccess/<library>/<cell>/schematic/sch.oa",
      openaccess_archive: "openaccess/cadence_openaccess_library.tar.gz",
      routing_report: "reports/cadence_schematic_routing_report.json",
      routed_preview: "reports/cadence_routed_schematic_preview.png",
    },
    hard_gates: [
      "parse_static_pdk",
      "pdk_contract",
      "build_plan_equivalence",
      "cadence_payload",
      "cadence_schematic_routing",
      "cadence_import",
      "cadence_routed_wire_connectivity",
      "cadence_oa_connectivity",
      "cadence_netlist_export",
      "exported_netlist_equivalence",
      "visual_quality",
    ],
    security: {
      frontend_payload_contains_secret: false,
      remote_paths_hidden_in_ui: true,
      pdk_paths_backend_only: true,
    },
  };
}

export function parseCadenceConvertorReport(input: unknown): CadenceConvertorReportSummary {
  const parsed = typeof input === "string" ? JSON.parse(input) as unknown : input;
  const root = readRecord(parsed);
  const report = readRecord(root.closed_loop_report ?? root);
  const conversion = readRecord(report.conversion_report);
  const visual = readRecord(report.visual_quality);
  const exportBlock = readRecord(report.cadence_netlist_export);
  const exportReport = readRecord(exportBlock.report ?? exportBlock);
  const artifactCandidates = {
    schematic_plan: readRecord(report.cadence_payload).build_plan,
    skill_payload: readRecord(report.cadence_payload).skill,
    routing_report: readRecord(report.cadence_schematic_routing).report,
    routed_preview: readRecord(report.cadence_schematic_routing).preview,
    oa_connectivity: readRecord(report.cadence_oa_connectivity).path,
    cadence_cdl: exportReport.path,
    closed_loop_report: report.project,
  };
  const artifactRefs = Object.fromEntries(
    Object.entries(artifactCandidates)
      .flatMap(([key, value]) => {
        const ref = artifactRef(value);
        return ref ? [[key, ref]] : [];
      }),
  );
  return {
    status: reportStatus(report.status),
    pdkProfile: typeof report.pdk_profile === "string"
      ? report.pdk_profile
      : typeof conversion.pdk_profile === "string"
        ? conversion.pdk_profile
        : undefined,
    sourceInstances: readNumber(conversion.source_instances),
    cadenceCellsPlanned: readNumber(conversion.cadence_cells_planned),
    operationsPlanned: readNumber(conversion.cadence_operations_planned),
    gates: Object.fromEntries(Object.entries(readRecord(report.gates)).map(([key, value]) => [key, value === true])),
    visualQuality: {
      status: reportStatus(visual.status),
      score: readNumber(readRecord((visual.cells as unknown[])?.[0]).score),
      graphProbability: readNumber(visual.min_graph_probability),
    },
    exportedNetlist: {
      status: reportStatus(exportReport.status),
      deviceLineCount: readNumber(exportReport.device_line_count),
      subcktCount: readNumber(exportReport.subckt_count),
    },
    artifactRefs,
    errors: [
      ...((conversion.errors as unknown[]) ?? []),
      ...((report.errors as unknown[]) ?? []),
    ].map(String),
    warnings: [
      ...((conversion.warnings as unknown[]) ?? []),
      ...((report.warnings as unknown[]) ?? []),
    ].map(String),
  };
}
