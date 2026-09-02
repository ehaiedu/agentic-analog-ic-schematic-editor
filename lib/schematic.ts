/**
 * Pure domain types for the analog schematic editor.
 *
 * Nothing in this module depends on React or X6.  Keeping the electrical
 * document separate from the canvas makes connectivity and netlist output
 * deterministic even when symbols are moved around on screen.
 */

export type DeviceKind =
  | "nmos4"
  | "pmos4"
  | "diode"
  | "npn3"
  | "pnp3"
  | "resistor"
  | "capacitor"
  | "inductor"
  | "vsource"
  | "isource"
  | "vcvs"
  | "vccs"
  | "switch4"
  | "transmission_gate"
  | "sampling_switch"
  | "cdac_array"
  | "sar_logic"
  | "dynamic_comparator"
  | "diff_pair"
  | "current_mirror"
  | "bias_current"
  | "gain_stage"
  | "latch"
  | "opamp3"
  | "subckt4"
  | "subckt5"
  | "subckt6"
  | "subckt7"
  | "subckt8"
  | "subckt9"
  | "subckt10"
  | "subckt11"
  | "subckt12"
  | "vdd"
  | "gnd"
  | "input"
  | "output"
  | "bidir"
  | "junction"
  | "netlabel";

export type Rotation = 0 | 90 | 180 | 270;

export type Orientation =
  | "R0"
  | "R90"
  | "R180"
  | "R270"
  | "MX"
  | "MY"
  | "MXR90"
  | "MYR90";

export type PinSide = "top" | "right" | "bottom" | "left";

export interface PinDefinition {
  /** Stable electrical port identifier. MOS ports deliberately use D/G/S/B. */
  id: string;
  label: string;
  side: PinSide;
  required: boolean;
}

export interface DeviceDefinition {
  kind: DeviceKind;
  label: string;
  category: "mos" | "diode" | "bipolar" | "passive" | "source" | "controlled" | "macro" | "port" | "utility";
  prefix: string;
  width: number;
  height: number;
  pins: readonly PinDefinition[];
  defaults: Readonly<Record<string, string>>;
  requiredProperties: readonly string[];
  /** Utility and port symbols shape connectivity but do not emit instances. */
  netlistable: boolean;
  /** Port used as the placement origin. Symbols without this keep a top-left origin. */
  originPortId?: string;
}

export interface SchematicNode {
  id: string;
  kind: DeviceKind;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: Rotation;
  mirrored: boolean;
  instanceName: string;
  properties: Record<string, string>;
}

export interface EdgeTerminal {
  nodeId: string;
  portId: string;
}

export interface Point {
  x: number;
  y: number;
}

export type WireEndpoint = EdgeTerminal | Point;

export interface SchematicEdge {
  id: string;
  /** Terminal and free-point endpoints are both explicit, persisted geometry. */
  source: WireEndpoint;
  target: WireEndpoint;
  /** Persisted polyline corners. Every segment participates in connectivity extraction. */
  vertices?: Point[];
  style?: "NORMAL" | "FLIGHT" | "REFERENCE";
  width?: number;
  creationOrder?: number;
}

export interface ExplicitJunction {
  id: string;
  point: Point;
}

export interface NetLabel {
  id: string;
  text: string;
  wireId: string;
  segmentIndex: number;
  anchorPoint: Point;
  orientation: Rotation;
  textAlignment: "start" | "middle" | "end";
}

export interface NoConnect {
  id: string;
  nodeId: string;
  portId: string;
  position: Point;
}

export interface SchematicNote {
  id: string;
  text: string;
  anchorPoint: Point;
  orientation: Rotation;
}

export type MarkerSeverity = "error" | "warning" | "info";

export interface SchematicMarker {
  id: string;
  ruleId: string;
  severity: MarkerSeverity;
  message: string;
  objectRefs: string[];
  boundingBox: { x: number; y: number; width: number; height: number };
  revision: number;
  status: "active" | "waived" | "obsolete";
}

export interface RevisionState {
  designRevision: number;
  savedRevision: number;
  connectivityRevision: number;
  checkRevision: number;
}

export interface UnitDefinition {
  userUnit: "um";
  dbuPerUserUnit: number;
}

export interface SchematicDocument {
  version: 3;
  formatVersion: 1;
  editorProfile: "VSE-Core-1";
  id: string;
  library: string;
  project: string;
  cell: string;
  view: "schematic";
  sheetId: string;
  units: UnitDefinition;
  snapGrid: number;
  displayGrid: number;
  nodes: SchematicNode[];
  edges: SchematicEdge[];
  explicitJunctions: ExplicitJunction[];
  netLabels: NetLabel[];
  noConnects: NoConnect[];
  notes: SchematicNote[];
  markers: SchematicMarker[];
  properties: Record<string, string>;
  revisions: RevisionState;
  extensions?: Record<string, unknown>;
}

export function isEdgeTerminal(target: WireEndpoint): target is EdgeTerminal {
  return "nodeId" in target && "portId" in target;
}

/**
 * Electrical coordinates use a finer grid than the 20 px major grid that is
 * drawn on screen. Keeping symbol centres and pins on this grid prevents X6
 * from moving the temporary wire endpoint when it snaps to a real port.
 */
export const ELECTRICAL_GRID_SIZE = 5;
export const VISUAL_GRID_SIZE = 20;

export function snapToElectricalGrid(value: number): number {
  return Math.round(value / ELECTRICAL_GRID_SIZE) * ELECTRICAL_GRID_SIZE;
}

