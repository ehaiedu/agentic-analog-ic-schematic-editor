export interface WaveformSample {
  x: number;
  y: number;
}

export interface WaveformTrace {
  name: string;
  xUnit?: string;
  yUnit?: string;
  color?: string;
  renderStyle?: "line" | "step" | "stem";
  points: WaveformSample[];
}

export type WaveformPanelKind =
  | "imported"
  | "sar_transient"
  | "fft_sndr_sfdr"
  | "linearity"
  | "power_tradeoff"
  | "comparator_regen"
  | "comparator_delay_sweep"
  | "comparator_offset"
  | "cdac_settling"
  | "ota_ac_bode"
  | "ota_step_settling"
  | "ota_slew"
  | "ota_gain_power";

export type CircuitMetricFlavor = "sar_adc" | "comparator" | "ota";

export type OptimizationMetricKey =
  | "enob"
  | "sndrDb"
  | "sfdrDb"
  | "powerUw"
  | "delayPs"
  | "offsetMv"
  | "outputSwingV"
  | "gainDb"
  | "ugbwMhz"
  | "phaseMarginDeg"
  | "slewVus"
  | "settlingNs";

export interface CircuitMetricColumn {
  key: OptimizationMetricKey;
  label: string;
  unit: string;
  digits: number;
  lowerIsBetter?: boolean;
}

export interface CircuitMetricProfile {
  flavor: CircuitMetricFlavor;
  label: string;
  familyLabel: string;
  columns: CircuitMetricColumn[];
}

export interface WaveformPanel {
  id: string;
  label: string;
  kind: WaveformPanelKind;
  description: string;
  xLabel: string;
  yLabel: string;
  imageUrl?: string;
  traces: WaveformTrace[];
}

export interface OptimizationRoundMetric {
  round: number;
  candidateId?: string;
  status?: string;
  cornerId?: string;
  process?: string;
  temperatureC?: number;
  vddScale?: number;
  metricSourceFile?: string;
  promptSource?: string;
  promptVersion?: number | string;
  signoffLevel?: string;
  enob?: number;
  sndrDb?: number;
  sfdrDb?: number;
  powerUw?: number;
  validEdgeCount?: number;
  uniqueCodeCount?: number;
  codeTransitionCount?: number;
  missingCodeCount?: number;
  inlLsbP2p?: number;
  dnlLsbP2p?: number;
  bitActivitySampleCount?: number;
  bitActivityDistinctCodeCount?: number;
  doutActivityObserved?: boolean;
  comparatorActivityObserved?: boolean;
  phaseActivityObserved?: boolean;
  stateStorageObserved?: boolean;
  spSnActivityObserved?: boolean;
  negativeControlPassed?: boolean;
  transistorClosedLoopPassed?: boolean;
  loopClaimLevel?: string;
  delayPs?: number;
  offsetMv?: number;
  outputSwingV?: number;
  gainDb?: number;
  ugbwMhz?: number;
  phaseMarginDeg?: number;
  slewVus?: number;
  settlingNs?: number;
  specPassed: boolean;
  failureSignature?: string;
  notes: string[];
  waveformManifestPath?: string;
  waveformCsvPath?: string;
  waveformSource?: string;
  waveformArtifactStatus?: "available" | "missing_csv" | "missing_manifest" | "pending" | "unavailable";
  waveformImageUrl?: string;
  suppressGeneratedWaveforms?: boolean;
  waveforms: WaveformTrace[];
}

export const OPTIMIZATION_METRICS_EXTENSION_KEY = "optimizationMetrics";

function compareMetricText(left: string, right: string): number {
  return left.localeCompare(right, "en", { numeric: true, sensitivity: "base" });
}

export interface OptimizationMetricsExtension {
  schema: "analog_studio.optimization_metrics.v1";
  sourceLabel?: string;
  artifactBacked?: boolean;
  importedAt?: string;
  metrics: OptimizationRoundMetric[];
}

export interface OptimizationMetricRow extends OptimizationRoundMetric {
  deltaFromInitial: {
    enob?: number;
    sndrDb?: number;
    sfdrDb?: number;
    powerUw?: number;
    delayPs?: number;
    offsetMv?: number;
    outputSwingV?: number;
    gainDb?: number;
    ugbwMhz?: number;
    phaseMarginDeg?: number;
    slewVus?: number;
    settlingNs?: number;
  };
  deltaFromPrevious: {
    enob?: number;
    sndrDb?: number;
    sfdrDb?: number;
    powerUw?: number;
    delayPs?: number;
    offsetMv?: number;
    outputSwingV?: number;
    gainDb?: number;
    ugbwMhz?: number;
    phaseMarginDeg?: number;
    slewVus?: number;
    settlingNs?: number;
  };
  tradeoff: string;
}

export interface OptimizationMetricSummary {
  rows: OptimizationMetricRow[];
  best: {
    enob?: OptimizationRoundMetric;
    sndrDb?: OptimizationRoundMetric;
    sfdrDb?: OptimizationRoundMetric;
    powerUw?: OptimizationRoundMetric;
    delayPs?: OptimizationRoundMetric;
    offsetMv?: OptimizationRoundMetric;
    outputSwingV?: OptimizationRoundMetric;
    gainDb?: OptimizationRoundMetric;
    ugbwMhz?: OptimizationRoundMetric;
    phaseMarginDeg?: OptimizationRoundMetric;
    slewVus?: OptimizationRoundMetric;
    settlingNs?: OptimizationRoundMetric;
  };
  latest?: OptimizationRoundMetric;
  initial?: OptimizationRoundMetric;
  improvementText: string;
  tradeoffs: string[];
}

export interface PvtMetricRow {
  id: string;
  round: number;
  label: string;
  process?: string;
  temperatureC?: number;
  vddScale?: number;
  status?: string;
  specPassed: boolean;
  metricSourceFile?: string;
  sourceMetric: OptimizationRoundMetric;
}

export interface PvtMetricWorst {
  column: CircuitMetricColumn;
  row: PvtMetricRow;
  value: number;
}

export interface PvtMetricMatrixSummary {
  mode: "pvt" | "nominal" | "pending";
  rows: PvtMetricRow[];
  columns: CircuitMetricColumn[];
  passCount: number;
  totalCount: number;
  processes: string[];
  temperatures: number[];
  vddScales: number[];
  worst: PvtMetricWorst[];
  title: string;
  subtitle: string;
}

export const DEMO_OPTIMIZATION_METRICS: OptimizationRoundMetric[] = [
  {
    round: 0,
    candidateId: "seed",
    enob: 7.42,
    sndrDb: 46.5,
    sfdrDb: 55.1,
    powerUw: 1380,
    specPassed: false,
    failureSignature: "low_sndr_high_power",
    notes: ["示例数据：等待后端 per_round_metrics.json 后替换"],
    waveforms: [],
  },
  {
    round: 1,
    candidateId: "repair_size_bias",
    enob: 8.06,
    sndrDb: 50.3,
    sfdrDb: 59.4,
    powerUw: 1510,
    specPassed: false,
    failureSignature: "sndr_improved_power_up",
    notes: ["增大输入对与比较器偏置，速度改善但功耗上升"],
    waveforms: [],
  },
  {
    round: 2,
    candidateId: "cdac_switch_balance",
    enob: 8.71,
    sndrDb: 54.2,
    sfdrDb: 63.8,
    powerUw: 1435,
    specPassed: false,
    failureSignature: "sfdr_margin_missing",
    notes: ["调整 CDAC unit cap 和采样开关尺寸，线性度改善"],
    waveforms: [],
  },
  {
    round: 3,
    candidateId: "comparator_offset_repair",
    enob: 9.18,
    sndrDb: 57.1,
    sfdrDb: 67.6,
    powerUw: 1492,
    specPassed: true,
    failureSignature: "",
    notes: ["比较器再生时间与 offset trade-off 收敛"],
    waveforms: [],
  },
];

export const DEMO_COMPARATOR_OPTIMIZATION_METRICS: OptimizationRoundMetric[] = [
  {
    round: 0,
    candidateId: "legacy_seed_strongarm",
    delayPs: 184,
    offsetMv: 16.2,
    outputSwingV: 1.42,
    powerUw: 392,
    specPassed: false,
    failureSignature: "slow_regen_high_offset",
    notes: ["StrongARM legacy seed：延迟和 offset 还未满足 SAR 前端要求"],
    waveforms: [],
  },
  {
    round: 1,
    candidateId: "tail_input_resize",
    delayPs: 127,
    offsetMv: 9.8,
    outputSwingV: 1.61,
    powerUw: 486,
    specPassed: false,
    failureSignature: "delay_improved_power_up",
    notes: ["增大输入对和 tail 管，降低再生时间但功耗上升"],
    waveforms: [],
  },
  {
    round: 2,
    candidateId: "latch_ratio_balance",
    delayPs: 96,
    offsetMv: 6.1,
    outputSwingV: 1.69,
    powerUw: 468,
    specPassed: false,
    failureSignature: "offset_margin_missing",
    notes: ["调整交叉耦合锁存比例，swing 和 delay 改善"],
    waveforms: [],
  },
  {
    round: 3,
    candidateId: "offset_regen_closed",
    delayPs: 78,
    offsetMv: 3.4,
    outputSwingV: 1.73,
    powerUw: 496,
    specPassed: true,
    failureSignature: "",
    notes: ["比较器 delay/offset/swing 在 nominal 示例口径下收敛"],
    waveforms: [],
  },
];

export const DEMO_OTA_OPTIMIZATION_METRICS: OptimizationRoundMetric[] = [
  {
    round: 0,
    candidateId: "5t_ota_seed",
    gainDb: 47.8,
    ugbwMhz: 12.4,
    phaseMarginDeg: 43.0,
    slewVus: 9.8,
    settlingNs: 92,
    powerUw: 612,
    specPassed: false,
    failureSignature: "low_gain_low_pm",
    notes: ["5T OTA seed：增益和相位裕度不足"],
    waveforms: [],
  },
  {
    round: 1,
    candidateId: "load_length_bias",
    gainDb: 58.6,
    ugbwMhz: 10.9,
    phaseMarginDeg: 55.2,
    slewVus: 10.7,
    settlingNs: 86,
    powerUw: 668,
    specPassed: false,
    failureSignature: "gain_improved_bandwidth_down",
    notes: ["拉长负载管提升 ro 和 gain，但 UGBW 回退"],
    waveforms: [],
  },
  {
    round: 2,
    candidateId: "gm_compensation_tradeoff",
    gainDb: 64.5,
    ugbwMhz: 18.2,
    phaseMarginDeg: 61.5,
    slewVus: 15.6,
    settlingNs: 58,
    powerUw: 742,
    specPassed: false,
    failureSignature: "settling_margin_missing",
    notes: ["提高 gm 并调整补偿，带宽和相位裕度改善但功耗增加"],
    waveforms: [],
  },
  {
    round: 3,
    candidateId: "ota_nominal_closed",
    gainDb: 68.7,
    ugbwMhz: 22.8,
    phaseMarginDeg: 67.4,
    slewVus: 19.1,
    settlingNs: 41,
    powerUw: 721,
    specPassed: true,
    failureSignature: "",
    notes: ["OTA gain/UGBW/PM/settling 在 nominal 示例口径下收敛"],
    waveforms: [],
  },
];

