export type PdkEvidenceLevel =
  | "cadence_closed_loop_supported"
  | "cadence_closed_loop_supported_with_pdk_warnings"
  | "spectre_runtime_bound"
  | "remote_profile_bound"
  | "registry_profile_only"
  | "server_detected_only";

export type PdkFactStatus = "known" | "estimated" | "runtime_override" | "missing";
export type PdkCalibrationStatus = "known" | "estimated" | "missing" | "runtime_override";
export type PdkLayoutContractStatus = "partial" | "missing";

export interface PdkRegistryEntry {
  id: string;
  label: string;
  family: string;
  nodeNm: number;
  libraryLabel: string;
  cadenceProfile?: string;
  workflowProfile?: string;
  supportStatus: string;
  evidenceLevel: PdkEvidenceLevel;
  factStatus: PdkFactStatus;
  calibrationStatus: PdkCalibrationStatus;
  layoutContractStatus: PdkLayoutContractStatus;
  modelNames: string[];
  capacitorModels: string[];
  resistorModels: string[];
  defaultCorner: string;
  selectable: boolean;
  notes: string[];
}

export interface PdkRequestContract {
  registry_profile: string;
  cadence_profile: string;
  workflow_profile: string;
  process_family: string;
  node_nm: number;
  library: string;
  support_status: string;
  evidence_level: PdkEvidenceLevel;
  fact_status: PdkFactStatus;
  calibration_status: PdkCalibrationStatus;
  layout_contract_status: PdkLayoutContractStatus;
  default_corner: string;
  mos_models: string[];
  capacitor_models: string[];
  resistor_models: string[];
  pdk_paths_backend_only: true;
}

export const DEFAULT_PDK_PROFILE_ID = "smic180_smic18mmrf";