export function orientationOf(node: Pick<SchematicNode, "rotation" | "mirrored">): Orientation {
  if (!node.mirrored) return `R${node.rotation}` as Orientation;
  if (node.rotation === 0) return "MY";
  if (node.rotation === 90) return "MYR90";
  if (node.rotation === 180) return "MX";
  return "MXR90";
}

export type NodePropertyPatch = Partial<
  Pick<
    SchematicNode,
    "x" | "y" | "width" | "height" | "rotation" | "mirrored" | "instanceName"
  >
> & {
  properties?: Record<string, string>;
};

const DEFINITIONS: Record<DeviceKind, DeviceDefinition> = {
  nmos4: {
    kind: "nmos4",
    label: "NMOS (4-pin)",
    category: "mos",
    prefix: "M",
    width: 50,
    height: 70,
    // This array is also the canonical MOS netlist pin order.
    pins: [
      { id: "D", label: "Drain", side: "top", required: true },
      { id: "G", label: "Gate", side: "left", required: true },
      { id: "S", label: "Source", side: "bottom", required: true },
      { id: "B", label: "Bulk", side: "right", required: true },
    ],
    defaults: { model: "nmos", W: "10u", L: "180n", M: "1", NF: "1" },
    requiredProperties: ["model", "W", "L", "M", "NF"],
    netlistable: true,
    originPortId: "G",
  },
  pmos4: {
    kind: "pmos4",
    label: "PMOS (4-pin)",
    category: "mos",
    prefix: "M",
    width: 50,
    height: 70,
    pins: [
      { id: "D", label: "Drain", side: "bottom", required: true },
      { id: "G", label: "Gate", side: "left", required: true },
      { id: "S", label: "Source", side: "top", required: true },
      { id: "B", label: "Bulk", side: "right", required: true },
    ],
    defaults: { model: "pmos", W: "20u", L: "180n", M: "1", NF: "1" },
    requiredProperties: ["model", "W", "L", "M", "NF"],
    netlistable: true,
    originPortId: "G",
  },
  diode: {
    kind: "diode",
    label: "Diode",
    category: "diode",
    prefix: "D",
    width: 90,
    height: 50,
    pins: [
      { id: "P", label: "Anode", side: "left", required: true },
      { id: "N", label: "Cathode", side: "right", required: true },
    ],
    defaults: { model: "diode", area: "1", M: "1" },
    requiredProperties: ["model"],
    netlistable: true,
  },
  npn3: {
    kind: "npn3",
    label: "NPN BJT",
    category: "bipolar",
    prefix: "Q",
    width: 70,
    height: 80,
    pins: [
      { id: "C", label: "Collector", side: "top", required: true },
      { id: "B", label: "Base", side: "left", required: true },
      { id: "E", label: "Emitter", side: "bottom", required: true },
    ],
    defaults: { model: "npn", area: "1", M: "1" },
    requiredProperties: ["model"],
    netlistable: true,
    originPortId: "B",
  },
  pnp3: {
    kind: "pnp3",
    label: "PNP BJT",
    category: "bipolar",
    prefix: "Q",
    width: 70,
    height: 80,
    pins: [
      { id: "C", label: "Collector", side: "bottom", required: true },
      { id: "B", label: "Base", side: "left", required: true },
      { id: "E", label: "Emitter", side: "top", required: true },
    ],
    defaults: { model: "pnp", area: "1", M: "1" },
    requiredProperties: ["model"],
    netlistable: true,
    originPortId: "B",
  },
  resistor: {
    kind: "resistor",
    label: "Resistor",
    category: "passive",
    prefix: "R",
    width: 100,
    height: 50,
    pins: [
      { id: "P", label: "+", side: "left", required: true },
      { id: "N", label: "-", side: "right", required: true },
    ],
    defaults: { value: "10k" },
    requiredProperties: ["value"],
    netlistable: true,
  },
  capacitor: {
    kind: "capacitor",
    label: "Capacitor",
    category: "passive",
    prefix: "C",
    width: 100,
    height: 60,
    pins: [
      { id: "P", label: "+", side: "left", required: true },
      { id: "N", label: "-", side: "right", required: true },
    ],
    defaults: { value: "2p" },
    requiredProperties: ["value"],
    netlistable: true,
  },
  inductor: {
    kind: "inductor",
    label: "Inductor",
    category: "passive",
    prefix: "L",
    width: 100,
    height: 50,
    pins: [
      { id: "P", label: "+", side: "left", required: true },
      { id: "N", label: "-", side: "right", required: true },
    ],
    defaults: { value: "10n" },
    requiredProperties: ["value"],
    netlistable: true,
  },
  vsource: {
    kind: "vsource",
    label: "DC Voltage",
    category: "source",
    prefix: "V",
    width: 70,
    height: 90,
    pins: [
      { id: "P", label: "+", side: "top", required: true },
      { id: "N", label: "-", side: "bottom", required: true },
    ],
    defaults: { dc: "1.8", ac: "0" },
    requiredProperties: ["dc"],
    netlistable: true,
  },
  isource: {
    kind: "isource",
    label: "DC Current",
    category: "source",
    prefix: "I",
    width: 70,
    height: 90,
    pins: [
      { id: "P", label: "+", side: "top", required: true },
      { id: "N", label: "-", side: "bottom", required: true },
    ],
    defaults: { dc: "10u", ac: "0" },
    requiredProperties: ["dc"],
    netlistable: true,
  },
  vcvs: {
    kind: "vcvs",
    label: "VCVS",
    category: "controlled",
    prefix: "E",
    width: 80,
    height: 90,
    pins: [
      { id: "P", label: "Out+", side: "top", required: true },
      { id: "N", label: "Out-", side: "bottom", required: true },
      { id: "CP", label: "Ctrl+", side: "left", required: true },
      { id: "CN", label: "Ctrl-", side: "right", required: true },
    ],
    defaults: { gain: "1" },
    requiredProperties: ["gain"],
    netlistable: true,
  },
  vccs: {
    kind: "vccs",
    label: "VCCS",
    category: "controlled",
    prefix: "G",
    width: 80,
    height: 90,
    pins: [
      { id: "P", label: "Out+", side: "top", required: true },
      { id: "N", label: "Out-", side: "bottom", required: true },
      { id: "CP", label: "Ctrl+", side: "left", required: true },
      { id: "CN", label: "Ctrl-", side: "right", required: true },
    ],
    defaults: { gm: "1m" },
    requiredProperties: ["gm"],
    netlistable: true,
  },
  switch4: {
    kind: "switch4",
    label: "Voltage Switch",
    category: "controlled",
    prefix: "S",
    width: 90,
    height: 70,
    pins: [
      { id: "P", label: "Sw+", side: "left", required: true },
      { id: "N", label: "Sw-", side: "right", required: true },
      { id: "CP", label: "Ctrl+", side: "top", required: true },
      { id: "CN", label: "Ctrl-", side: "bottom", required: true },
    ],
    defaults: { model: "sw", ron: "1", roff: "1G", vt: "0.5", vh: "0" },
    requiredProperties: ["model"],
    netlistable: true,
  },
  transmission_gate: {
    kind: "transmission_gate",
    label: "Transmission Gate",
    category: "macro",
    prefix: "X",
    width: 110,
    height: 70,
    pins: [
      { id: "A", label: "A", side: "left", required: true },
      { id: "B", label: "B", side: "right", required: true },
      { id: "EN", label: "EN", side: "top", required: true },
      { id: "ENB", label: "ENB", side: "bottom", required: true },
    ],
    defaults: { master: "transmission_gate" },
    requiredProperties: ["master"],
    netlistable: true,
  },
  sampling_switch: {
    kind: "sampling_switch",
    label: "Sampling Switch",
    category: "macro",
    prefix: "X",
    width: 120,
    height: 80,
    pins: [
      { id: "IN", label: "IN", side: "left", required: true },
      { id: "OUT", label: "OUT", side: "right", required: true },
      { id: "CLK", label: "CLK", side: "top", required: true },
      { id: "CLKB", label: "CLKB", side: "bottom", required: true },
      { id: "VDD", label: "VDD", side: "top", required: false },
      { id: "VSS", label: "VSS", side: "bottom", required: false },
    ],
    defaults: { master: "sampling_switch" },
    requiredProperties: ["master"],
    netlistable: true,
  },
  cdac_array: {
    kind: "cdac_array",
    label: "CDAC Array",
    category: "macro",
    prefix: "X",
    width: 150,
    height: 100,
    pins: [
      { id: "TOP", label: "TOP", side: "top", required: true },
      { id: "BOT", label: "BOT", side: "bottom", required: true },
      { id: "CTRL", label: "CTRL", side: "left", required: true },
      { id: "VREFP", label: "VREFP", side: "right", required: true },
      { id: "VREFN", label: "VREFN", side: "right", required: true },
      { id: "VCM", label: "VCM", side: "right", required: false },
      { id: "VDD", label: "VDD", side: "top", required: false },
      { id: "VSS", label: "VSS", side: "bottom", required: false },
    ],
    defaults: { master: "cdac_array", bits: "10", unitCap: "1f" },
    requiredProperties: ["master", "bits", "unitCap"],
    netlistable: true,
  },
  sar_logic: {
    kind: "sar_logic",
    label: "SAR Logic",
    category: "macro",
    prefix: "X",
    width: 120,
    height: 90,
    pins: [
      { id: "CLK", label: "CLK", side: "left", required: true },
      { id: "CMP", label: "CMP", side: "left", required: true },
      { id: "CTRL", label: "CTRL", side: "right", required: true },
      { id: "DOUT", label: "DOUT", side: "right", required: true },
      { id: "RST", label: "RST", side: "top", required: false },
      { id: "VDD", label: "VDD", side: "top", required: false },
      { id: "VSS", label: "VSS", side: "bottom", required: false },
    ],
    defaults: { master: "sar_logic", bits: "10" },
    requiredProperties: ["master", "bits"],
    netlistable: true,
  },
  dynamic_comparator: {
    kind: "dynamic_comparator",
    label: "Dynamic Comparator",
    category: "macro",
    prefix: "X",
    width: 150,
    height: 90,
    pins: [
      { id: "INP", label: "+", side: "left", required: true },
      { id: "INN", label: "-", side: "left", required: true },
      { id: "OUTP", label: "OUTP", side: "right", required: true },
      { id: "OUTN", label: "OUTN", side: "right", required: true },
      { id: "CLK", label: "CLK", side: "top", required: true },
      { id: "VDD", label: "VDD", side: "top", required: false },
      { id: "VSS", label: "VSS", side: "bottom", required: false },
    ],
    defaults: { master: "dynamic_comparator" },
    requiredProperties: ["master"],
    netlistable: true,
  },
  diff_pair: {
    kind: "diff_pair",
    label: "Differential Pair",
    category: "macro",
    prefix: "X",
    width: 120,
    height: 90,
    pins: [
      { id: "INP", label: "+", side: "left", required: true },
      { id: "INN", label: "-", side: "left", required: true },
      { id: "OUTP", label: "OUTP", side: "right", required: true },
      { id: "OUTN", label: "OUTN", side: "right", required: true },
      { id: "TAIL", label: "TAIL", side: "bottom", required: true },
      { id: "VDD", label: "VDD", side: "top", required: false },
    ],
    defaults: { master: "diff_pair" },
    requiredProperties: ["master"],
    netlistable: true,
  },
  current_mirror: {
    kind: "current_mirror",
    label: "Current Mirror",
    category: "macro",
    prefix: "X",
    width: 120,
    height: 80,
    pins: [
      { id: "IN", label: "IREF", side: "left", required: true },
      { id: "OUT", label: "IOUT", side: "right", required: true },
      { id: "VDD", label: "VDD", side: "top", required: false },
      { id: "VSS", label: "VSS", side: "bottom", required: false },
    ],
    defaults: { master: "current_mirror", ratio: "1" },
    requiredProperties: ["master"],
    netlistable: true,
  },
  bias_current: {
    kind: "bias_current",
    label: "Bias Current",
    category: "macro",
    prefix: "X",
    width: 110,
    height: 80,
    pins: [
      { id: "OUT", label: "IBIAS", side: "right", required: true },
      { id: "EN", label: "EN", side: "left", required: false },
      { id: "VDD", label: "VDD", side: "top", required: false },
      { id: "VSS", label: "VSS", side: "bottom", required: false },
    ],
    defaults: { master: "bias_current", current: "10u" },
    requiredProperties: ["master"],
    netlistable: true,
  },
  gain_stage: {
    kind: "gain_stage",
    label: "Gain Stage",
    category: "macro",
    prefix: "X",
    width: 120,
    height: 90,
    pins: [
      { id: "INP", label: "+", side: "left", required: true },
      { id: "INN", label: "-", side: "left", required: true },
      { id: "OUT", label: "OUT", side: "right", required: true },
      { id: "VDD", label: "VDD", side: "top", required: false },
      { id: "VSS", label: "VSS", side: "bottom", required: false },
    ],
    defaults: { master: "gain_stage" },
    requiredProperties: ["master"],
    netlistable: true,
  },
  latch: {
    kind: "latch",
    label: "Regenerative Latch",
    category: "macro",
    prefix: "X",
    width: 120,
    height: 90,
    pins: [
      { id: "INP", label: "INP", side: "left", required: true },
      { id: "INN", label: "INN", side: "left", required: true },
      { id: "OUTP", label: "OUTP", side: "right", required: true },
      { id: "OUTN", label: "OUTN", side: "right", required: true },
      { id: "CLK", label: "CLK", side: "top", required: true },
      { id: "VSS", label: "VSS", side: "bottom", required: false },
    ],
    defaults: { master: "regenerative_latch" },
    requiredProperties: ["master"],
    netlistable: true,
  },
  opamp3: {
    kind: "opamp3",
    label: "OpAmp",
    category: "macro",
    prefix: "X",
    width: 100,
    height: 90,
    pins: [
      { id: "INP", label: "+", side: "left", required: true },
      { id: "INN", label: "-", side: "left", required: true },
      { id: "OUT", label: "Out", side: "right", required: true },
    ],
    defaults: { master: "opamp_core" },
    requiredProperties: ["master"],
    netlistable: true,
  },
  subckt4: {
    kind: "subckt4",
    label: "Subckt 4-pin",
    category: "macro",
    prefix: "X",
    width: 110,
    height: 90,
    pins: [
      { id: "A", label: "A", side: "left", required: true },
      { id: "B", label: "B", side: "left", required: true },
      { id: "C", label: "C", side: "right", required: true },
      { id: "D", label: "D", side: "right", required: true },
    ],
    defaults: { master: "subckt_cell" },
    requiredProperties: ["master"],
    netlistable: true,
  },
  subckt5: {
    kind: "subckt5",
    label: "Subckt 5-pin",
    category: "macro",
    prefix: "X",
    width: 120,
    height: 120,
    pins: [
      { id: "A", label: "A", side: "left", required: true },
      { id: "B", label: "B", side: "left", required: true },
      { id: "C", label: "C", side: "left", required: true },
      { id: "D", label: "D", side: "right", required: true },
      { id: "E", label: "E", side: "right", required: true },
    ],
    defaults: { master: "subckt_cell" },
    requiredProperties: ["master"],
    netlistable: true,
  },
  subckt6: {
    kind: "subckt6",
    label: "Subckt 6-pin",
    category: "macro",
    prefix: "X",
    width: 120,
    height: 100,
    pins: [
      { id: "A", label: "A", side: "left", required: true },
      { id: "B", label: "B", side: "left", required: true },
      { id: "C", label: "C", side: "left", required: true },
      { id: "D", label: "D", side: "right", required: true },
      { id: "E", label: "E", side: "right", required: true },
      { id: "F", label: "F", side: "right", required: true },
    ],
    defaults: { master: "subckt_cell" },
    requiredProperties: ["master"],
    netlistable: true,
  },
  subckt7: {
    kind: "subckt7",
    label: "Subckt 7-pin",
    category: "macro",
    prefix: "X",
    width: 140,
    height: 200,
    pins: [
      { id: "A", label: "A", side: "left", required: true },
      { id: "B", label: "B", side: "left", required: true },
      { id: "C", label: "C", side: "left", required: true },
      { id: "D", label: "D", side: "left", required: true },
      { id: "E", label: "E", side: "right", required: true },
      { id: "F", label: "F", side: "right", required: true },
      { id: "G", label: "G", side: "right", required: true },
    ],
    defaults: { master: "subckt_cell" },
    requiredProperties: ["master"],
    netlistable: true,
  },
  subckt8: {
    kind: "subckt8",
    label: "Subckt 8-pin",
    category: "macro",
    prefix: "X",
    width: 140,
    height: 150,
    pins: [
      { id: "A", label: "A", side: "left", required: true },
      { id: "B", label: "B", side: "left", required: true },
      { id: "C", label: "C", side: "left", required: true },
      { id: "D", label: "D", side: "left", required: true },
      { id: "E", label: "E", side: "right", required: true },
      { id: "F", label: "F", side: "right", required: true },
      { id: "G", label: "G", side: "right", required: true },
      { id: "H", label: "H", side: "right", required: true },
    ],
    defaults: { master: "subckt_cell" },
    requiredProperties: ["master"],
    netlistable: true,
  },
  subckt9: {
    kind: "subckt9",
    label: "Subckt 9-pin",
    category: "macro",
    prefix: "X",
    width: 120,
    height: 120,
    pins: [
      { id: "A", label: "A", side: "left", required: true },
      { id: "B", label: "B", side: "left", required: true },
      { id: "C", label: "C", side: "left", required: true },
      { id: "D", label: "D", side: "right", required: true },
      { id: "E", label: "E", side: "right", required: true },
      { id: "F", label: "F", side: "right", required: true },
      { id: "G", label: "G", side: "top", required: true },
      { id: "H", label: "H", side: "top", required: true },
      { id: "I", label: "I", side: "top", required: true },
    ],
    defaults: { master: "subckt_cell" },
    requiredProperties: ["master"],
    netlistable: true,
  },
  subckt10: {
    kind: "subckt10",
    label: "Subckt 10-pin",
    category: "macro",
    prefix: "X",
    width: 150,
    height: 150,
    pins: [
      { id: "A", label: "A", side: "left", required: true },
      { id: "B", label: "B", side: "left", required: true },
      { id: "C", label: "C", side: "left", required: true },
      { id: "D", label: "D", side: "left", required: true },
      { id: "E", label: "E", side: "right", required: true },
      { id: "F", label: "F", side: "right", required: true },
      { id: "G", label: "G", side: "right", required: true },
      { id: "H", label: "H", side: "right", required: true },
      { id: "I", label: "I", side: "top", required: true },
      { id: "J", label: "J", side: "top", required: true },
    ],
    defaults: { master: "subckt_cell" },
    requiredProperties: ["master"],
    netlistable: true,
  },
  subckt11: {
    kind: "subckt11",
    label: "Subckt 11-pin",
    category: "macro",
    prefix: "X",
    width: 160,
    height: 150,
    pins: [
      { id: "A", label: "A", side: "left", required: true },
      { id: "B", label: "B", side: "left", required: true },
      { id: "C", label: "C", side: "left", required: true },
      { id: "D", label: "D", side: "left", required: true },
      { id: "E", label: "E", side: "right", required: true },
      { id: "F", label: "F", side: "right", required: true },
      { id: "G", label: "G", side: "right", required: true },
      { id: "H", label: "H", side: "right", required: true },
      { id: "I", label: "I", side: "top", required: true },
      { id: "J", label: "J", side: "top", required: true },
      { id: "K", label: "K", side: "top", required: true },
    ],
    defaults: { master: "subckt_cell" },
    requiredProperties: ["master"],
    netlistable: true,
  },
  subckt12: {
    kind: "subckt12",
    label: "Subckt 12-pin",
    category: "macro",
    prefix: "X",
    width: 160,
    height: 210,
    pins: [
      { id: "A", label: "A", side: "left", required: true },
      { id: "B", label: "B", side: "left", required: true },
      { id: "C", label: "C", side: "left", required: true },
      { id: "D", label: "D", side: "left", required: true },
      { id: "E", label: "E", side: "left", required: true },
      { id: "F", label: "F", side: "left", required: true },
      { id: "G", label: "G", side: "right", required: true },
      { id: "H", label: "H", side: "right", required: true },
      { id: "I", label: "I", side: "right", required: true },
      { id: "J", label: "J", side: "right", required: true },
      { id: "K", label: "K", side: "right", required: true },
      { id: "L", label: "L", side: "right", required: true },
    ],
    defaults: { master: "subckt_cell" },
    requiredProperties: ["master"],
    netlistable: true,
  },
  vdd: {
    kind: "vdd",
    label: "VDD",
    category: "port",
    prefix: "VDD",
    width: 60,
    height: 50,
    pins: [{ id: "P", label: "VDD", side: "bottom", required: false }],
    defaults: { netName: "VDD" },
    requiredProperties: ["netName"],
    netlistable: false,
  },
  gnd: {
    kind: "gnd",
    label: "Ground",
    category: "port",
    prefix: "GND",
    width: 60,
    height: 50,
    pins: [{ id: "P", label: "0", side: "top", required: false }],
    defaults: { netName: "0" },
    requiredProperties: ["netName"],
    netlistable: false,
  },
  input: {
    kind: "input",
    label: "Input Port",
    category: "port",
    prefix: "IN",
    width: 80,
    height: 40,
    pins: [{ id: "P", label: "Input", side: "right", required: false }],
    defaults: { netName: "VIN" },
    requiredProperties: ["netName"],
    netlistable: false,
  },
  output: {
    kind: "output",
    label: "Output Port",
    category: "port",
    prefix: "OUT",
    width: 80,
    height: 40,
    pins: [{ id: "P", label: "Output", side: "left", required: false }],
    defaults: { netName: "VOUT" },
    requiredProperties: ["netName"],
    netlistable: false,
  },
  bidir: {
    kind: "bidir",
    label: "Bidirectional Port",
    category: "port",
    prefix: "IO",
    width: 80,
    height: 40,
    pins: [{ id: "P", label: "I/O", side: "right", required: false }],
    defaults: { netName: "IO" },
    requiredProperties: ["netName"],
    netlistable: false,
  },
  junction: {
    kind: "junction",
    label: "Junction",
    category: "utility",
    prefix: "J",
    width: 20,
    height: 20,
    pins: [{ id: "P", label: "Junction", side: "left", required: false }],
    defaults: {},
    requiredProperties: [],
    netlistable: false,
  },
  netlabel: {
    kind: "netlabel",
    label: "Net Label",
    category: "utility",
    prefix: "NET",
    width: 90,
    height: 30,
    pins: [{ id: "P", label: "Net", side: "left", required: false }],
    defaults: { netName: "NET" },
    requiredProperties: ["netName"],
    netlistable: false,
  },
};