export const CIRCUIT_METRIC_PROFILES: Record<CircuitMetricFlavor, CircuitMetricProfile> = {
  sar_adc: {
    flavor: "sar_adc",
    label: "ADC 指标口径",
    familyLabel: "SAR ADC",
    columns: [
      { key: "enob", label: "ENOB", unit: "bit", digits: 2 },
      { key: "sndrDb", label: "SNDR", unit: "dB", digits: 2 },
      { key: "sfdrDb", label: "SFDR", unit: "dB", digits: 2 },
      { key: "powerUw", label: "Power", unit: "uW", digits: 0, lowerIsBetter: true },
    ],
  },
  comparator: {
    flavor: "comparator",
    label: "比较器指标口径",
    familyLabel: "Comparator",
    columns: [
      { key: "delayPs", label: "Delay", unit: "ps", digits: 0, lowerIsBetter: true },
      { key: "offsetMv", label: "Offset", unit: "mV", digits: 1, lowerIsBetter: true },
      { key: "outputSwingV", label: "Swing", unit: "V", digits: 2 },
      { key: "powerUw", label: "Power", unit: "uW", digits: 0, lowerIsBetter: true },
    ],
  },
  ota: {
    flavor: "ota",
    label: "OTA/运放指标口径",
    familyLabel: "OTA",
    columns: [
      { key: "gainDb", label: "Gain", unit: "dB", digits: 1 },
      { key: "ugbwMhz", label: "UGBW", unit: "MHz", digits: 1 },
      { key: "phaseMarginDeg", label: "PM", unit: "deg", digits: 1 },
      { key: "settlingNs", label: "Settling", unit: "ns", digits: 0, lowerIsBetter: true },
      { key: "powerUw", label: "Power", unit: "uW", digits: 0, lowerIsBetter: true },
    ],
  },
};

export function metricProfileForFlavor(flavor: CircuitMetricFlavor): CircuitMetricProfile {
  return CIRCUIT_METRIC_PROFILES[flavor];
}

export function defaultOptimizationMetricsForFlavor(flavor: CircuitMetricFlavor): OptimizationRoundMetric[] {
  if (flavor === "comparator") return DEMO_COMPARATOR_OPTIMIZATION_METRICS;
  if (flavor === "ota") return DEMO_OTA_OPTIMIZATION_METRICS;
  return DEMO_OPTIMIZATION_METRICS;
}

export function inferMetricFlavor(value: unknown): CircuitMetricFlavor {
  const record = recordOf(value);
  const properties = recordOf(record.properties);
  const extensions = recordOf(record.extensions);
  const optimizationExtension = recordOf(extensions[OPTIMIZATION_METRICS_EXTENSION_KEY]);
  const family = [
    record.circuitFamily,
    properties.circuitFamily,
    record.family,
    properties.family,
    record.metricFlavor,
    properties.metricFlavor,
    record.productFamily,
    properties.productFamily,
    optimizationExtension.sourceLabel,
    record.project,
    properties.project,
    record.cell,
    properties.cell,
    record.name,
  ].filter((value) => value !== undefined && value !== null && String(value).trim())
    .map(String)
    .join(" ")
    .toLowerCase();
  if (/(?:^|[^a-z0-9])(ota|opamp|operational|amplifier)(?:$|[^a-z0-9])/.test(family)) return "ota";
  if (/(?:^|[^a-z0-9])(comparator|cmp|strongarm|latch)(?:$|[^a-z0-9])/.test(family)) return "comparator";
  return "sar_adc";
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function numberFrom(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.trim().replace(/,/g, "");
    const match = cleaned.match(/[-+]?[0-9]*\.?[0-9]+(?:e[-+]?[0-9]+)?/i);
    if (match) {
      const number = Number(match[0]);
      if (Number.isFinite(number)) return number;
    }
  }
  const record = recordOf(value);
  for (const key of ["value", "metric_value", "candidate", "measured", "mean"]) {
    if (record[key] === undefined) continue;
    const nested = numberFrom(record[key]);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function booleanFrom(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "string") return /^(pass|passed|true|yes|ok)$/i.test(value.trim());
  return false;
}

function optionalBooleanFrom(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === true || value === false) return value;
  if (typeof value === "number" && Number.isFinite(value)) return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (/^(pass|passed|true|yes|ok|observed|present)$/i.test(normalized)) return true;
    if (/^(fail|failed|false|no|missing|absent|not_observed)$/i.test(normalized)) return false;
  }
  return booleanFrom(value);
}

function readNumber(record: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    if (record[key] !== undefined) return numberFrom(record[key]);
    const match = Object.entries(record).find(([candidate]) => candidate.toLowerCase() === key.toLowerCase());
    if (match) return numberFrom(match[1]);
  }
  return undefined;
}

function readString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    const match = Object.entries(record).find(([candidate]) => candidate.toLowerCase() === key.toLowerCase());
    if (typeof match?.[1] === "string" && match[1].trim()) return match[1].trim();
  }
  return undefined;
}

function readFirst(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
    const match = Object.entries(record).find(([candidate]) => candidate.toLowerCase() === key.toLowerCase());
    if (match) return match[1];
  }
  return undefined;
}

function roundFromKey(key: string): number | undefined {
  const match = key.match(/(?:^|[_-])round[_-]?(\d+)|^r(\d+)$/i);
  return match ? numberFrom(match[1] ?? match[2]) : undefined;
}