export const PDK_REGISTRY_ENTRIES: PdkRegistryEntry[] = [
  {
    id: "smic180_smic18mmrf",
    label: "SMIC180 MMRF",
    family: "smic180",
    nodeNm: 180,
    libraryLabel: "smic18mmrf",
    cadenceProfile: "smic180_smic18mmrf",
    workflowProfile: "smic180_bcd_105_runtime",
    supportStatus: "closed_loop_pass",
    evidenceLevel: "cadence_closed_loop_supported",
    factStatus: "known",
    calibrationStatus: "known",
    layoutContractStatus: "missing",
    modelNames: ["n18", "p18", "n33", "p33"],
    capacitorModels: ["mim", "mim_ckt"],
    resistorModels: ["analogLib/res"],
    defaultCorner: "tt",
    selectable: true,
    notes: [
      "Cadence converter evidence matrix passed on the configured backend.",
      "Layout and PEX evidence are still separate signoff gates.",
    ],
  },
  {
    id: "tsmc180_tsmc18rf",
    label: "TSMC180 RF",
    family: "tsmc180",
    nodeNm: 180,
    libraryLabel: "tsmc18rf",
    cadenceProfile: "tsmc180_tsmc18rf",
    workflowProfile: "tsmc180",
    supportStatus: "closed_loop_pass",
    evidenceLevel: "cadence_closed_loop_supported",
    factStatus: "known",
    calibrationStatus: "estimated",
    layoutContractStatus: "missing",
    modelNames: ["nmos2v", "pmos2v", "nmos3v", "pmos3v"],
    capacitorModels: ["mimcap", "momcap"],
    resistorModels: ["rphpoly"],
    defaultCorner: "tt",
    selectable: true,
    notes: [
      "Cadence converter evidence matrix passed on the configured backend.",
      "Circuit calibration should be refreshed before strict performance claims.",
    ],
  },
  {
    id: "gpdk090",
    label: "Cadence GPDK090",
    family: "gpdk090",
    nodeNm: 90,
    libraryLabel: "gpdk090",
    cadenceProfile: "gpdk090",
    workflowProfile: "gpdk090",
    supportStatus: "closed_loop_pass_with_pdk_warnings",
    evidenceLevel: "cadence_closed_loop_supported_with_pdk_warnings",
    factStatus: "known",
    calibrationStatus: "estimated",
    layoutContractStatus: "missing",
    modelNames: ["nmos1v", "pmos1v", "nmos2v", "pmos2v"],
    capacitorModels: ["cap"],
    resistorModels: ["res"],
    defaultCorner: "tt",
    selectable: true,
    notes: [
      "Cadence converter evidence matrix passed with waived PDK CDF warnings.",
      "Use for schematic flow regression, not industrial signoff.",
    ],
  },
  {
    id: "smic18_8_109",
    label: "SMIC180 8.109",
    family: "smic180",
    nodeNm: 180,
    libraryLabel: "smic18mmrf",
    cadenceProfile: "smic180_smic18mmrf",
    workflowProfile: "smic18_8_109",
    supportStatus: "spectre_runtime_bound",
    evidenceLevel: "spectre_runtime_bound",
    factStatus: "known",
    calibrationStatus: "missing",
    layoutContractStatus: "missing",
    modelNames: ["n18", "p18", "n33", "p33"],
    capacitorModels: ["mim"],
    resistorModels: ["res"],
    defaultCorner: "tt",
    selectable: true,
    notes: [
      "Spectre host exposes a private runtime profile.",
      "Cadence conversion uses the configured SMIC180 mapping when requested.",
    ],
  },
  {
    id: "tsmc22_ulp",
    label: "TSMC22 ULP",
    family: "tsmc22ulp",
    nodeNm: 22,
    libraryLabel: "tsmc22_ulp",
    workflowProfile: "tsmc22_ulp",
    supportStatus: "remote_profile_bound",
    evidenceLevel: "remote_profile_bound",
    factStatus: "known",
    calibrationStatus: "missing",
    layoutContractStatus: "partial",
    modelNames: ["nch_mac", "pch_mac", "nch_18_mac", "pch_18_mac"],
    capacitorModels: ["cfmom_2t", "cfmom_mx_4t", "nmoscap", "pmoscap"],
    resistorModels: ["rupoly", "rupolym", "rm1s"],
    defaultCorner: "top_tt",
    selectable: true,
    notes: [
      "A private SPEG runtime profile is configured.",
      "PVT, mismatch, and PEX calibration are still pending gates.",
    ],
  },
  {
    id: "smic40llrf_109",
    label: "SMIC40 LLRF",
    family: "smic40",
    nodeNm: 40,
    libraryLabel: "smic40llrf",
    workflowProfile: "smic40llrf_109",
    supportStatus: "server_detected_only",
    evidenceLevel: "server_detected_only",
    factStatus: "missing",
    calibrationStatus: "missing",
    layoutContractStatus: "missing",
    modelNames: [],
    capacitorModels: [],
    resistorModels: [],
    defaultCorner: "tt",
    selectable: false,
    notes: [
      "A private foundry profile was detected by the backend.",
      "A SPEG PDK profile and Cadence converter map are still required before use.",
    ],
  },
  {
    id: "smic13mmrf_109",
    label: "SMIC130 MMRF",
    family: "smic130",
    nodeNm: 130,
    libraryLabel: "smic13mmrf",
    workflowProfile: "smic13mmrf_109",
    supportStatus: "server_detected_only",
    evidenceLevel: "server_detected_only",
    factStatus: "missing",
    calibrationStatus: "missing",
    layoutContractStatus: "missing",
    modelNames: [],
    capacitorModels: [],
    resistorModels: [],
    defaultCorner: "tt",
    selectable: false,
    notes: [
      "A private foundry profile was detected by the backend.",
      "A SPEG PDK profile and Cadence converter map are still required before use.",
    ],
  },
  {
    id: "hb180ejl2_5v",
    label: "HB180 5V",
    family: "hb180",
    nodeNm: 180,
    libraryLabel: "hb180ejl2",
    workflowProfile: "hb180ejl2_5v",
    supportStatus: "registry_profile_only",
    evidenceLevel: "registry_profile_only",
    factStatus: "estimated",
    calibrationStatus: "estimated",
    layoutContractStatus: "missing",
    modelNames: ["n18", "p18", "n50", "p50"],
    capacitorModels: ["mimcap"],
    resistorModels: ["rpoly"],
    defaultCorner: "tt",
    selectable: true,
    notes: [
      "Configured as a SPEG registry profile; remote path discovery is still pending.",
    ],
  },
  {
    id: "smic180_bcd",
    label: "SMIC180 BCD",
    family: "smic180",
    nodeNm: 180,
    libraryLabel: "smic180_bcd",
    cadenceProfile: "smic180_smic18mmrf",
    workflowProfile: "smic180_bcd",
    supportStatus: "registry_profile_only",
    evidenceLevel: "registry_profile_only",
    factStatus: "known",
    calibrationStatus: "known",
    layoutContractStatus: "missing",
    modelNames: ["n18", "p18", "n33", "p33"],
    capacitorModels: ["mim_ckt", "rnpo_ckt"],
    resistorModels: ["rndif_ckt", "rhrpo_ckt"],
    defaultCorner: "tt",
    selectable: true,
    notes: [
      "SPEG registry compatibility profile.",
      "Use a runtime-bound profile for real server execution.",
    ],
  },
  {
    id: "tsmc28",
    label: "TSMC28",
    family: "tsmc28",
    nodeNm: 28,
    libraryLabel: "tsmc28",
    workflowProfile: "tsmc28",
    supportStatus: "registry_profile_only",
    evidenceLevel: "registry_profile_only",
    factStatus: "estimated",
    calibrationStatus: "estimated",
    layoutContractStatus: "missing",
    modelNames: ["nch", "pch", "nch_io", "pch_io"],
    capacitorModels: ["mimcap", "momcap"],
    resistorModels: ["rpoly", "rhigh"],
    defaultCorner: "tt",
    selectable: true,
    notes: [
      "Tracked example profile for 28nm bring-up.",
      "Requires private model binding before transistor signoff.",
    ],
  },
  {
    id: "tsmc28_35_runtime",
    label: "TSMC28 35 Runtime",
    family: "tsmc28",
    nodeNm: 28,
    libraryLabel: "tsmc28_35",
    workflowProfile: "tsmc28_35_runtime",
    supportStatus: "registry_profile_only",
    evidenceLevel: "registry_profile_only",
    factStatus: "estimated",
    calibrationStatus: "missing",
    layoutContractStatus: "missing",
    modelNames: ["nch", "pch", "nch_io", "pch_io"],
    capacitorModels: ["mimcap", "momcap"],
    resistorModels: ["rpoly", "rhigh"],
    defaultCorner: "tt",
    selectable: true,
    notes: [
      "Runtime example profile for a 35-server 28nm PDK root.",
      "Private model library binding is required before real simulation.",
    ],
  },
  {
    id: "tsmc40rf_35_runtime",
    label: "TSMC40 RF 35 Runtime",
    family: "tsmc40",
    nodeNm: 40,
    libraryLabel: "tsmc40rf",
    workflowProfile: "tsmc40rf_35_runtime",
    supportStatus: "registry_profile_only",
    evidenceLevel: "registry_profile_only",
    factStatus: "estimated",
    calibrationStatus: "missing",
    layoutContractStatus: "missing",
    modelNames: ["nch", "pch", "nch_18", "pch_18"],
    capacitorModels: ["mimcap", "momcap"],
    resistorModels: ["rpoly", "rhigh"],
    defaultCorner: "tt",
    selectable: true,
    notes: [
      "Runtime example profile for a 35-server 40nm PDK root.",
      "Private model library binding is required before real simulation.",
    ],
  },
  {
    id: "tsmc65",
    label: "TSMC65",
    family: "tsmc65",
    nodeNm: 65,
    libraryLabel: "tsmc65",
    workflowProfile: "tsmc65",
    supportStatus: "registry_profile_only",
    evidenceLevel: "registry_profile_only",
    factStatus: "estimated",
    calibrationStatus: "estimated",
    layoutContractStatus: "missing",
    modelNames: ["nch_mac", "pch_mac", "nch_18_mac", "pch_18_mac"],
    capacitorModels: ["mimcap", "momcap"],
    resistorModels: ["rpoly", "rhigh"],
    defaultCorner: "tt",
    selectable: true,
    notes: [
      "Tracked example profile for 65nm support.",
      "Requires private model binding before transistor signoff.",
    ],
  },
  {
    id: "tsmc180",
    label: "TSMC180",
    family: "tsmc180",
    nodeNm: 180,
    libraryLabel: "tsmc180",
    cadenceProfile: "tsmc180_tsmc18rf",
    workflowProfile: "tsmc180",
    supportStatus: "registry_profile_only",
    evidenceLevel: "registry_profile_only",
    factStatus: "estimated",
    calibrationStatus: "estimated",
    layoutContractStatus: "missing",
    modelNames: ["nch", "pch", "nch_33", "pch_33"],
    capacitorModels: ["mimcap", "momcap"],
    resistorModels: ["rpoly", "rhigh"],
    defaultCorner: "tt",
    selectable: true,
    notes: [
      "SPEG registry compatibility profile.",
      "The configured backend uses the tsmc180_tsmc18rf Cadence converter profile.",
    ],
  },
];