export function getDeviceDefinition(kind: DeviceKind): DeviceDefinition {
  return DEFINITIONS[kind];
}

/** Local, unrotated X6 port position. X6 rotates the complete node later. */
export function getPinPosition(pin: PinDefinition, node: SchematicNode): Point {
  if (node.kind === "nmos4" || node.kind === "pmos4") {
    const terminalX = node.width - 10;
    let x = pin.id === "G" ? 0 : terminalX;
    let y = node.height / 2;
    if (pin.side === "top") y = 0;
    if (pin.side === "bottom") y = node.height;
    if (node.mirrored) x = node.width - x;
    return { x, y };
  }
  let x = node.width / 2;
  let y = node.height / 2;
  if (pin.side === "left") x = 0;
  if (pin.side === "right") x = node.width;
  if (pin.side === "top") y = 0;
  if (pin.side === "bottom") y = node.height;
  if (node.kind === "junction") {
    x = node.width / 2;
    y = node.height / 2;
  } else {
    const definition = getDeviceDefinition(node.kind);
    const sameSidePins = definition.pins.filter((candidate) => candidate.side === pin.side);
    const sideIndex = sameSidePins.findIndex((candidate) => candidate.id === pin.id);
    const fraction = sameSidePins.length > 1 && sideIndex >= 0
      ? (sideIndex + 1) / (sameSidePins.length + 1)
      : 0.5;
    if (pin.side === "left" || pin.side === "right") y = node.height * fraction;
    if (pin.side === "top" || pin.side === "bottom") x = node.width * fraction;
  }
  if (node.mirrored) x = node.width - x;
  return { x, y };
}