function stringsFrom(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function noteValue(notes: readonly string[] | undefined, label: string): string | undefined {
  const pattern = new RegExp(`^${label}\\s*:\\s*(.+)$`, "i");
  for (const note of notes ?? []) {
    const match = pattern.exec(note.trim());
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

function cornerIdFromMetric(metric: OptimizationRoundMetric | Record<string, unknown>): string | undefined {
  const record = metric as Record<string, unknown>;
  const notes = Array.isArray(record.notes) ? record.notes.map(String) : [];
  return typeof record.cornerId === "string" && record.cornerId.trim()
    ? record.cornerId.trim()
    : typeof record.corner_id === "string" && record.corner_id.trim()
      ? record.corner_id.trim()
      : noteValue(notes, "Corner")
        ?? (/^(?:tt|ss|ff|sf|fs)(?:_|$)/i.test(String(record.candidateId ?? record.candidate_id ?? ""))
          ? String(record.candidateId ?? record.candidate_id)
          : undefined);
}

function processFromMetric(metric: OptimizationRoundMetric | Record<string, unknown>): string | undefined {
  const record = metric as Record<string, unknown>;
  const notes = Array.isArray(record.notes) ? record.notes.map(String) : [];
  const direct = typeof record.process === "string" ? record.process.trim() : "";
  if (direct) return direct;
  const noted = noteValue(notes, "Process");
  if (noted) return noted;
  const corner = cornerIdFromMetric(metric);
  return corner?.match(/^(tt|ss|ff|sf|fs)(?:_|$)/i)?.[1]?.toLowerCase();
}

function temperatureFromMetric(metric: OptimizationRoundMetric | Record<string, unknown>): number | undefined {
  const record = metric as Record<string, unknown>;
  const notes = Array.isArray(record.notes) ? record.notes.map(String) : [];
  const direct = numberFrom(record.temperatureC ?? record.temperature_c ?? record.temp_c);
  if (direct !== undefined) return direct;
  const noted = numberFrom(noteValue(notes, "Temp"));
  if (noted !== undefined) return noted;
  const corner = cornerIdFromMetric(metric);
  const match = corner?.match(/(?:^|_)(m?\d+)c(?:_|$)/i);
  if (!match?.[1]) return undefined;
  return Number(match[1].replace(/^m/i, "-"));
}

function vddScaleFromMetric(metric: OptimizationRoundMetric | Record<string, unknown>): number | undefined {
  const record = metric as Record<string, unknown>;
  const notes = Array.isArray(record.notes) ? record.notes.map(String) : [];
  const direct = numberFrom(record.vddScale ?? record.vdd_scale);
  if (direct !== undefined) return direct;
  const noted = numberFrom(noteValue(notes, "VDD scale"));
  if (noted !== undefined) return noted;
  const corner = cornerIdFromMetric(metric);
  const match = corner?.match(/vddx([0-9]+(?:p[0-9]+)?)/i);
  return match?.[1] ? Number(match[1].replace("p", ".")) : undefined;
}

function normalizeRoundCandidate(input: unknown, index: number, fallbackRound?: number): Record<string, unknown> {
  const record = recordOf(input);
  const metrics = recordOf(
    record.metrics
      ?? record.metric
      ?? record.measurements
      ?? record.scalar_metrics
      ?? record.final_metrics,
  );
  const assessment = recordOf(record.assessment ?? record.signoff ?? record.gates);
  const gap = recordOf(record.gap ?? record.metric_gap);
  const spectre = recordOf(record.spectre ?? record.simulation ?? record.simulation_result);
  const artifacts = recordOf(record.artifacts);
  const waveformExport = recordOf(
    spectre.waveform_export
      ?? record.waveform_export
      ?? artifacts.waveform_export,
  );
  const waveformArtifact = recordOf(
    record.waveform_artifact
      ?? record.waveform_artifacts
      ?? record.waveform
      ?? artifacts.waveform
      ?? artifacts.waveform_artifact,
  );
  const waveformFiles = recordOf(
    waveformArtifact.files
      ?? waveformExport.files
      ?? record.files,
  );
  const candidateId = readFirst(record, ["candidate_id", "candidateId", "candidate", "id", "corner_id", "cornerId", "round_name", "dut_track"]);
  const blockers = stringsFrom(assessment.blockers);
  const noteItems = [
    ...stringsFrom(record.notes),
    ...stringsFrom(record.note),
    ...stringsFrom(record.reason),
    ...stringsFrom(record.corner_id ? `Corner: ${record.corner_id}` : undefined),
    ...stringsFrom(record.process !== undefined ? `Process: ${record.process}` : undefined),
    ...stringsFrom(record.temperature_c !== undefined ? `Temp: ${record.temperature_c} C` : undefined),
    ...stringsFrom(record.vdd_scale !== undefined ? `VDD scale: ${record.vdd_scale}` : undefined),
    ...stringsFrom(record.dut_track ? `DUT track: ${record.dut_track}` : undefined),
    ...stringsFrom(gap.suggested_route ? `Route: ${gap.suggested_route}` : undefined),
  ];

  return {
    ...record,
    ...metrics,
    round: readNumber(record, ["round", "round_id", "round_index", "iteration", "iter"])
      ?? readNumber(metrics, ["round", "round_id", "round_index", "iteration", "iter"])
      ?? fallbackRound
      ?? index,
    candidate_id: candidateId,
    status: readFirst(record, ["status", "final_status", "stage_name", "evidence_level"])
      ?? readFirst(assessment, ["status", "stage_name", "evidence_level"]),
    signoff_level: readFirst(record, ["signoff_level", "signoffLevel"])
      ?? readFirst(assessment, ["signoff_level", "signoffLevel"]),
    metric_source_file: readFirst(record, ["metric_source_file", "metricSourceFile", "metric_source"])
      ?? readFirst(metrics, ["metric_source_file", "metricSourceFile", "metric_source"])
      ?? readFirst(artifacts, ["metrics_json", "metric_json", "assessment_json"]),
    spec_passed: readFirst(record, ["spec_passed", "specPassed", "pass", "passed"])
      ?? readFirst(record, ["stage_passed", "internal_stage_passed", "product_gate_passed"])
      ?? readFirst(assessment, ["metric_targets_passed", "full_metric_targets_passed", "dynamic_targets_passed", "spec_passed", "passed"])
      ?? readFirst(record, ["final_status", "status"]),
    failure_signature: readFirst(record, ["failure_signature", "failureSignature", "failure"])
      ?? readFirst(gap, ["suggested_route", "failure_signature"])
      ?? (blockers.length ? blockers.join("; ") : undefined)
      ?? (stringsFrom(record.failure_labels).length ? stringsFrom(record.failure_labels).join("; ") : undefined)
      ?? readFirst(assessment, ["failure_signature", "status"])
      ?? readFirst(metrics, ["failure", "status"]),
    waveform_manifest: readFirst(record, ["waveform_manifest", "waveformManifest", "manifest"])
      ?? readFirst(artifacts, ["waveform_manifest", "waveformManifest"])
      ?? readFirst(waveformArtifact, ["waveform_manifest", "waveformManifest", "manifest"])
      ?? readFirst(waveformExport, ["manifest"]),
    waveforms_downsampled_csv: readFirst(record, ["waveforms_downsampled_csv", "waveform_csv", "waveformCsv", "csv"])
      ?? readFirst(artifacts, ["waveforms_downsampled_csv", "waveform_csv", "waveformCsv"])
      ?? readFirst(waveformArtifact, ["waveforms_downsampled_csv", "waveform_csv", "waveformCsv", "csv"])
      ?? readFirst(waveformFiles, ["waveforms_downsampled_csv", "waveform_csv", "csv"])
      ?? readFirst(waveformExport, ["csv"]),
    waveform_source: readFirst(record, ["waveform_source", "waveformSource"])
      ?? readFirst(waveformArtifact, ["source", "metric_source"])
      ?? readFirst(waveformExport, ["source"]),
    waveform_status: readFirst(record, ["waveform_status", "waveformStatus"])
      ?? readFirst(waveformArtifact, ["status"])
      ?? readFirst(waveformExport, ["status"]),
    notes: noteItems,
  };
}

function parseTrace(input: unknown, fallbackName: string): WaveformTrace | null {
  const record = recordOf(input);
  const name = readString(record, ["name", "signal", "net", "label"]) ?? fallbackName;
  const rawPoints = record.points ?? record.samples ?? record.xy;
  if (!Array.isArray(rawPoints)) return null;
  const points = rawPoints.flatMap((item): WaveformSample[] => {
    if (Array.isArray(item) && item.length >= 2) {
      const x = numberFrom(item[0]);
      const y = numberFrom(item[1]);
      return x !== undefined && y !== undefined ? [{ x, y }] : [];
    }
    const point = recordOf(item);
    const x = readNumber(point, ["x", "time", "t"]);
    const y = readNumber(point, ["y", "value", "v"]);
    return x !== undefined && y !== undefined ? [{ x, y }] : [];
  });
  if (points.length < 2) return null;
  const requestedStyle = readString(record, ["renderStyle", "render_style", "drawStyle", "plotStyle"]);
  const renderStyle = requestedStyle === "step" || requestedStyle === "stem" || requestedStyle === "line"
    ? requestedStyle
    : undefined;
  return {
    name,
    xUnit: readString(record, ["xUnit", "x_unit"]) ?? "ns",
    yUnit: readString(record, ["yUnit", "y_unit"]) ?? "V",
    color: readString(record, ["color"]),
    renderStyle,
    points,
  };
}

function parseWaveforms(record: Record<string, unknown>): WaveformTrace[] {
  const direct = record.waveforms ?? record.traces ?? record.waveform_traces;
  if (Array.isArray(direct)) {
    return direct.flatMap((trace, index) => {
      const parsed = parseTrace(trace, `trace${index + 1}`);
      return parsed ? [parsed] : [];
    });
  }
  const objectTraces = recordOf(record.transient_waveforms ?? record.waveform);
  return Object.entries(objectTraces).flatMap(([name, samples]) => {
    const parsed = parseTrace({ name, points: samples }, name);
    return parsed ? [parsed] : [];
  });
}

function candidateRounds(input: unknown): unknown[] {
  if (Array.isArray(input)) return input;
  const record = recordOf(input);
  for (const key of ["per_round_metrics", "rounds", "corners", "rows", "metrics", "history"]) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  if (Array.isArray(record.benches)) {
    return (record.benches as unknown[]).flatMap((bench, benchIndex) => {
      const benchRecord = recordOf(bench);
      const details = recordOf(benchRecord.details);
      const rows = Array.isArray(details.rows) ? details.rows : [];
      if (rows.length) {
        return rows.map((row, rowIndex) => ({
          ...recordOf(row),
          candidate_id: `${benchRecord.bench ?? "bench"}_${String(rowIndex).padStart(2, "0")}`,
          status: benchRecord.bench,
          stage_passed: recordOf(row).passed ?? benchRecord.passed,
          notes: [`Bench: ${benchRecord.bench ?? `bench_${benchIndex}`}`],
        }));
      }
      return [{
        ...benchRecord,
        candidate_id: benchRecord.bench ?? `bench_${benchIndex}`,
        status: benchRecord.bench,
        stage_passed: benchRecord.passed,
        notes: [`Bench: ${benchRecord.bench ?? `bench_${benchIndex}`}`],
      }];
    });
  }
  const contract = recordOf(record.pvt_state_contract);
  if (Array.isArray(contract.corner_observations)) return contract.corner_observations as unknown[];
  const artifacts = recordOf(record.artifacts);
  if (Array.isArray(artifacts.per_round_metrics)) return artifacts.per_round_metrics as unknown[];
  const keyedRounds = Object.entries(record)
    .filter(([key, value]) => roundFromKey(key) !== undefined && typeof value === "object" && value !== null)
    .map(([key, value], index) => normalizeRoundCandidate(value, index, roundFromKey(key)));
  if (keyedRounds.length) return keyedRounds;
  const source = recordOf(record.source);
  const seed = recordOf(source.seed);
  const raw = recordOf(seed.raw);
  if (Array.isArray(raw.iterations)) return raw.iterations as unknown[];
  if (
    readNumber(record, [
      "enob",
      "enob_bits",
      "sndr_db",
      "sndrDb",
      "sfdr_db",
      "sfdrDb",
      "power_uw",
      "powerUw",
      "gain_db",
      "tpd_avg_ns",
      "tpd_fall_ns",
      "tpd_rise_ns",
      "delay_ns",
      "delay_ps",
      "valid_edge_count",
      "code_transition_count",
      "missing_code_count",
      "dnl_lsb_p2p",
      "inl_lsb_p2p",
    ]) !== undefined
  ) {
    return [record];
  }
  return [];
}

export function parsePerRoundMetrics(input: unknown): OptimizationRoundMetric[] {
  const parsed = typeof input === "string" ? JSON.parse(input) as unknown : input;
  return candidateRounds(parsed)
    .map((item, index) => {
      const record = normalizeRoundCandidate(item, index);
      const powerUw = readNumber(record, ["power_uw", "powerUw", "candidate_power_uw"])
        ?? (readNumber(record, ["power_mw", "powerMw"]) !== undefined
          ? readNumber(record, ["power_mw", "powerMw"])! * 1000
          : readNumber(record, ["candidate_power_mw"]) !== undefined
            ? readNumber(record, ["candidate_power_mw"])! * 1000
            : readNumber(record, ["power"]) !== undefined
              ? readNumber(record, ["power"])
              : undefined);
      const delayPs = readNumber(record, ["delay_ps", "delayPs", "tpd_avg_ps", "tpd_ps", "tpd_fall_ps", "tpd_rise_ps"])
        ?? (readNumber(record, ["delay_ns", "tpd_avg_ns", "tpd_ns", "tpd_fall_ns", "tpd_rise_ns"]) !== undefined
          ? readNumber(record, ["delay_ns", "tpd_avg_ns", "tpd_ns", "tpd_fall_ns", "tpd_rise_ns"])! * 1000
          : readNumber(record, ["candidate_tpd_avg_ns", "candidate_tpd_fall_ns"]) !== undefined
            ? readNumber(record, ["candidate_tpd_avg_ns", "candidate_tpd_fall_ns"])! * 1000
            : undefined);
      const ugbwMhz = readNumber(record, ["ugbw_mhz", "ugbwMHz", "unity_gain_mhz", "gbp_mhz", "candidate_gbp_mhz"])
        ?? (readNumber(record, ["ugbw_hz", "ugbw", "unity_gain_hz", "gbp_hz", "candidate_ugbw_hz"]) !== undefined
          ? readNumber(record, ["ugbw_hz", "ugbw", "unity_gain_hz", "gbp_hz", "candidate_ugbw_hz"])! / 1e6
          : undefined);
      const waveformManifestPath = readString(record, ["waveform_manifest", "waveformManifest"]);
      const waveformCsvPath = readString(record, ["waveforms_downsampled_csv", "waveform_csv", "waveformCsv"]);
      const waveformStatus = readString(record, ["waveform_status", "waveformStatus"]);
      let waveformArtifactStatus: OptimizationRoundMetric["waveformArtifactStatus"];
      if (
        waveformStatus === "available"
        || waveformStatus === "missing_csv"
        || waveformStatus === "missing_manifest"
        || waveformStatus === "pending"
        || waveformStatus === "unavailable"
      ) {
        waveformArtifactStatus = waveformStatus;
      } else if (waveformCsvPath) {
        waveformArtifactStatus = "available";
      } else if (waveformManifestPath) {
        waveformArtifactStatus = "missing_csv";
      }
      return {
        round: readNumber(record, ["round", "round_id", "iteration", "iter"]) ?? index,
        candidateId: readString(record, ["candidate_id", "candidateId", "candidate", "id"]),
        status: readString(record, ["status", "final_status"]),
        cornerId: cornerIdFromMetric(record),
        process: processFromMetric(record),
        temperatureC: temperatureFromMetric(record),
        vddScale: vddScaleFromMetric(record),
        metricSourceFile: readString(record, ["metric_source_file", "metricSourceFile"]),
        promptSource: readString(record, ["prompt_source", "promptSource"]),
        promptVersion: readNumber(record, ["prompt_version", "promptVersion"])
          ?? readString(record, ["prompt_version", "promptVersion"]),
        signoffLevel: readString(record, ["signoff_level", "signoffLevel"]),
        enob: readNumber(record, ["enob", "enob_bits"]),
        sndrDb: readNumber(record, ["sndr_db", "sndrDb", "sndr", "SNDR"]),
        sfdrDb: readNumber(record, ["sfdr_db", "sfdrDb", "sfdr", "SFDR"]),
        powerUw,
        validEdgeCount: readNumber(record, ["valid_edge_count", "validEdgeCount"]),
        uniqueCodeCount: readNumber(record, ["unique_code_count", "uniqueCodeCount"]),
        codeTransitionCount: readNumber(record, ["code_transition_count", "codeTransitionCount", "output_code_transition_count", "outputCodeTransitionCount"]),
        missingCodeCount: readNumber(record, ["missing_code_count", "missingCodeCount", "bit_activity_missing_code_count"]),
        inlLsbP2p: readNumber(record, ["inl_lsb_p2p", "inlLsbP2p"]),
        dnlLsbP2p: readNumber(record, ["dnl_lsb_p2p", "dnlLsbP2p"]),
        bitActivitySampleCount: readNumber(record, ["bit_activity_sample_count", "bitActivitySampleCount"]),
        bitActivityDistinctCodeCount: readNumber(record, ["bit_activity_distinct_code_count", "bitActivityDistinctCodeCount"]),
        doutActivityObserved: optionalBooleanFrom(record.dout_activity_observed ?? record.doutActivityObserved),
        comparatorActivityObserved: optionalBooleanFrom(record.comparator_activity_observed ?? record.comparatorActivityObserved),
        phaseActivityObserved: optionalBooleanFrom(record.phase_activity_observed ?? record.phaseActivityObserved),
        stateStorageObserved: optionalBooleanFrom(record.state_storage_observed ?? record.stateStorageObserved),
        spSnActivityObserved: optionalBooleanFrom(record.sp_sn_activity_observed ?? record.spSnActivityObserved),
        negativeControlPassed: optionalBooleanFrom(record.negative_control_passed ?? record.negativeControlPassed),
        transistorClosedLoopPassed: optionalBooleanFrom(record.transistor_closed_loop_passed ?? record.transistorClosedLoopPassed),
        loopClaimLevel: readString(record, ["loop_claim_level", "loopClaimLevel", "claim_level", "claimLevel"]),
        delayPs,
        offsetMv: readNumber(record, ["offset_mv", "offsetMv", "input_offset_mv", "inputOffsetMv", "candidate_offset_mv", "offset_bound_mv"]),
        outputSwingV: readNumber(record, ["output_swing_v", "outputSwingV", "swing_v", "swing", "candidate_output_swing_v", "product_output_swing_v"]),
        gainDb: readNumber(record, ["gain_db", "gainDb", "dc_gain_db", "av_db", "candidate_gain_db"]),
        ugbwMhz,
        phaseMarginDeg: readNumber(record, ["phase_margin_deg", "phaseMarginDeg", "pm_deg", "pm", "candidate_pm_deg"]),
        slewVus: readNumber(record, ["slew_vus", "slewVus", "slew_rate_v_us", "slew_rate_v_per_us", "slew_rate", "candidate_slew_rate_v_per_us"]),
        settlingNs: readNumber(record, ["settling_ns", "settlingNs", "settling_time_ns", "candidate_settling_ns"]),
        specPassed: booleanFrom(record.spec_passed ?? record.specPassed ?? record.stage_passed ?? record.product_gate_passed ?? record.pass ?? record.passed ?? record.valid ?? record.status),
        failureSignature: readString(record, ["failure_signature", "failureSignature", "failure", "status"])
          || stringsFrom(record.failure_labels).join("; ")
          || stringsFrom(record.blockers).join("; "),
        notes: Array.isArray(record.notes)
          ? record.notes.map(String)
          : readString(record, ["note", "reason"])
            ? [readString(record, ["note", "reason"])!]
            : [],
        waveformManifestPath,
        waveformCsvPath,
        waveformSource: readString(record, ["waveform_source", "waveformSource", "metric_source", "source"]),
        waveformArtifactStatus,
        waveformImageUrl: readString(record, ["waveform_image_url", "waveformImageUrl", "waveform_image", "viva_screenshot_url", "screenshot"]),
        suppressGeneratedWaveforms: booleanFrom(
          record.suppress_generated_waveforms
            ?? record.suppressGeneratedWaveforms
        ),
        waveforms: parseWaveforms(record),
      };
    })
    .sort((left, right) => left.round - right.round);
}

export function optimizationMetricsFromExtension(value: unknown): OptimizationRoundMetric[] {
  if (value === undefined || value === null) return [];
  const record = recordOf(value);
  try {
    const metrics = Array.isArray(record.metrics) ? record.metrics : value;
    return parsePerRoundMetrics(metrics);
  } catch {
    return [];
  }
}

export function optimizationMetricsFromDocument(
  document: { extensions?: Record<string, unknown> } | null | undefined,
): OptimizationRoundMetric[] {
  return optimizationMetricsFromExtension(document?.extensions?.[OPTIMIZATION_METRICS_EXTENSION_KEY]);
}

export function withOptimizationMetricsExtension<T extends { extensions?: Record<string, unknown> }>(
  document: T,
  metrics: readonly OptimizationRoundMetric[],
  metadata: Omit<OptimizationMetricsExtension, "schema" | "metrics"> = {},
): T {
  return {
    ...document,
    extensions: {
      ...document.extensions,
      [OPTIMIZATION_METRICS_EXTENSION_KEY]: {
        schema: "analog_studio.optimization_metrics.v1",
        artifactBacked: metadata.artifactBacked ?? true,
        importedAt: metadata.importedAt ?? new Date().toISOString(),
        ...(metadata.sourceLabel ? { sourceLabel: metadata.sourceLabel } : {}),
        metrics: metrics.map((metric) => ({ ...metric })),
      },
    },
  };
}

function delta(value: number | undefined, reference: number | undefined): number | undefined {
  return value !== undefined && reference !== undefined ? value - reference : undefined;
}

function bestOf(
  metrics: readonly OptimizationRoundMetric[],
  key: OptimizationMetricKey,
  lowerIsBetter = false,
): OptimizationRoundMetric | undefined {
  const valued = metrics
    .filter((metric) => metric[key] !== undefined)
    .sort((left, right) => left.round - right.round);
  const preferred = valued.filter((metric) => metric.specPassed && !metricHasExplicitFallback(metric));
  const candidates = preferred.length ? preferred : valued.filter((metric) => metric.specPassed) || valued;
  return (candidates.length ? candidates : valued)
    .reduce<OptimizationRoundMetric | undefined>((best, metric) => {
      if (!best) return metric;
      const current = metric[key]!;
      const previous = best[key]!;
      return lowerIsBetter ? current < previous ? metric : best : current > previous ? metric : best;
    }, undefined);
}

function metricHasExplicitFallback(metric: OptimizationRoundMetric): boolean {
  return /fallback/i.test([
    metric.candidateId,
    metric.status,
    metric.metricSourceFile,
    ...metric.notes,
  ].filter(Boolean).join(" "));
}

function isFiniteMetricValue(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function metricHasFlavorValue(metric: OptimizationRoundMetric | undefined, flavor: CircuitMetricFlavor): boolean {
  if (!metric) return false;
  return metricProfileForFlavor(flavor).columns.some((column) => isFiniteMetricValue(metric[column.key]));
}

function metricHasSarDynamicValue(metric: OptimizationRoundMetric | undefined): boolean {
  return Boolean(metric && (
    isFiniteMetricValue(metric.enob)
    || isFiniteMetricValue(metric.sndrDb)
    || isFiniteMetricValue(metric.sfdrDb)
  ));
}

function metricHasSarDiagnosticValue(metric: OptimizationRoundMetric | undefined): boolean {
  return Boolean(metric && [
    metric.validEdgeCount,
    metric.uniqueCodeCount,
    metric.codeTransitionCount,
    metric.missingCodeCount,
    metric.inlLsbP2p,
    metric.dnlLsbP2p,
    metric.bitActivitySampleCount,
    metric.bitActivityDistinctCodeCount,
  ].some(isFiniteMetricValue));
}

function sarMetricLooksInvalid(metric: OptimizationRoundMetric): boolean {
  const text = [
    metric.status,
    metric.failureSignature,
    metric.loopClaimLevel,
    ...metric.notes,
  ].filter(Boolean).join(" ");
  return metric.specPassed === false
    || metric.doutActivityObserved === false
    || (isFiniteMetricValue(metric.codeTransitionCount) && metric.codeTransitionCount <= 0)
    || (isFiniteMetricValue(metric.missingCodeCount) && metric.missingCodeCount >= 64)
    || (isFiniteMetricValue(metric.dnlLsbP2p) && metric.dnlLsbP2p >= 16)
    || /static|missing|invalid|failed|failure|needs_repair|budget_exhausted|diagnostic|blocker|structural_repair/i.test(text);
}

export function shouldSuppressGeneratedWaveformPreviews(
  metric: OptimizationRoundMetric | undefined,
  flavor: CircuitMetricFlavor = "sar_adc",
): boolean {
  if (!metric) return false;
  if (metric.suppressGeneratedWaveforms) return true;
  if (flavor !== "sar_adc") return false;
  return !metricHasSarDynamicValue(metric)
    && metricHasSarDiagnosticValue(metric)
    && sarMetricLooksInvalid(metric);
}

function processRank(value: string | undefined): number {
  const order: Record<string, number> = { tt: 0, ss: 1, ff: 2, sf: 3, fs: 4 };
  return order[String(value ?? "").toLowerCase()] ?? 99;
}

function pvtRowFromMetric(metric: OptimizationRoundMetric): PvtMetricRow {
  const cornerId = metric.cornerId ?? cornerIdFromMetric(metric);
  const process = metric.process ?? processFromMetric(metric);
  const temperatureC = metric.temperatureC ?? temperatureFromMetric(metric);
  const vddScale = metric.vddScale ?? vddScaleFromMetric(metric);
  const label = cornerId ?? metric.candidateId ?? `R${metric.round}`;
  return {
    id: `${metric.round}:${label}`,
    round: metric.round,
    label,
    process,
    temperatureC,
    vddScale,
    status: metric.status,
    specPassed: metric.specPassed,
    metricSourceFile: metric.metricSourceFile,
    sourceMetric: metric,
  };
}

function metricLooksLikePvt(metric: OptimizationRoundMetric): boolean {
  return Boolean(metric.cornerId ?? cornerIdFromMetric(metric))
    || /pvt|corner|full_pvt_condition/i.test([
      metric.status,
      metric.signoffLevel,
      metric.failureSignature,
      metric.metricSourceFile,
      ...metric.notes,
    ].filter(Boolean).join(" "));
}

function uniqueSortedNumbers(values: Array<number | undefined>): number[] {
  return [...new Set(values.filter((value): value is number => value !== undefined && Number.isFinite(value)))]
    .sort((left, right) => left - right);
}

function uniqueSortedStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))]
    .sort((left, right) => processRank(left) - processRank(right) || compareMetricText(left, right));
}