export function selectablePdkEntries(entries = PDK_REGISTRY_ENTRIES): PdkRegistryEntry[] {
  return entries.filter((entry) => entry.selectable);
}

export function cadenceReadyPdkEntries(entries = PDK_REGISTRY_ENTRIES): PdkRegistryEntry[] {
  return entries.filter((entry) => entry.evidenceLevel.startsWith("cadence_closed_loop_supported"));
}

export function pdkRegistrySummary(entries = PDK_REGISTRY_ENTRIES) {
  return {
    total: entries.length,
    selectable: selectablePdkEntries(entries).length,
    cadenceClosedLoop: cadenceReadyPdkEntries(entries).length,
    remoteDetected: entries.filter((entry) =>
      entry.evidenceLevel === "spectre_runtime_bound"
      || entry.evidenceLevel === "remote_profile_bound"
      || entry.evidenceLevel === "server_detected_only"
    ).length,
  };
}

export function resolvePdkRegistryEntry(id: string): PdkRegistryEntry {
  return PDK_REGISTRY_ENTRIES.find((entry) => entry.id === id)
    ?? PDK_REGISTRY_ENTRIES.find((entry) => entry.id === DEFAULT_PDK_PROFILE_ID)
    ?? PDK_REGISTRY_ENTRIES[0];
}