/**
 * Return the placement-origin offset from X6's unrotated bounding-box position.
 * X6 rotates nodes clockwise around the box centre, so the origin must follow
 * the same transform. MOS symbols deliberately use the Gate terminal as origin.
 */
export function getNodeOriginOffset(node: SchematicNode): Point {
  const definition = getDeviceDefinition(node.kind);
  if (!definition.originPortId) return { x: 0, y: 0 };
  const originPin = definition.pins.find((pin) => pin.id === definition.originPortId);
  if (!originPin) return { x: 0, y: 0 };

  const local = getPinPosition(originPin, node);
  const centre = { x: node.width / 2, y: node.height / 2 };
  const dx = local.x - centre.x;
  const dy = local.y - centre.y;
  if (node.rotation === 90) return { x: centre.x - dy, y: centre.y + dx };
  if (node.rotation === 180) return { x: centre.x - dx, y: centre.y - dy };
  if (node.rotation === 270) return { x: centre.x + dy, y: centre.y - dx };
  return local;
}

/** Convert document origin coordinates to X6's bounding-box position. */
export function documentOriginToCanvasPosition(node: SchematicNode): Point {
  const offset = getNodeOriginOffset(node);
  return { x: node.x - offset.x, y: node.y - offset.y };
}

/** Convert X6's bounding-box position back to document origin coordinates. */
export function canvasPositionToDocumentOrigin(node: SchematicNode, position: Point): Point {
  const offset = getNodeOriginOffset(node);
  return { x: position.x + offset.x, y: position.y + offset.y };
}