function worstForColumn(rows: readonly PvtMetricRow[], column: CircuitMetricColumn): PvtMetricWorst | undefined {
  const valued = rows.flatMap((row) => {
    const value = row.sourceMetric[column.key];
    return typeof value === "number" && Number.isFinite(value) ? [{ row, value }] : [];
  });
  return valued.reduce<PvtMetricWorst | undefined>((worst, item) => {
    if (!worst) return { column, row: item.row, value: item.value };
    return column.lowerIsBetter
      ? item.value > worst.value ? { column, row: item.row, value: item.value } : worst
      : item.value < worst.value ? { column, row: item.row, value: item.value } : worst;
  }, undefined);
}

export function buildPvtMetricMatrix(
  metrics: readonly OptimizationRoundMetric[],
  flavor: CircuitMetricFlavor = "sar_adc",
): PvtMetricMatrixSummary {
  const profile = metricProfileForFlavor(flavor);
  const pvtMetrics = metrics.filter(metricLooksLikePvt);
  const mode: PvtMetricMatrixSummary["mode"] = pvtMetrics.length ? "pvt" : metrics.length ? "nominal" : "pending";
  const sourceMetrics = pvtMetrics.length ? pvtMetrics : metrics.at(-1) ? [metrics.at(-1)!] : [];
  const rows = sourceMetrics
    .map(pvtRowFromMetric)
    .sort((left, right) =>
      processRank(left.process) - processRank(right.process)
      || (left.temperatureC ?? Number.POSITIVE_INFINITY) - (right.temperatureC ?? Number.POSITIVE_INFINITY)
      || (left.vddScale ?? Number.POSITIVE_INFINITY) - (right.vddScale ?? Number.POSITIVE_INFINITY)
      || left.round - right.round
      || compareMetricText(left.label, right.label));
  const valuedColumns = profile.columns.filter((column) =>
    rows.some((row) => typeof row.sourceMetric[column.key] === "number"));
  const columns = valuedColumns.length ? valuedColumns : profile.columns;
  const processes = uniqueSortedStrings(rows.map((row) => row.process));
  const temperatures = uniqueSortedNumbers(rows.map((row) => row.temperatureC));
  const vddScales = uniqueSortedNumbers(rows.map((row) => row.vddScale));
  const passCount = rows.filter((row) => row.specPassed).length;
  const worst = columns.flatMap((column) => {
    const item = worstForColumn(rows, column);
    return item ? [item] : [];
  });
  const title = mode === "pvt"
    ? "PVT Matrix"
    : mode === "nominal"
      ? "Nominal / transient only"
      : "PVT pending";
  const subtitle = mode === "pvt"
    ? `${rows.length} corners · ${processes.length || "?"} process · ${temperatures.length || "?"} temp · ${vddScales.length || "?"} VDD`
    : mode === "nominal"
      ? "PVT corner artifact pending; showing latest available run"
      : "No Spectre PVT artifact imported";
  return {
    mode,
    rows,
    columns,
    passCount,
    totalCount: rows.length,
    processes,
    temperatures,
    vddScales,
    worst,
    title,
    subtitle,
  };
}