export function pdkStatusLabel(entry: PdkRegistryEntry): string {
  if (entry.evidenceLevel === "cadence_closed_loop_supported") return "Cadence通过";
  if (entry.evidenceLevel === "cadence_closed_loop_supported_with_pdk_warnings") return "Cadence警告";
  if (entry.evidenceLevel === "spectre_runtime_bound") return "Spectre绑定";
  if (entry.evidenceLevel === "remote_profile_bound") return "远端绑定";
  if (entry.evidenceLevel === "server_detected_only") return "仅发现";
  return "待绑定";
}

export function buildPdkRequestContract(entry: PdkRegistryEntry): PdkRequestContract {
  return {
    registry_profile: entry.id,
    cadence_profile: entry.cadenceProfile ?? entry.id,
    workflow_profile: entry.workflowProfile ?? entry.id,
    process_family: entry.family,
    node_nm: entry.nodeNm,
    library: entry.libraryLabel,
    support_status: entry.supportStatus,
    evidence_level: entry.evidenceLevel,
    fact_status: entry.factStatus,
    calibration_status: entry.calibrationStatus,
    layout_contract_status: entry.layoutContractStatus,
    default_corner: entry.defaultCorner,
    mos_models: entry.modelNames,
    capacitor_models: entry.capacitorModels,
    resistor_models: entry.resistorModels,
    pdk_paths_backend_only: true,
  };
}