/** Resolve a semantic pin to its exact world position after mirror and rotation. */
export function getPinWorldPosition(node: SchematicNode, portId: string): Point | null {
  const definition = getDeviceDefinition(node.kind);
  const pin = definition.pins.find((candidate) => candidate.id === portId);
  if (!pin) return null;

  const local = getPinPosition(pin, node);
  const box = documentOriginToCanvasPosition(node);
  const centre = { x: node.width / 2, y: node.height / 2 };
  const dx = local.x - centre.x;
  const dy = local.y - centre.y;
  let rotated = { x: dx, y: dy };
  if (node.rotation === 90) rotated = { x: -dy, y: dx };
  if (node.rotation === 180) rotated = { x: -dx, y: -dy };
  if (node.rotation === 270) rotated = { x: dy, y: -dx };
  return {
    x: snapToElectricalGrid(box.x + centre.x + rotated.x),
    y: snapToElectricalGrid(box.y + centre.y + rotated.y),
  };
}

/** One persisted orthogonal corner for newly completed wires. */
export function orthogonalWireVertices(source: Point, target: Point): Point[] {
  const snappedSource = {
    x: snapToElectricalGrid(source.x),
    y: snapToElectricalGrid(source.y),
  };
  const snappedTarget = {
    x: snapToElectricalGrid(target.x),
    y: snapToElectricalGrid(target.y),
  };
  if (snappedSource.x === snappedTarget.x || snappedSource.y === snappedTarget.y) return [];
  return [{ x: snappedTarget.x, y: snappedSource.y }];
}