function tradeoffFor(row: OptimizationMetricRow, flavor: CircuitMetricFlavor): string {
  const explicitFallback = metricHasExplicitFallback(row);
  if (flavor === "comparator") {
    const delay = row.deltaFromPrevious.delayPs;
    const offset = row.deltaFromPrevious.offsetMv;
    const power = row.deltaFromPrevious.powerUw;
    if (explicitFallback) return row.specPassed ? "显式 fallback 验证通过" : "显式 fallback 候选仍需修复";
    if ((delay ?? 0) < -3 && (offset ?? 0) < -0.2 && (power ?? 0) > 8) return "Delay/offset 改善，功耗上升";
    if ((delay ?? 0) < -3 && (power ?? 0) <= 0) return "再生速度提升且功耗未增加";
    if ((offset ?? 0) < -0.2 && (delay ?? 0) > 3) return "Offset 降低，速度回退";
    if ((power ?? 0) < -8 && ((delay ?? 0) > 3 || (offset ?? 0) > 0.2)) return "功耗下降，判决裕量回退";
    if (row.specPassed) return "比较器 nominal 指标满足";
    return row.failureSignature || "继续比较器搜索";
  }

  if (flavor === "ota") {
    const gain = row.deltaFromPrevious.gainDb;
    const ugbw = row.deltaFromPrevious.ugbwMhz;
    const pm = row.deltaFromPrevious.phaseMarginDeg;
    const settling = row.deltaFromPrevious.settlingNs;
    const power = row.deltaFromPrevious.powerUw;
    if (explicitFallback) return row.specPassed ? "显式 fallback 验证通过" : "显式 fallback 候选仍需修复";
    if ((gain ?? 0) > 0.4 && (ugbw ?? 0) < -0.2) return "增益提升，带宽回退";
    if ((ugbw ?? 0) > 0.2 && (pm ?? 0) < -0.5) return "带宽提升，相位裕度下降";
    if ((settling ?? 0) < -2 && (power ?? 0) > 8) return "建立速度提升，功耗上升";
    if ((gain ?? 0) > 0.4 && (pm ?? 0) > 0.5 && (power ?? 0) <= 0) return "增益/稳定性提升且功耗未增加";
    if (row.specPassed) return "OTA nominal 指标满足";
    return row.failureSignature || "继续 OTA 搜索";
  }

  const sndr = row.deltaFromPrevious.sndrDb ?? row.deltaFromPrevious.enob;
  const sfdr = row.deltaFromPrevious.sfdrDb;
  const power = row.deltaFromPrevious.powerUw;
  if ((row.codeTransitionCount ?? 1) <= 0) return row.failureSignature || "输出码静态，FFT 指标不可成立";
  if (row.transistorClosedLoopPassed === false) return row.failureSignature || "闭环结构可见，但因果闭环仍未通过";
  if ((row.missingCodeCount ?? 0) > 0) return row.failureSignature || "存在 missing code，线性度仍需修复";
  if ((sndr ?? 0) > 0.2 && (power ?? 0) > 10) return "SNDR/ENOB 提升，功耗上升";
  if ((sfdr ?? 0) > 0.2 && (power ?? 0) > 10) return "线性度改善，功耗上升";
  if ((power ?? 0) < -10 && ((sndr ?? 0) < -0.2 || (sfdr ?? 0) < -0.2)) return "功耗下降，动态性能回退";
  if ((sndr ?? 0) > 0.2 && (power ?? 0) <= 0) return "性能提升且功耗未增加";
  if (row.specPassed) return "满足目标，进入候选收敛";
  return row.failureSignature || "继续搜索";
}

