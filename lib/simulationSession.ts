import type { ReleaseFamily } from "./analogweaveAgent";

export type SimulationAnalysisKind = "op" | "ac" | "tran" | "pvt" | "mc";

export interface SimulationVariable {
  id: string;
  label: string;
  value: number;
  unit: string;
  parameter: string;
  fullSignoffOnly?: boolean;
}

export interface SimulationAnalysis {
  kind: SimulationAnalysisKind;
  label: string;
  enabled: boolean;
  executable: boolean;
}

export interface SimulationOutput {
  id: string;
  label: string;
  expression: string;
  analysis: SimulationAnalysisKind;
  unit: string;
}

export interface SimulationSpec {
  metric: string;
  operator: ">=" | "<=";
  target: number;
  unit: string;
}

export interface SimulationSessionConfig {
  family: ReleaseFamily;
  variables: SimulationVariable[];
  analyses: SimulationAnalysis[];
  outputs: SimulationOutput[];
  specs: SimulationSpec[];
}

const COMPARATOR_OUTPUTS: SimulationOutput[] = [
  { id: "tpd_avg", label: "Average delay", expression: "tpd_avg(outp,outn,clk)", analysis: "tran", unit: "ns" },
  { id: "tpd_rise", label: "Rise delay", expression: "tpd_rise(outp,clk)", analysis: "tran", unit: "ns" },
  { id: "tpd_fall", label: "Fall delay", expression: "tpd_fall(outn,clk)", analysis: "tran", unit: "ns" },
  { id: "swing", label: "Differential swing", expression: "swing(outp-outn)", analysis: "tran", unit: "V" },
  { id: "power", label: "Average power", expression: "average(-V(vdd)*I(VDD))", analysis: "tran", unit: "uW" },
];

const OPAMP_OUTPUTS: SimulationOutput[] = [
  { id: "gain", label: "DC gain", expression: "db20(vout/vdiff)", analysis: "ac", unit: "dB" },
  { id: "ugbw", label: "UGBW", expression: "cross(db20(vout/vdiff),0)", analysis: "ac", unit: "MHz" },
  { id: "pm", label: "Phase margin", expression: "180+phase(vout/vdiff)@UGBW", analysis: "ac", unit: "deg" },
  { id: "settling", label: "Settling time", expression: "settling(vout,1%)", analysis: "tran", unit: "ns" },
  { id: "slew", label: "Slew rate", expression: "max(abs(deriv(vout)))", analysis: "tran", unit: "V/us" },
  { id: "power", label: "Average power", expression: "average(-V(vdd)*I(VDD))", analysis: "op", unit: "uW" },
];

export function defaultSimulationSession(family: ReleaseFamily): SimulationSessionConfig {
  if (family === "comparator") {
    return {
      family,
      variables: [
        { id: "vdd", label: "VDD", value: 1.8, unit: "V", parameter: "vdd" },
        { id: "temp", label: "Temperature", value: 27, unit: "C", parameter: "temp_c" },
        { id: "overdrive", label: "Input overdrive", value: 0.2, unit: "V", parameter: "input_overdrive_v" },
        { id: "load", label: "Output load", value: 0.05, unit: "pF", parameter: "output_load_pf" },
        { id: "mc_samples", label: "MC samples", value: 100, unit: "runs", parameter: "mc_samples", fullSignoffOnly: true },
      ],
      analyses: [
        { kind: "tran", label: "Transient", enabled: true, executable: true },
        { kind: "pvt", label: "PVT Matrix", enabled: false, executable: true },
        { kind: "mc", label: "Mismatch MC", enabled: false, executable: true },
      ],
      outputs: COMPARATOR_OUTPUTS,
      specs: [
        { metric: "tpd_avg_ns", operator: "<=", target: 5.3, unit: "ns" },
        { metric: "tpd_rise_ns", operator: "<=", target: 5.3, unit: "ns" },
        { metric: "tpd_fall_ns", operator: "<=", target: 8, unit: "ns" },
        { metric: "output_swing_v", operator: ">=", target: 1.6, unit: "V" },
        { metric: "power_mw", operator: "<=", target: 0.12, unit: "mW" },
      ],
    };
  }
  return {
    family,
    variables: [
      { id: "vdd", label: "VDD", value: 1.8, unit: "V", parameter: "vdd" },
      { id: "temp", label: "Temperature", value: 27, unit: "C", parameter: "temp_c" },
      { id: "load", label: "Load capacitance", value: 1, unit: "pF", parameter: "load_cap_pf" },
      { id: "step", label: "Step amplitude", value: 0.05, unit: "V", parameter: "step_amplitude_v" },
      { id: "mc_samples", label: "MC samples", value: 100, unit: "runs", parameter: "mc_samples", fullSignoffOnly: true },
    ],
    analyses: [
      { kind: "op", label: "Operating Point", enabled: true, executable: true },
      { kind: "ac", label: "AC / Loop", enabled: true, executable: true },
      { kind: "tran", label: "Transient Step", enabled: true, executable: true },
      { kind: "pvt", label: "PVT Matrix", enabled: false, executable: true },
      { kind: "mc", label: "Mismatch MC", enabled: false, executable: true },
    ],
    outputs: OPAMP_OUTPUTS,
    specs: [
      { metric: "gain_db", operator: ">=", target: 38, unit: "dB" },
      { metric: "ugbw_hz", operator: ">=", target: 800_000, unit: "Hz" },
      { metric: "pm_deg", operator: ">=", target: 60, unit: "deg" },
      { metric: "settling_time_ns", operator: "<=", target: 700, unit: "ns" },
      { metric: "power_mw", operator: "<=", target: 0.05, unit: "mW" },
    ],
  };
}

export function simulationSessionPrompt(config: SimulationSessionConfig): string {
  const variableText = config.variables.map((item) => `${item.label}=${item.value}${item.unit}`).join(", ");
  const analysisText = config.analyses.filter((item) => item.enabled && item.executable).map((item) => item.label).join(", ");
  const specText = config.specs.map((item) => `${item.metric} ${item.operator} ${item.target}${item.unit}`).join(", ");
  const family = config.family === "comparator" ? "clocked comparator" : "OTA opamp";
  return `Run and verify the current ${family}. Variables: ${variableText}. Analyses: ${analysisText}. Specifications: ${specText}.`;
}

export type SimulationOperation = "nominal_signoff" | "full_signoff";

export function simulationOperation(config: SimulationSessionConfig): SimulationOperation {
  return config.analyses.some((item) => item.enabled && (item.kind === "pvt" || item.kind === "mc"))
    ? "full_signoff"
    : "nominal_signoff";
}

export function simulationParameters(config: SimulationSessionConfig): Record<string, number | string | boolean> {
  const operation = simulationOperation(config);
  const parameters: Record<string, number | string | boolean> = Object.fromEntries(
    config.variables
      .filter((item) => operation === "full_signoff" || !item.fullSignoffOnly)
      .map((item) => [item.parameter, item.value]),
  );
  if (operation === "full_signoff") {
    const mcEnabled = config.analyses.some((item) => item.kind === "mc" && item.enabled);
    parameters.corner_preset = "full";
    parameters.mc_samples = mcEnabled ? Number(parameters.mc_samples ?? 100) : 0;
    parameters.mc_seed = 20260830;
    parameters.scale_power_budget_with_vdd = true;
    parameters.smic180_mismatch_ckt_models = mcEnabled;
    parameters.resume_existing = true;
  }
  return parameters;
}