/**
 * Snap electrical coordinates while preserving only approved import geometry.
 * Ordinary documents still canonicalize to the library symbol size so legacy
 * migrations and hand-edited drawings remain deterministic.
 */
export function normalizeSchematicGeometry(document: SchematicDocument): SchematicDocument {
  return {
    ...document,
    snapGrid: Math.max(1, Math.round(document.snapGrid)),
    displayGrid: Math.max(1, Math.round(document.displayGrid)),
    nodes: document.nodes.map((node) => {
      const definition = getDeviceDefinition(node.kind);
      const keepExplicitSize = node.properties.cadenceVisualScale === "mos_readable";
      return {
        ...node,
        x: snapToElectricalGrid(node.x),
        y: snapToElectricalGrid(node.y),
        width: keepExplicitSize ? node.width : definition.width,
        height: keepExplicitSize ? node.height : definition.height,
      };
    }),
    edges: document.edges.map((edge) => ({
      ...edge,
      source: isEdgeTerminal(edge.source)
        ? edge.source
        : {
            x: snapToElectricalGrid(edge.source.x),
            y: snapToElectricalGrid(edge.source.y),
          },
      target: isEdgeTerminal(edge.target)
        ? edge.target
        : {
            x: snapToElectricalGrid(edge.target.x),
            y: snapToElectricalGrid(edge.target.y),
          },
      ...(edge.vertices
        ? {
            vertices: edge.vertices.map((point) => ({
              x: snapToElectricalGrid(point.x),
              y: snapToElectricalGrid(point.y),
            })),
          }
        : {}),
    })),
    explicitJunctions: document.explicitJunctions.map((junction) => ({
      ...junction,
      point: {
        x: snapToElectricalGrid(junction.point.x),
        y: snapToElectricalGrid(junction.point.y),
      },
    })),
    netLabels: document.netLabels.map((label) => ({
      ...label,
      segmentIndex: Math.max(0, Math.round(label.segmentIndex)),
      anchorPoint: {
        x: snapToElectricalGrid(label.anchorPoint.x),
        y: snapToElectricalGrid(label.anchorPoint.y),
      },
    })),
    noConnects: document.noConnects.map((noConnect) => ({
      ...noConnect,
      position: {
        x: snapToElectricalGrid(noConnect.position.x),
        y: snapToElectricalGrid(noConnect.position.y),
      },
    })),
    notes: document.notes.map((note) => ({
      ...note,
      anchorPoint: {
        x: snapToElectricalGrid(note.anchorPoint.x),
        y: snapToElectricalGrid(note.anchorPoint.y),
      },
    })),
  };
}