export function summarizeOptimizationMetrics(
  metrics: readonly OptimizationRoundMetric[],
  flavor: CircuitMetricFlavor = "sar_adc",
): OptimizationMetricSummary {
  const sorted = [...metrics].sort((left, right) => left.round - right.round);
  const initial = sorted[0];
  const rows = sorted.map((metric, index): OptimizationMetricRow => {
    const previous = sorted[Math.max(0, index - 1)];
    const row: OptimizationMetricRow = {
      ...metric,
      deltaFromInitial: {
        enob: delta(metric.enob, initial?.enob),
        sndrDb: delta(metric.sndrDb, initial?.sndrDb),
        sfdrDb: delta(metric.sfdrDb, initial?.sfdrDb),
        powerUw: delta(metric.powerUw, initial?.powerUw),
        delayPs: delta(metric.delayPs, initial?.delayPs),
        offsetMv: delta(metric.offsetMv, initial?.offsetMv),
        outputSwingV: delta(metric.outputSwingV, initial?.outputSwingV),
        gainDb: delta(metric.gainDb, initial?.gainDb),
        ugbwMhz: delta(metric.ugbwMhz, initial?.ugbwMhz),
        phaseMarginDeg: delta(metric.phaseMarginDeg, initial?.phaseMarginDeg),
        slewVus: delta(metric.slewVus, initial?.slewVus),
        settlingNs: delta(metric.settlingNs, initial?.settlingNs),
      },
      deltaFromPrevious: {
        enob: index === 0 ? undefined : delta(metric.enob, previous?.enob),
        sndrDb: index === 0 ? undefined : delta(metric.sndrDb, previous?.sndrDb),
        sfdrDb: index === 0 ? undefined : delta(metric.sfdrDb, previous?.sfdrDb),
        powerUw: index === 0 ? undefined : delta(metric.powerUw, previous?.powerUw),
        delayPs: index === 0 ? undefined : delta(metric.delayPs, previous?.delayPs),
        offsetMv: index === 0 ? undefined : delta(metric.offsetMv, previous?.offsetMv),
        outputSwingV: index === 0 ? undefined : delta(metric.outputSwingV, previous?.outputSwingV),
        gainDb: index === 0 ? undefined : delta(metric.gainDb, previous?.gainDb),
        ugbwMhz: index === 0 ? undefined : delta(metric.ugbwMhz, previous?.ugbwMhz),
        phaseMarginDeg: index === 0 ? undefined : delta(metric.phaseMarginDeg, previous?.phaseMarginDeg),
        slewVus: index === 0 ? undefined : delta(metric.slewVus, previous?.slewVus),
        settlingNs: index === 0 ? undefined : delta(metric.settlingNs, previous?.settlingNs),
      },
      tradeoff: "",
    };
    return { ...row, tradeoff: tradeoffFor(row, flavor) };
  });
  const latest = sorted.at(-1);
  const profile = metricProfileForFlavor(flavor);
  const primary = flavor === "sar_adc"
    ? profile.columns.find((column) => column.key === "sndrDb") ?? profile.columns[0]
    : profile.columns[0];
  const primarySeries = primary ? sorted.filter((metric) => metric[primary.key] !== undefined) : [];
  const powerSeries = sorted.filter((metric) => metric.powerUw !== undefined);
  const primaryChange = primary ? delta(primarySeries.at(-1)?.[primary.key], primarySeries[0]?.[primary.key]) : undefined;
  const powerChange = delta(powerSeries.at(-1)?.powerUw, powerSeries[0]?.powerUw);
  const metricImprovementText = [
    primary && primaryChange !== undefined
      ? `${primary.label} ${primaryChange >= 0 ? "+" : ""}${primaryChange.toFixed(primary.digits)} ${primary.unit}`
      : "",
    powerChange !== undefined ? `Power ${powerChange >= 0 ? "+" : ""}${powerChange.toFixed(0)} uW` : "",
  ].filter(Boolean).join(" / ");
  const sarDiagnosticText = flavor === "sar_adc" && latest
    ? [
        latest.validEdgeCount !== undefined ? `valid ${latest.validEdgeCount}` : "",
        latest.codeTransitionCount !== undefined ? `code transitions ${latest.codeTransitionCount}` : "",
        latest.missingCodeCount !== undefined ? `missing ${latest.missingCodeCount}` : "",
      ].filter(Boolean).join(" / ")
    : "";
  const improvementText = metricImprovementText || sarDiagnosticText || "等待指标";

  return {
    rows,
    best: {
      enob: bestOf(sorted, "enob"),
      sndrDb: bestOf(sorted, "sndrDb"),
      sfdrDb: bestOf(sorted, "sfdrDb"),
      powerUw: bestOf(sorted, "powerUw", true),
      delayPs: bestOf(sorted, "delayPs", true),
      offsetMv: bestOf(sorted, "offsetMv", true),
      outputSwingV: bestOf(sorted, "outputSwingV"),
      gainDb: bestOf(sorted, "gainDb"),
      ugbwMhz: bestOf(sorted, "ugbwMhz"),
      phaseMarginDeg: bestOf(sorted, "phaseMarginDeg"),
      slewVus: bestOf(sorted, "slewVus"),
      settlingNs: bestOf(sorted, "settlingNs", true),
    },
    latest,
    initial,
    improvementText,
    tradeoffs: [...new Set(rows.map((row) => row.tradeoff).filter(Boolean))],
  };
}

export function waveformTracesForRound(
  metric: OptimizationRoundMetric | undefined,
  allMetrics: readonly OptimizationRoundMetric[],
  flavor: CircuitMetricFlavor = "sar_adc",
): WaveformTrace[] {
  if (metric?.waveforms.length) return metric.waveforms;
  if (shouldSuppressGeneratedWaveformPreviews(metric, flavor)) return [];
  const previewMetric = metric ?? allMetrics.at(-1);
  if (!metricHasFlavorValue(previewMetric, flavor)) return [];
  return transientPanelForRound(metric, allMetrics).traces;
}

function effectiveMetric(
  metric: OptimizationRoundMetric | undefined,
  allMetrics: readonly OptimizationRoundMetric[],
): Required<Pick<OptimizationRoundMetric, "round">> & {
  enob: number;
  sndrDb: number;
  sfdrDb: number;
  powerUw: number;
  delayPs: number;
  offsetMv: number;
  outputSwingV: number;
  gainDb: number;
  ugbwMhz: number;
  phaseMarginDeg: number;
  slewVus: number;
  settlingNs: number;
} {
  const source = metric ?? allMetrics.at(-1);
  return {
    round: source?.round ?? 0,
    enob: source?.enob ?? 8,
    sndrDb: source?.sndrDb ?? 52,
    sfdrDb: source?.sfdrDb ?? 60,
    powerUw: source?.powerUw ?? 1400,
    delayPs: source?.delayPs ?? 110,
    offsetMv: source?.offsetMv ?? 7,
    outputSwingV: source?.outputSwingV ?? 1.65,
    gainDb: source?.gainDb ?? 62,
    ugbwMhz: source?.ugbwMhz ?? 16,
    phaseMarginDeg: source?.phaseMarginDeg ?? 58,
    slewVus: source?.slewVus ?? 14,
    settlingNs: source?.settlingNs ?? 65,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function inputDifferentialAt(timeNs: number, span: number): number {
  const phase = (timeNs / 86) * Math.PI * 2 + 0.34;
  return span * (Math.sin(phase) + 0.045 * Math.sin(3 * phase + 0.8));
}

function sarResidual(sampledDiff: number, resolvedBits: number): number {
  let estimate = 0;
  for (let bit = 0; bit < resolvedBits; bit += 1) {
    const step = 0.9 / (2 ** bit);
    estimate += sampledDiff >= estimate ? step : -step;
  }
  return sampledDiff - estimate;
}

function transientPanelForRound(
  metric: OptimizationRoundMetric | undefined,
  allMetrics: readonly OptimizationRoundMetric[],
): WaveformPanel {
  const value = effectiveMetric(metric, allMetrics);
  const vdd = clamp(value.outputSwingV, 1.45, 1.85);
  const vcm = vdd / 2;
  const inputSpan = clamp(0.42 + value.enob * 0.032, 0.5, 0.78);
  const bitCount = 10;
  const sampleNs = 10;
  const bitNs = 3.65;
  const frameNs = sampleNs + bitNs * bitCount + 8;
  const timeMax = frameNs * 3.1;
  const points = 840;
  const vinp: WaveformSample[] = [];
  const vinn: WaveformSample[] = [];
  const sampleClk: WaveformSample[] = [];
  const sarClk: WaveformSample[] = [];
  const vtopP: WaveformSample[] = [];
  const vtopN: WaveformSample[] = [];
  const outp: WaveformSample[] = [];
  const outn: WaveformSample[] = [];

  for (let index = 0; index < points; index += 1) {
    const t = (index / (points - 1)) * timeMax;
    const frameStart = Math.floor(t / frameNs) * frameNs;
    const localT = t - frameStart;
    const samplePoint = frameStart + sampleNs * 0.72;
    const sampledDiff = inputDifferentialAt(samplePoint, inputSpan);
    const inputDiff = inputDifferentialAt(t, inputSpan);
    const sampleGate = localT <= sampleNs;
    const conversionT = localT - sampleNs;
    const resolvedBits = clamp(Math.floor(conversionT / bitNs), 0, bitCount);
    const bitIndex = clamp(Math.floor(conversionT / bitNs), 0, bitCount - 1);
    const bitPhase = conversionT - bitIndex * bitNs;
    const previousResidual = resolvedBits > 0 ? sarResidual(sampledDiff, resolvedBits - 1) : sampledDiff;
    const targetResidual = sampleGate ? inputDiff : sarResidual(sampledDiff, resolvedBits);
    const edgeT = frameStart + sampleNs + resolvedBits * bitNs;
    const settleAge = Math.max(0, t - edgeT);
    const settling = sampleGate
      ? targetResidual
      : targetResidual + (previousResidual - targetResidual) * Math.exp(-settleAge / 0.62);
    const kick = sampleGate ? 0 : 0.025 * Math.exp(-settleAge / 1.25) * Math.sin(settleAge * 6.2);
    const vinRipple = 0.006 * Math.sin(t * 2.7);
    const clockHigh = conversionT >= 0 && conversionT <= bitCount * bitNs && bitPhase < bitNs * 0.42;
    const resetWindow = conversionT < 0 || conversionT > bitCount * bitNs || bitPhase < bitNs * 0.22;
    const decisionResidual = sarResidual(sampledDiff, bitIndex);
    const decisionIsP = decisionResidual >= 0;
    const regen = resetWindow ? 0 : 1 / (1 + Math.exp(-(bitPhase - bitNs * 0.45) / 0.18));
    const highOut = 0.12 + (vdd - 0.18) * regen;
    const lowOut = 0.12 + 0.06 * (1 - regen);

    vinp.push({ x: t, y: clamp(vcm + inputDiff / 2 + vinRipple, 0.02, vdd - 0.02) });
    vinn.push({ x: t, y: clamp(vcm - inputDiff / 2 - vinRipple, 0.02, vdd - 0.02) });
    sampleClk.push({ x: t, y: sampleGate ? vdd : 0.05 });
    sarClk.push({ x: t, y: clockHigh ? vdd : 0.05 });
    vtopP.push({ x: t, y: clamp(vcm + settling / 2 + kick, 0.02, vdd - 0.02) });
    vtopN.push({ x: t, y: clamp(vcm - settling / 2 - kick, 0.02, vdd - 0.02) });
    outp.push({ x: t, y: resetWindow ? 0.12 : decisionIsP ? highOut : lowOut });
    outn.push({ x: t, y: resetWindow ? 0.12 : decisionIsP ? lowOut : highOut });
  }

  return {
    id: "sar_transient",
    label: "SAR transient preview",
    kind: "sar_transient",
    description: "preview: input, sample clock, SAR bit cycles, CDAC top plates, comparator regeneration",
    xLabel: "time (ns)",
    yLabel: "voltage (V)",
    traces: [
      { name: "/VINP", xUnit: "ns", yUnit: "V", color: "#008000", points: vinp },
      { name: "/VINN", xUnit: "ns", yUnit: "V", color: "#006a3d", points: vinn },
      { name: "/SAMPLE", xUnit: "ns", yUnit: "V", color: "#7a2ca0", points: sampleClk },
      { name: "/SAR_CLK", xUnit: "ns", yUnit: "V", color: "#0048b8", points: sarClk },
      { name: "/VTOPP", xUnit: "ns", yUnit: "V", color: "#b87500", points: vtopP },
      { name: "/VTOPN", xUnit: "ns", yUnit: "V", color: "#8a5d00", points: vtopN },
      { name: "/OUTP", xUnit: "ns", yUnit: "V", color: "#c00000", points: outp },
      { name: "/OUTN", xUnit: "ns", yUnit: "V", color: "#d66c00", points: outn },
    ],
  };
}

function fftPanelForRound(
  metric: OptimizationRoundMetric | undefined,
  allMetrics: readonly OptimizationRoundMetric[],
): WaveformPanel {
  const value = effectiveMetric(metric, allMetrics);
  const floor = -95 + Math.max(0, 58 - value.sndrDb) * 0.8;
  const spur = -Math.max(36, value.sfdrDb);
  const fundamental = 9.7;
  const points: WaveformSample[] = [];
  for (let index = 0; index <= 160; index += 1) {
    const freq = index * 0.5;
    const noise = floor + Math.sin(index * 0.37) * 2.2 + Math.cos(index * 0.11) * 1.4;
    const tone = -3 * Math.min(1, Math.abs(freq - fundamental) / 0.8) ** 2;
    const harmonic2 = spur - 9 + Math.max(0, 10 - Math.abs(freq - fundamental * 2) * 4);
    const harmonic3 = spur + Math.max(0, 12 - Math.abs(freq - fundamental * 3) * 4.5);
    points.push({ x: freq, y: Math.max(noise, tone, harmonic2, harmonic3) });
  }
  return {
    id: "fft_sndr_sfdr",
    label: "SNDR / SFDR FFT",
    kind: "fft_sndr_sfdr",
    description: `SNDR ${value.sndrDb.toFixed(2)} dB · SFDR ${value.sfdrDb.toFixed(2)} dB`,
    xLabel: "frequency (MHz)",
    yLabel: "magnitude (dBc)",
    traces: [
      { name: "adc_fft", xUnit: "MHz", yUnit: "dBc", color: "#2b579a", points },
      { name: "noise_floor", xUnit: "MHz", yUnit: "dBc", color: "#6b6967", points: [{ x: 0, y: floor }, { x: 80, y: floor }] },
      { name: "largest_spur", xUnit: "MHz", yUnit: "dBc", color: "#a4262c", points: [{ x: 0, y: spur }, { x: 80, y: spur }] },
    ],
  };
}

function linearityPanelForRound(
  metric: OptimizationRoundMetric | undefined,
  allMetrics: readonly OptimizationRoundMetric[],
): WaveformPanel {
  const value = effectiveMetric(metric, allMetrics);
  const codes = 96;
  const dnlScale = Math.max(0.12, 1.12 - value.enob * 0.095);
  const inlScale = Math.max(0.16, 1.35 - value.sfdrDb * 0.014);
  const dnl: WaveformSample[] = [];
  const inl: WaveformSample[] = [];
  for (let index = 0; index < codes; index += 1) {
    const code = index / (codes - 1) * 1023;
    dnl.push({ x: code, y: dnlScale * Math.sin(index * 0.45) + dnlScale * 0.35 * Math.sin(index * 0.09) });
    inl.push({ x: code, y: inlScale * Math.sin(index * 0.13) + inlScale * 0.4 * Math.cos(index * 0.05) });
  }
  return {
    id: "linearity",
    label: "DNL / INL",
    kind: "linearity",
    description: "CDAC mismatch and switching linearity",
    xLabel: "output code",
    yLabel: "error (LSB)",
    traces: [
      { name: "DNL", xUnit: "code", yUnit: "LSB", color: "#107c10", points: dnl },
      { name: "INL", xUnit: "code", yUnit: "LSB", color: "#744da9", points: inl },
    ],
  };
}

function powerPanelForRound(
  metric: OptimizationRoundMetric | undefined,
  allMetrics: readonly OptimizationRoundMetric[],
): WaveformPanel {
  const sorted = [...allMetrics].sort((left, right) => left.round - right.round);
  const powerTrace = sorted.map((row) => ({ x: row.round, y: row.powerUw ?? effectiveMetric(row, sorted).powerUw }));
  const active = effectiveMetric(metric, sorted);
  const searchEnvelope = powerTrace.map((point, index) => ({
    x: point.x,
    y: point.y * (1 + 0.035 * Math.sin(index * 1.7)),
  }));
  return {
    id: "power_tradeoff",
    label: "Power trade-off",
    kind: "power_tradeoff",
    description: `round ${active.round} · ${active.powerUw.toFixed(0)} uW`,
    xLabel: "optimization round",
    yLabel: "power (uW)",
    traces: [
      { name: "total_power", xUnit: "round", yUnit: "uW", color: "#a4262c", points: powerTrace.length ? powerTrace : [{ x: active.round, y: active.powerUw }] },
      { name: "bias_envelope", xUnit: "round", yUnit: "uW", color: "#c77700", points: searchEnvelope.length ? searchEnvelope : [{ x: active.round, y: active.powerUw * 1.03 }] },
    ],
  };
}

function comparatorPanelForRound(
  metric: OptimizationRoundMetric | undefined,
  allMetrics: readonly OptimizationRoundMetric[],
): WaveformPanel {
  const value = effectiveMetric(metric, allMetrics);
  const regenerationTime = Math.max(42, value.delayPs);
  const offsetMv = value.offsetMv;
  const outp: WaveformSample[] = [];
  const outn: WaveformSample[] = [];
  const inputDiff: WaveformSample[] = [];
  for (let index = 0; index < 120; index += 1) {
    const t = index / 119 * 420;
    const logistic = 1 / (1 + Math.exp(-(t - regenerationTime) / 18));
    inputDiff.push({ x: t, y: offsetMv + 7 * Math.sin(t / 420 * Math.PI * 2) });
    outp.push({ x: t, y: 0.12 + 1.56 * logistic });
    outn.push({ x: t, y: 1.68 - 1.53 * logistic });
  }
  return {
    id: "comparator_regen",
    label: "Comparator regen",
    kind: "comparator_regen",
    description: `regen ${regenerationTime.toFixed(0)} ps · offset ${offsetMv.toFixed(1)} mV`,
    xLabel: "time (ps)",
    yLabel: "voltage / mV",
    traces: [
      { name: "OUTP", xUnit: "ps", yUnit: "V", color: "#2b579a", points: outp },
      { name: "OUTN", xUnit: "ps", yUnit: "V", color: "#a4262c", points: outn },
      { name: "input_diff_mV", xUnit: "ps", yUnit: "mV", color: "#107c10", points: inputDiff },
    ],
  };
}

function comparatorDelaySweepPanelForRound(
  metric: OptimizationRoundMetric | undefined,
  allMetrics: readonly OptimizationRoundMetric[],
): WaveformPanel {
  const value = effectiveMetric(metric, allMetrics);
  const points: WaveformSample[] = [];
  const metastability: WaveformSample[] = [];
  for (let index = 0; index < 101; index += 1) {
    const diff = -25 + index * 0.5;
    const penalty = 180 / (Math.abs(diff - value.offsetMv) + 3.2);
    const delay = value.delayPs * 0.72 + penalty;
    points.push({ x: diff, y: delay });
    metastability.push({ x: diff, y: 12 * Math.exp(-Math.abs(diff - value.offsetMv) / 5) });
  }
  return {
    id: "comparator_delay_sweep",
    label: "Delay sweep",
    kind: "comparator_delay_sweep",
    description: `tpd ${value.delayPs.toFixed(0)} ps · input offset ${value.offsetMv.toFixed(1)} mV`,
    xLabel: "input differential (mV)",
    yLabel: "delay (ps) / risk",
    traces: [
      { name: "tpd_avg", xUnit: "mV", yUnit: "ps", color: "#2b579a", points },
      { name: "metastability_risk", xUnit: "mV", yUnit: "a.u.", color: "#a4262c", points: metastability },
    ],
  };
}

function comparatorOffsetPanelForRound(
  metric: OptimizationRoundMetric | undefined,
  allMetrics: readonly OptimizationRoundMetric[],
): WaveformPanel {
  const sorted = [...allMetrics].sort((left, right) => left.round - right.round);
  const offsetTrace = sorted.map((row) => ({ x: row.round, y: row.offsetMv ?? effectiveMetric(row, sorted).offsetMv }));
  const delayTrace = sorted.map((row) => ({ x: row.round, y: row.delayPs ?? effectiveMetric(row, sorted).delayPs }));
  const swingTrace = sorted.map((row) => ({ x: row.round, y: (row.outputSwingV ?? effectiveMetric(row, sorted).outputSwingV) * 100 }));
  return {
    id: "comparator_offset",
    label: "Offset / delay closure",
    kind: "comparator_offset",
    description: "per-round comparator trade-off",
    xLabel: "optimization round",
    yLabel: "mV / ps / swing x100",
    traces: [
      { name: "offset_mV", xUnit: "round", yUnit: "mV", color: "#107c10", points: offsetTrace },
      { name: "delay_ps", xUnit: "round", yUnit: "ps", color: "#2b579a", points: delayTrace },
      { name: "swing_x100", xUnit: "round", yUnit: "V", color: "#744da9", points: swingTrace },
    ],
  };
}

function cdacSettlingPanelForRound(
  metric: OptimizationRoundMetric | undefined,
  allMetrics: readonly OptimizationRoundMetric[],
): WaveformPanel {
  const value = effectiveMetric(metric, allMetrics);
  const initialError = Math.max(0.18, 1.8 - value.sfdrDb / 55);
  const tau = Math.max(0.9, 3.7 - value.round * 0.55);
  const residue: WaveformSample[] = [];
  const error: WaveformSample[] = [];
  for (let index = 0; index < 110; index += 1) {
    const t = index / 109 * 12;
    const settle = Math.exp(-t / tau);
    residue.push({ x: t, y: 0.9 + 0.22 * settle * Math.cos(t * 2.8) });
    error.push({ x: t, y: initialError * settle * Math.cos(t * 1.7) });
  }
  return {
    id: "cdac_settling",
    label: "CDAC settling",
    kind: "cdac_settling",
    description: "top-plate residue and late-bit settling error",
    xLabel: "time (ns)",
    yLabel: "V / LSB",
    traces: [
      { name: "top_plate", xUnit: "ns", yUnit: "V", color: "#2b579a", points: residue },
      { name: "settling_error_lsb", xUnit: "ns", yUnit: "LSB", color: "#a4262c", points: error },
    ],
  };
}

function otaBodePanelForRound(
  metric: OptimizationRoundMetric | undefined,
  allMetrics: readonly OptimizationRoundMetric[],
): WaveformPanel {
  const value = effectiveMetric(metric, allMetrics);
  const dcGain = value.gainDb;
  const poleHz = Math.max(2e3, value.ugbwMhz * 1e6 / (10 ** (dcGain / 20)));
  const secondPoleHz = Math.max(poleHz * 8, value.ugbwMhz * 1e6 * (value.phaseMarginDeg / 52));
  const gain: WaveformSample[] = [];
  const phase: WaveformSample[] = [];
  for (let index = 0; index <= 150; index += 1) {
    const logHz = 1 + index / 150 * 9;
    const freq = 10 ** logHz;
    const gainDb = dcGain
      - 10 * Math.log10(1 + (freq / poleHz) ** 2)
      - 5 * Math.log10(1 + (freq / secondPoleHz) ** 2);
    const phaseDeg = -Math.atan(freq / poleHz) * 180 / Math.PI
      - Math.atan(freq / secondPoleHz) * 180 / Math.PI;
    gain.push({ x: logHz, y: gainDb });
    phase.push({ x: logHz, y: phaseDeg });
  }
  return {
    id: "ota_ac_bode",
    label: "AC gain / phase",
    kind: "ota_ac_bode",
    description: `gain ${value.gainDb.toFixed(1)} dB · UGBW ${value.ugbwMhz.toFixed(1)} MHz · PM ${value.phaseMarginDeg.toFixed(1)} deg`,
    xLabel: "frequency log10(Hz)",
    yLabel: "gain (dB) / phase (deg)",
    traces: [
      { name: "gain_db", xUnit: "logHz", yUnit: "dB", color: "#2b579a", points: gain },
      { name: "phase_deg", xUnit: "logHz", yUnit: "deg", color: "#a4262c", points: phase },
      { name: "0dB", xUnit: "logHz", yUnit: "dB", color: "#6b6967", points: [{ x: 1, y: 0 }, { x: 10, y: 0 }] },
    ],
  };
}

function otaStepPanelForRound(
  metric: OptimizationRoundMetric | undefined,
  allMetrics: readonly OptimizationRoundMetric[],
): WaveformPanel {
  const value = effectiveMetric(metric, allMetrics);
  const tau = Math.max(2.5, value.settlingNs / 4.6);
  const damping = Math.max(0.42, Math.min(0.88, value.phaseMarginDeg / 78));
  const output: WaveformSample[] = [];
  const error: WaveformSample[] = [];
  for (let index = 0; index < 140; index += 1) {
    const t = index / 139 * Math.max(120, value.settlingNs * 2.2);
    const ring = Math.exp(-t / tau) * Math.cos(t / tau * (1.7 - damping));
    const y = 0.9 + 0.42 * (1 - ring);
    output.push({ x: t, y });
    error.push({ x: t, y: (1.32 - y) * 1000 });
  }
  return {
    id: "ota_step_settling",
    label: "Step settling",
    kind: "ota_step_settling",
    description: `settling ${value.settlingNs.toFixed(0)} ns`,
    xLabel: "time (ns)",
    yLabel: "voltage (V) / error (mV)",
    traces: [
      { name: "vout", xUnit: "ns", yUnit: "V", color: "#107c10", points: output },
      { name: "settling_error_mV", xUnit: "ns", yUnit: "mV", color: "#a4262c", points: error },
    ],
  };
}

function otaSlewPanelForRound(
  metric: OptimizationRoundMetric | undefined,
  allMetrics: readonly OptimizationRoundMetric[],
): WaveformPanel {
  const value = effectiveMetric(metric, allMetrics);
  const swing = 1.1;
  const rampTime = Math.max(18, swing / value.slewVus * 1000);
  const output: WaveformSample[] = [];
  const slew: WaveformSample[] = [];
  for (let index = 0; index < 130; index += 1) {
    const t = index / 129 * Math.max(160, rampTime * 1.6);
    const ramp = Math.min(1, Math.max(0, (t - 12) / rampTime));
    const ease = ramp < 1 ? ramp : 1 - 0.04 * Math.exp(-(t - 12 - rampTime) / 28);
    output.push({ x: t, y: 0.25 + swing * ease });
    slew.push({ x: t, y: ramp > 0 && ramp < 1 ? value.slewVus : value.slewVus * Math.exp(-Math.max(0, t - 12 - rampTime) / 12) });
  }
  return {
    id: "ota_slew",
    label: "Slew rate",
    kind: "ota_slew",
    description: `slew ${value.slewVus.toFixed(1)} V/us`,
    xLabel: "time (ns)",
    yLabel: "voltage (V) / V/us",
    traces: [
      { name: "large_signal_vout", xUnit: "ns", yUnit: "V", color: "#2b579a", points: output },
      { name: "slew_v_us", xUnit: "ns", yUnit: "V/us", color: "#c77700", points: slew },
    ],
  };
}

function otaGainPowerPanelForRound(
  metric: OptimizationRoundMetric | undefined,
  allMetrics: readonly OptimizationRoundMetric[],
): WaveformPanel {
  const sorted = [...allMetrics].sort((left, right) => left.round - right.round);
  return {
    id: "ota_gain_power",
    label: "Gain / power trade-off",
    kind: "ota_gain_power",
    description: "per-round OTA trade-off",
    xLabel: "optimization round",
    yLabel: "gain dB / MHz / uW",
    traces: [
      { name: "gain_db", xUnit: "round", yUnit: "dB", color: "#2b579a", points: sorted.map((row) => ({ x: row.round, y: row.gainDb ?? effectiveMetric(row, sorted).gainDb })) },
      { name: "ugbw_mhz", xUnit: "round", yUnit: "MHz", color: "#107c10", points: sorted.map((row) => ({ x: row.round, y: row.ugbwMhz ?? effectiveMetric(row, sorted).ugbwMhz })) },
      { name: "power_uW", xUnit: "round", yUnit: "uW", color: "#a4262c", points: sorted.map((row) => ({ x: row.round, y: row.powerUw ?? effectiveMetric(row, sorted).powerUw })) },
    ],
  };
}

export function waveformPanelsForRound(
  metric: OptimizationRoundMetric | undefined,
  allMetrics: readonly OptimizationRoundMetric[],
  flavor: CircuitMetricFlavor = "sar_adc",
): WaveformPanel[] {
  const previewMetric = metric ?? allMetrics.at(-1);
  const imported = metric?.waveforms.length
    ? [{
        id: "imported_psf",
        label: "Imported PSF",
        kind: "imported" as const,
        description: metric.candidateId ?? `round ${metric.round}`,
        xLabel: `${metric.waveforms[0]?.xUnit ?? "x"}`,
        yLabel: `${metric.waveforms[0]?.yUnit ?? "value"}`,
        traces: metric.waveforms,
      }]
    : [];
  const screenshot = metric?.waveformImageUrl
    ? [{
        id: "cadence_viva",
        label: "ViVA reference",
        kind: "imported" as const,
        description: "Cadence screenshot reference",
        xLabel: "time",
        yLabel: "value",
        imageUrl: metric.waveformImageUrl,
        traces: [],
    }]
    : [];
  const evidencePanels = [
    ...imported,
    ...screenshot,
  ];
  if (evidencePanels.length && (
    Boolean(metric?.waveforms.length)
    || Boolean(metric?.waveformImageUrl)
    || metric?.waveformArtifactStatus === "available"
  )) {
    return evidencePanels;
  }
  if (shouldSuppressGeneratedWaveformPreviews(metric, flavor)) {
    return evidencePanels;
  }
  const canGeneratePreview = flavor === "sar_adc"
    ? metricHasSarDynamicValue(previewMetric)
    : metricHasFlavorValue(previewMetric, flavor);
  if (!canGeneratePreview) {
    return evidencePanels;
  }
  const hasSarFftMetrics = isFiniteMetricValue(previewMetric?.sndrDb)
    && isFiniteMetricValue(previewMetric?.sfdrDb);
  const hasPowerMetrics = [previewMetric, ...allMetrics].some((row) => isFiniteMetricValue(row?.powerUw));
  const sarGenerated: WaveformPanel[] = [
    transientPanelForRound(metric, allMetrics),
    ...(hasSarFftMetrics ? [fftPanelForRound(metric, allMetrics)] : []),
    linearityPanelForRound(metric, allMetrics),
    ...(hasPowerMetrics ? [powerPanelForRound(metric, allMetrics)] : []),
    comparatorPanelForRound(metric, allMetrics),
    cdacSettlingPanelForRound(metric, allMetrics),
  ];
  if (!sarGenerated.length) {
    return [
      ...evidencePanels,
    ];
  }
  const generated = flavor === "comparator"
    ? [
        comparatorPanelForRound(metric, allMetrics),
        comparatorDelaySweepPanelForRound(metric, allMetrics),
        comparatorOffsetPanelForRound(metric, allMetrics),
        powerPanelForRound(metric, allMetrics),
      ]
    : flavor === "ota"
      ? [
          otaBodePanelForRound(metric, allMetrics),
          otaStepPanelForRound(metric, allMetrics),
          otaSlewPanelForRound(metric, allMetrics),
          otaGainPowerPanelForRound(metric, allMetrics),
          powerPanelForRound(metric, allMetrics),
        ]
      : sarGenerated;
  return [
    ...evidencePanels,
    ...generated,
  ];
}