function nextNumberForPrefix(prefix: string, nodes: readonly SchematicNode[]): number {
  const used = new Set(nodes.map((node) => node.instanceName.trim().toUpperCase()));
  let index = 1;
  while (used.has(`${prefix}${index}`.toUpperCase())) index += 1;
  return index;
}

function nextNodeId(kind: DeviceKind, nodes: readonly SchematicNode[]): string {
  const used = new Set(nodes.map((node) => node.id));
  let index = 1;
  while (used.has(`${kind}_${index}`)) index += 1;
  return `${kind}_${index}`;
}

export function createDeviceNode(
  kind: DeviceKind,
  x: number,
  y: number,
  existingNodes: readonly SchematicNode[] = [],
): SchematicNode {
  const definition = getDeviceDefinition(kind);
  const sequence = nextNumberForPrefix(definition.prefix, existingNodes);
  const properties = { ...definition.defaults };

  if (kind === "input" && sequence > 1) properties.netName = `VIN${sequence}`;
  if (kind === "output" && sequence > 1) properties.netName = `VOUT${sequence}`;
  if (kind === "bidir" && sequence > 1) properties.netName = `IO${sequence}`;
  if (kind === "netlabel" && sequence > 1) properties.netName = `NET${sequence}`;

  let instanceName = `${definition.prefix}${sequence}`;
  if (kind === "vdd") instanceName = "VDD";
  if (kind === "gnd") instanceName = "0";
  if (kind === "junction") instanceName = `J${sequence}`;

  return {
    id: nextNodeId(kind, existingNodes),
    kind,
    x: snapToElectricalGrid(x),
    y: snapToElectricalGrid(y),
    width: definition.width,
    height: definition.height,
    rotation: 0,
    mirrored: false,
    instanceName,
    properties,
  };
}

export function createEmptyDocument(
  project = "analog-studio",
  cell = "untitled",
): SchematicDocument {
  return {
    version: 3,
    formatVersion: 1,
    editorProfile: "VSE-Core-1",
    id: `cellview:${project}:${cell}:schematic`,
    library: "work",
    project,
    cell,
    view: "schematic",
    sheetId: "sheet-1",
    units: { userUnit: "um", dbuPerUserUnit: 1_000 },
    snapGrid: ELECTRICAL_GRID_SIZE,
    displayGrid: VISUAL_GRID_SIZE,
    nodes: [],
    edges: [],
    explicitJunctions: [],
    netLabels: [],
    noConnects: [],
    notes: [],
    markers: [],
    properties: {},
    revisions: {
      designRevision: 0,
      savedRevision: 0,
      connectivityRevision: 0,
      checkRevision: 0,
    },
  };
}

export function withDesignRevision(
  document: SchematicDocument,
  connectivityAffected = true,
): SchematicDocument {
  const designRevision = document.revisions.designRevision + 1;
  const connectivityWasCurrent = document.revisions.connectivityRevision
    === document.revisions.designRevision;
  const checkWasCurrent = document.revisions.checkRevision
    === document.revisions.designRevision;
  return {
    ...document,
    revisions: {
      ...document.revisions,
      designRevision,
      connectivityRevision: !connectivityAffected && connectivityWasCurrent
        ? designRevision
        : document.revisions.connectivityRevision,
      checkRevision: !connectivityAffected && checkWasCurrent
        ? designRevision
        : document.revisions.checkRevision,
    },
  };
}

export function withSavedRevision(document: SchematicDocument): SchematicDocument {
  return {
    ...document,
    revisions: {
      ...document.revisions,
      savedRevision: document.revisions.designRevision,
    },
  };
}

export function withCheckedRevision(document: SchematicDocument): SchematicDocument {
  return {
    ...document,
    revisions: {
      ...document.revisions,
      connectivityRevision: document.revisions.designRevision,
      checkRevision: document.revisions.designRevision,
    },
  };
}

/** Return a new document, preserving undo-friendly immutable semantics. */
export function updateNodeProperties(
  document: SchematicDocument,
  nodeId: string,
  patch: NodePropertyPatch,
): SchematicDocument {
  let found = false;
  const nodes = document.nodes.map((node) => {
    if (node.id !== nodeId) return node;
    found = true;
    return {
      ...node,
      ...patch,
      properties: patch.properties
        ? { ...node.properties, ...patch.properties }
        : node.properties,
    };
  });

  return found ? { ...document, nodes } : document;
}

function withNodePatch(node: SchematicNode, patch: NodePropertyPatch): SchematicNode {
  return {
    ...node,
    ...patch,
    properties: patch.properties
      ? { ...node.properties, ...patch.properties }
      : node.properties,
  };
}

/** A fully connected CMOS inverter used as the first-run editable example. */
export function createDemoDocument(): SchematicDocument {
  const nodes: SchematicNode[] = [];
  const add = (kind: DeviceKind, x: number, y: number, patch?: NodePropertyPatch) => {
    const created = createDeviceNode(kind, x, y, nodes);
    const node = patch ? withNodePatch(created, patch) : created;
    nodes.push(node);
    return node;
  };

  const input = add("input", 80, 240, {
    instanceName: "VIN",
    properties: { netName: "VIN" },
  });
  const output = add("output", 650, 240, {
    instanceName: "VOUT",
    properties: { netName: "VOUT" },
  });
  const vdd = add("vdd", 380, 40);
  const gnd = add("gnd", 380, 450);
  // MOS coordinates are their Gate origins; these values preserve the
  // original example's visual bounding-box positions after the v1 migration.
  const pmos = add("pmos4", 370, 185, {
    instanceName: "M2",
    properties: { model: "pmos", W: "20u", L: "180n", M: "1", NF: "1" },
  });
  const nmos = add("nmos4", 370, 335, {
    instanceName: "M1",
    properties: { model: "nmos", W: "10u", L: "180n", M: "1", NF: "1" },
  });

  const terminal = (node: SchematicNode, portId: string): EdgeTerminal => ({
    nodeId: node.id,
    portId,
  });
  const edge = (
    id: string,
    source: WireEndpoint,
    target: WireEndpoint,
    creationOrder: number,
  ): SchematicEdge => {
    const sourcePoint = isEdgeTerminal(source)
      ? getPinWorldPosition(nodes.find((node) => node.id === source.nodeId)!, source.portId)!
      : source;
    const targetPoint = isEdgeTerminal(target)
      ? getPinWorldPosition(nodes.find((node) => node.id === target.nodeId)!, target.portId)!
      : target;
    const vertices = orthogonalWireVertices(sourcePoint, targetPoint);
    return {
      id,
      source,
      target,
      ...(vertices.length ? { vertices } : {}),
      style: "NORMAL",
      width: 1,
      creationOrder,
    };
  };

  // Branches are represented by exact endpoint-on-segment geometry. This is
  // the canonical VSE model: no fake one-pin "junction device" is needed for
  // ordinary T connections.
  const edges = [
    edge("wire_01", terminal(input, "P"), { x: 370, y: 260 }, 1),
    edge("wire_02", terminal(pmos, "G"), terminal(nmos, "G"), 2),
    edge("wire_03", { x: 410, y: 260 }, terminal(output, "P"), 3),
    edge("wire_04", terminal(pmos, "D"), terminal(nmos, "D"), 4),
    edge("wire_05", terminal(vdd, "P"), terminal(pmos, "B"), 5),
    edge("wire_06", terminal(nmos, "B"), terminal(gnd, "P"), 6),
  ];

  return {
    ...createEmptyDocument("demo1_260711", "cmos_inverter"),
    nodes,
    edges,
  };
}
