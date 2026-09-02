import {
  createDeviceNode,
  getPinWorldPosition,
  isEdgeTerminal,
  orthogonalWireVertices,
  snapToElectricalGrid,
  withDesignRevision,
  type DeviceKind,
  type EdgeTerminal,
  type NetLabel,
  type Point,
  type SchematicDocument,
  type SchematicEdge,
  type SchematicNode,
  type WireEndpoint,
} from "./schematic";

export type SubcircuitTemplateKind =
  | "transmission_gate_cmos"
  | "sample_hold_cmos"
  | "cdac_bit_slice_cmos"
  | "strongarm_comparator_cmos"
  | "nmos_diff_pair_cmos"
  | "pmos_current_mirror_cmos"
  | "ota_5t_cmos";

export type SubcircuitPreviewKind =
  | "transmission-gate"
  | "sample-hold"
  | "cdac-bit"
  | "strongarm"
  | "diff-pair"
  | "mirror"
  | "ota";

export interface SubcircuitTemplateDefinition {
  kind: SubcircuitTemplateKind;
  label: string;
  shortLabel: string;
  family: "adc" | "opamp" | "comparator";
  hint: string;
  description: string;
  preview: SubcircuitPreviewKind;
  width: number;
  height: number;
  instanceStem: string;
}

export interface PlacedSubcircuitTemplateRecord {
  kind: SubcircuitTemplateKind;
  label: string;
  instanceName: string;
  flattened: true;
  editable: true;
  anchor: Point;
  nodeIds: string[];
  edgeIds: string[];
  netLabelIds: string[];
  noteIds: string[];
}

export const SUBCIRCUIT_TEMPLATES: readonly SubcircuitTemplateDefinition[] = [
  {
    kind: "transmission_gate_cmos",
    label: "传输门 MOS 级",
    shortLabel: "TG",
    family: "adc",
    hint: "NMOS+PMOS 并联开关",
    description: "CMOS transmission gate with CLK/CLKB control, flattened to editable NMOS and PMOS devices.",
    preview: "transmission-gate",
    width: 360,
    height: 230,
    instanceStem: "XTG",
  },
  {
    kind: "sample_hold_cmos",
    label: "采样保持 MOS 级",
    shortLabel: "S/H",
    family: "adc",
    hint: "传输门 + 保持电容",
    description: "Track/hold front end composed of a CMOS transmission gate and a hold capacitor.",
    preview: "sample-hold",
    width: 430,
    height: 250,
    instanceStem: "XSH",
  },
  {
    kind: "cdac_bit_slice_cmos",
    label: "CDAC bit slice MOS 级",
    shortLabel: "CDAC",
    family: "adc",
    hint: "单位电容 + 参考开关",
    description: "One SAR CDAC bit slice with unit capacitor and VREFP/VREFN/VCM CMOS switch network.",
    preview: "cdac-bit",
    width: 580,
    height: 390,
    instanceStem: "XCDAC",
  },
  {
    kind: "strongarm_comparator_cmos",
    label: "StrongARM 比较器",
    shortLabel: "CMP",
    family: "comparator",
    hint: "尾管、差分对、再生锁存",
    description: "Clocked dynamic comparator seed: tail device, differential input pair, precharge and cross-coupled latch.",
    preview: "strongarm",
    width: 610,
    height: 440,
    instanceStem: "XCMP",
  },
  {
    kind: "nmos_diff_pair_cmos",
    label: "NMOS 差分对",
    shortLabel: "DIFF",
    family: "opamp",
    hint: "输入对 + 尾电流管",
    description: "Editable NMOS differential input pair with a tail current device and named drain outputs.",
    preview: "diff-pair",
    width: 430,
    height: 290,
    instanceStem: "XDP",
  },
  {
    kind: "pmos_current_mirror_cmos",
    label: "PMOS 电流镜",
    shortLabel: "MIR",
    family: "opamp",
    hint: "二极管连接 + 输出支路",
    description: "Editable PMOS current mirror seed with reference and mirrored output branches.",
    preview: "mirror",
    width: 390,
    height: 250,
    instanceStem: "XPMIR",
  },
  {
    kind: "ota_5t_cmos",
    label: "5T OTA MOS 级",
    shortLabel: "OTA",
    family: "opamp",
    hint: "差分对 + PMOS 镜像负载",
    description: "Five-transistor OTA seed with NMOS input pair, PMOS mirror load and NMOS tail bias.",
    preview: "ota",
    width: 570,
    height: 390,
    instanceStem: "XOTA",
  },
];

const TEMPLATE_BY_KIND = new Map(SUBCIRCUIT_TEMPLATES.map((template) => [template.kind, template]));
const GLOBAL_NETS = new Set(["0", "VDD", "VSS", "GND"]);

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en", { numeric: true, sensitivity: "base" });
}

function cleanIdentifier(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const replaced = trimmed.replace(/[^A-Za-z0-9_.$!]/g, "_");
  return /^[A-Za-z_]/.test(replaced) ? replaced : `_${replaced}`;
}

function nextTemplateInstanceName(document: SchematicDocument, stem: string): string {
  const used = new Set<string>();
  for (const node of document.nodes) {
    const instance = node.properties.templateInstance;
    if (instance) used.add(instance.toUpperCase());
  }
  const records = (document.extensions?.subcircuitTemplates ?? []) as Array<{ instanceName?: unknown }>;
  for (const record of records) {
    if (typeof record.instanceName === "string") used.add(record.instanceName.toUpperCase());
  }
  let index = 1;
  while (used.has(`${stem}${index}`.toUpperCase())) index += 1;
  return `${stem}${index}`;
}

function uniqueId(prefix: string, existing: Iterable<string>): string {
  const used = new Set(existing);
  let index = 1;
  while (used.has(`${prefix}_${index}`)) index += 1;
  return `${prefix}_${index}`;
}

function midpoint(left: Point, right: Point): Point {
  return {
    x: snapToElectricalGrid((left.x + right.x) / 2),
    y: snapToElectricalGrid((left.y + right.y) / 2),
  };
}

class TemplateBuilder {
  readonly definition: SubcircuitTemplateDefinition;
  readonly instanceName: string;
  private readonly anchor: Point;
  private readonly base: SchematicDocument;
  private readonly nodes: SchematicNode[] = [];
  private readonly edges: SchematicEdge[] = [];
  private readonly netLabels: NetLabel[] = [];
  private readonly explicitJunctions: SchematicDocument["explicitJunctions"] = [];
  private readonly notes: SchematicDocument["notes"] = [];
  private readonly scopedSignals: boolean;

  constructor(
    base: SchematicDocument,
    definition: SubcircuitTemplateDefinition,
    anchor: Point,
    scopedSignals = true,
  ) {
    this.base = base;
    this.definition = definition;
    this.anchor = {
      x: snapToElectricalGrid(anchor.x),
      y: snapToElectricalGrid(anchor.y),
    };
    this.scopedSignals = scopedSignals;
    this.instanceName = nextTemplateInstanceName(base, definition.instanceStem);
  }

  finish(): SchematicDocument {
    const existingRecords = Array.isArray(this.base.extensions?.subcircuitTemplates)
      ? this.base.extensions?.subcircuitTemplates as PlacedSubcircuitTemplateRecord[]
      : [];
    const record: PlacedSubcircuitTemplateRecord = {
      kind: this.definition.kind,
      label: this.definition.label,
      instanceName: this.instanceName,
      flattened: true,
      editable: true,
      anchor: this.anchor,
      nodeIds: this.nodes.map((node) => node.id),
      edgeIds: this.edges.map((edge) => edge.id),
      netLabelIds: this.netLabels.map((label) => label.id),
      noteIds: this.notes.map((note) => note.id),
    };
    return withDesignRevision({
      ...this.base,
      nodes: [...this.base.nodes, ...this.nodes]
        .sort((left, right) => compareText(left.id, right.id)),
      edges: [...this.base.edges, ...this.edges]
        .sort((left, right) => compareText(left.id, right.id)),
      explicitJunctions: [...this.base.explicitJunctions, ...this.explicitJunctions]
        .sort((left, right) => compareText(left.id, right.id)),
      netLabels: [...this.base.netLabels, ...this.netLabels]
        .sort((left, right) => compareText(left.id, right.id)),
      notes: [...this.base.notes, ...this.notes]
        .sort((left, right) => compareText(left.id, right.id)),
      extensions: {
        ...this.base.extensions,
        subcircuitTemplates: [...existingRecords, record],
      },
    }, true);
  }

  local(x: number, y: number): Point {
    return {
      x: snapToElectricalGrid(this.anchor.x + x),
      y: snapToElectricalGrid(this.anchor.y + y),
    };
  }

  signal(name: string): string {
    const normalized = name.trim().toUpperCase();
    if (GLOBAL_NETS.has(normalized)) return normalized === "GND" || normalized === "VSS" ? "0" : normalized;
    if (!this.scopedSignals) return cleanIdentifier(name.toUpperCase(), "NET");
    return cleanIdentifier(`${this.instanceName}_${name.toUpperCase()}`, `${this.instanceName}_NET`);
  }

  addDevice(
    kind: DeviceKind,
    x: number,
    y: number,
    options: {
      name?: string;
      role: string;
      properties?: Record<string, string>;
      rotation?: SchematicNode["rotation"];
      mirrored?: boolean;
    },
  ): SchematicNode {
    const point = this.local(x, y);
    const seed = createDeviceNode(kind, point.x, point.y, [...this.base.nodes, ...this.nodes]);
    const name = options.name
      ? cleanIdentifier(options.name, seed.instanceName)
      : seed.instanceName;
    const node: SchematicNode = {
      ...seed,
      instanceName: name,
      rotation: options.rotation ?? seed.rotation,
      mirrored: options.mirrored ?? seed.mirrored,
      properties: {
        ...seed.properties,
        templateKind: this.definition.kind,
        templateLabel: this.definition.label,
        templateInstance: this.instanceName,
        templateRole: options.role,
        editablePrimitive: "true",
        ...(options.properties ?? {}),
      },
    };
    this.nodes.push(node);
    return node;
  }

  addPort(kind: "input" | "output" | "bidir", x: number, y: number, signal: string, role: string): SchematicNode {
    const netName = this.signal(signal);
    return this.addDevice(kind, x, y, {
      name: `${kind.toUpperCase()}_${netName}`,
      role,
      properties: { netName },
    });
  }

  addSupply(kind: "vdd" | "gnd", x: number, y: number, role: string): SchematicNode {
    return this.addDevice(kind, x, y, {
      name: kind === "vdd" ? "VDD" : "0",
      role,
      properties: { netName: kind === "vdd" ? "VDD" : "0" },
    });
  }

  terminal(node: SchematicNode, portId: string): EdgeTerminal {
    return { nodeId: node.id, portId };
  }

  addWire(
    source: WireEndpoint,
    target: WireEndpoint,
    labelText?: string,
    style: SchematicEdge["style"] = "NORMAL",
  ): SchematicEdge {
    const sourcePoint = this.endpointPoint(source);
    const targetPoint = this.endpointPoint(target);
    const edgeId = uniqueId(`${this.instanceName}_W`, [
      ...this.base.edges.map((edge) => edge.id),
      ...this.edges.map((edge) => edge.id),
    ]);
    const vertices = orthogonalWireVertices(sourcePoint, targetPoint);
    const edge: SchematicEdge = {
      id: edgeId,
      source,
      target,
      ...(vertices.length ? { vertices } : {}),
      style,
      width: 1,
      creationOrder: this.base.edges.length + this.edges.length + 1,
    };
    this.edges.push(edge);
    if (labelText) this.addNetLabel(edge, labelText, sourcePoint, vertices[0] ?? targetPoint);
    if (labelText && !isEdgeTerminal(source)) this.addJunction(source);
    if (labelText && !isEdgeTerminal(target)) this.addJunction(target);
    return edge;
  }

  labelTerminal(node: SchematicNode, portId: string, signal: string, offset: Point): SchematicEdge {
    const pin = getPinWorldPosition(node, portId);
    if (!pin) throw new Error(`Cannot resolve ${node.id}.${portId}`);
    const target = {
      x: snapToElectricalGrid(pin.x + offset.x),
      y: snapToElectricalGrid(pin.y + offset.y),
    };
    const netName = this.signal(signal);
    const wire = this.addWire(this.terminal(node, portId), target, netName);
    return wire;
  }

  connectTerminals(
    sourceNode: SchematicNode,
    sourcePort: string,
    targetNode: SchematicNode,
    targetPort: string,
  ): SchematicEdge {
    return this.addWire(this.terminal(sourceNode, sourcePort), this.terminal(targetNode, targetPort));
  }

  addNote(text: string, x: number, y: number): void {
    const noteId = uniqueId(`${this.instanceName}_NOTE`, [
      ...this.base.notes.map((note) => note.id),
      ...this.notes.map((note) => note.id),
    ]);
    this.notes.push({
      id: noteId,
      text,
      anchorPoint: this.local(x, y),
      orientation: 0,
    });
  }

  private endpointPoint(endpoint: WireEndpoint): Point {
    if (!isEdgeTerminal(endpoint)) {
      return {
        x: snapToElectricalGrid(endpoint.x),
        y: snapToElectricalGrid(endpoint.y),
      };
    }
    const node = this.nodes.find((candidate) => candidate.id === endpoint.nodeId)
      ?? this.base.nodes.find((candidate) => candidate.id === endpoint.nodeId);
    if (!node) throw new Error(`Cannot resolve endpoint node ${endpoint.nodeId}`);
    const point = getPinWorldPosition(node, endpoint.portId);
    if (!point) throw new Error(`Cannot resolve endpoint port ${endpoint.nodeId}.${endpoint.portId}`);
    return point;
  }

  private addJunction(point: Point): void {
    const key = `${point.x},${point.y}`;
    const exists = [...this.base.explicitJunctions, ...this.explicitJunctions]
      .some((junction) => `${junction.point.x},${junction.point.y}` === key);
    if (exists) return;
    const id = uniqueId(`${this.instanceName}_J`, [
      ...this.base.explicitJunctions.map((junction) => junction.id),
      ...this.explicitJunctions.map((junction) => junction.id),
    ]);
    this.explicitJunctions.push({ id, point });
  }

  private addNetLabel(edge: SchematicEdge, text: string, segmentStart: Point, segmentEnd: Point): void {
    const labelId = uniqueId(`${this.instanceName}_NL`, [
      ...this.base.netLabels.map((label) => label.id),
      ...this.netLabels.map((label) => label.id),
    ]);
    this.netLabels.push({
      id: labelId,
      text,
      wireId: edge.id,
      segmentIndex: 0,
      anchorPoint: midpoint(segmentStart, segmentEnd),
      orientation: 0,
      textAlignment: "start",
    });
  }
}

function mosName(builder: TemplateBuilder, suffix: string): string {
  return `M${builder.instanceName}_${suffix}`;
}

function capName(builder: TemplateBuilder, suffix: string): string {
  return `C${builder.instanceName}_${suffix}`;
}

function addTransmissionGateDevices(builder: TemplateBuilder, x: number, y: number, prefix: string) {
  const mn = builder.addDevice("nmos4", x, y + 28, {
    name: mosName(builder, `${prefix}_N`),
    role: `${prefix.toLowerCase()}_nmos_pass`,
    properties: { model: "nmos", W: "8u", L: "180n", M: "1", NF: "4" },
  });
  const mp = builder.addDevice("pmos4", x, y - 48, {
    name: mosName(builder, `${prefix}_P`),
    role: `${prefix.toLowerCase()}_pmos_pass`,
    properties: { model: "pmos", W: "16u", L: "180n", M: "1", NF: "4" },
  });
  return { mn, mp };
}

function connectTransmissionGate(
  builder: TemplateBuilder,
  devices: ReturnType<typeof addTransmissionGateDevices>,
  sourceNet: string,
  drainNet: string,
  clkNet: string,
  clkbNet: string,
) {
  builder.labelTerminal(devices.mn, "D", sourceNet, { x: -36, y: 0 });
  builder.labelTerminal(devices.mp, "D", sourceNet, { x: -36, y: 0 });
  builder.labelTerminal(devices.mn, "S", drainNet, { x: 36, y: 0 });
  builder.labelTerminal(devices.mp, "S", drainNet, { x: 36, y: 0 });
  builder.labelTerminal(devices.mn, "G", clkNet, { x: -32, y: 0 });
  builder.labelTerminal(devices.mp, "G", clkbNet, { x: -32, y: 0 });
  builder.labelTerminal(devices.mn, "B", "0", { x: 32, y: 0 });
  builder.labelTerminal(devices.mp, "B", "VDD", { x: 32, y: 0 });
}

function buildTransmissionGate(builder: TemplateBuilder) {
  const input = builder.addPort("input", -205, -20, "IN", "external_input");
  const output = builder.addPort("output", 185, -20, "OUT", "external_output");
  const clk = builder.addPort("input", -40, -150, "CLK", "clock_true");
  const clkb = builder.addPort("input", -40, 120, "CLKB", "clock_bar");
  builder.addSupply("vdd", 130, -150, "bulk_supply");
  builder.addSupply("gnd", 130, 120, "bulk_ground");
  const devices = addTransmissionGateDevices(builder, 0, 0, "PASS");
  connectTransmissionGate(builder, devices, "IN", "OUT", "CLK", "CLKB");
  builder.labelTerminal(input, "P", "IN", { x: 32, y: 0 });
  builder.labelTerminal(output, "P", "OUT", { x: -32, y: 0 });
  builder.labelTerminal(clk, "P", "CLK", { x: 32, y: 0 });
  builder.labelTerminal(clkb, "P", "CLKB", { x: 32, y: 0 });
  builder.addNote(`${builder.instanceName} ${builder.definition.label} flattened editable MOS template`, -180, -120);
}

function buildSampleHold(builder: TemplateBuilder) {
  const vin = builder.addPort("input", -230, -20, "VIN", "sample_input");
  const sampled = builder.addPort("output", 215, -20, "SAMPLED", "sampled_output");
  const clk = builder.addPort("input", -70, -150, "CLK", "sample_clock");
  const clkb = builder.addPort("input", -70, 125, "CLKB", "sample_clock_bar");
  builder.addSupply("vdd", 155, -150, "bulk_supply");
  builder.addSupply("gnd", 155, 125, "ground");
  const devices = addTransmissionGateDevices(builder, -20, 0, "SAMPLE");
  connectTransmissionGate(builder, devices, "VIN", "SAMPLED", "CLK", "CLKB");
  const holdCap = builder.addDevice("capacitor", 120, 38, {
    name: capName(builder, "HOLD"),
    role: "hold_capacitor",
    properties: { value: "1p" },
  });
  builder.labelTerminal(vin, "P", "VIN", { x: 32, y: 0 });
  builder.labelTerminal(sampled, "P", "SAMPLED", { x: -32, y: 0 });
  builder.labelTerminal(clk, "P", "CLK", { x: 32, y: 0 });
  builder.labelTerminal(clkb, "P", "CLKB", { x: 32, y: 0 });
  builder.labelTerminal(holdCap, "P", "SAMPLED", { x: -34, y: 0 });
  builder.labelTerminal(holdCap, "N", "0", { x: 34, y: 0 });
  builder.addNote(`${builder.instanceName} track/hold: edit pass MOS W/L and hold capacitor`, -205, -122);
}

function buildCdacBitSlice(builder: TemplateBuilder) {
  const top = builder.addPort("bidir", -285, -120, "TOP", "top_plate");
  const bot = builder.addPort("bidir", -285, 15, "BOT", "bottom_plate");
  const vrefp = builder.addPort("input", 280, -150, "VREFP", "positive_reference");
  const vrefn = builder.addPort("input", 280, -10, "VREFN", "negative_reference");
  const vcm = builder.addPort("input", 280, 130, "VCM", "common_mode_reference");
  const bp = builder.addPort("input", -110, 250, "BP", "vrefp_select");
  const bpb = builder.addPort("input", -15, 250, "BPB", "vrefp_select_bar");
  const bn = builder.addPort("input", 90, 250, "BN", "vrefn_select");
  const bnb = builder.addPort("input", 185, 250, "BNB", "vrefn_select_bar");
  builder.addSupply("vdd", -10, -225, "switch_bulk_supply");
  builder.addSupply("gnd", 105, -225, "switch_bulk_ground");
  const cap = builder.addDevice("capacitor", -120, -94, {
    name: capName(builder, "UNIT"),
    role: "unit_mim_cap",
    properties: { value: "20f" },
  });
  builder.labelTerminal(cap, "P", "TOP", { x: -36, y: 0 });
  builder.labelTerminal(cap, "N", "BOT", { x: 36, y: 0 });
  builder.labelTerminal(top, "P", "TOP", { x: 32, y: 0 });
  builder.labelTerminal(bot, "P", "BOT", { x: 32, y: 0 });
  builder.labelTerminal(vrefp, "P", "VREFP", { x: 32, y: 0 });
  builder.labelTerminal(vrefn, "P", "VREFN", { x: 32, y: 0 });
  builder.labelTerminal(vcm, "P", "VCM", { x: 32, y: 0 });
  builder.labelTerminal(bp, "P", "BP", { x: 32, y: 0 });
  builder.labelTerminal(bpb, "P", "BPB", { x: 32, y: 0 });
  builder.labelTerminal(bn, "P", "BN", { x: 32, y: 0 });
  builder.labelTerminal(bnb, "P", "BNB", { x: 32, y: 0 });

  const refp = addTransmissionGateDevices(builder, 45, -132, "VREFP_SW");
  connectTransmissionGate(builder, refp, "BOT", "VREFP", "BP", "BPB");
  const refn = addTransmissionGateDevices(builder, 45, 8, "VREFN_SW");
  connectTransmissionGate(builder, refn, "BOT", "VREFN", "BN", "BNB");
  const cm = addTransmissionGateDevices(builder, 45, 148, "VCM_SW");
  connectTransmissionGate(builder, cm, "BOT", "VCM", "BNB", "BN");
  builder.addNote(`${builder.instanceName} CDAC bit slice: unit cap plus editable CMOS reference switches`, -265, -205);
}

function buildStrongarmComparator(builder: TemplateBuilder) {
  const inp = builder.addPort("input", -305, 20, "INP", "positive_input");
  const inn = builder.addPort("input", -305, 115, "INN", "negative_input");
  const clk = builder.addPort("input", -305, 205, "CLK", "clock");
  const outp = builder.addPort("output", 305, 15, "OUTP", "positive_output");
  const outn = builder.addPort("output", 305, 115, "OUTN", "negative_output");
  builder.addSupply("vdd", 0, -205, "supply");
  builder.addSupply("gnd", 0, 265, "ground");
  const tail = builder.addDevice("nmos4", 0, 160, {
    name: mosName(builder, "TAIL"),
    role: "clocked_tail_nmos",
    properties: { model: "nmos", W: "24u", L: "180n", M: "1", NF: "8" },
  });
  const mInP = builder.addDevice("nmos4", -80, 70, {
    name: mosName(builder, "INP"),
    role: "input_pair_positive",
    properties: { model: "nmos", W: "12u", L: "180n", M: "1", NF: "6" },
  });
  const mInN = builder.addDevice("nmos4", 80, 70, {
    name: mosName(builder, "INN"),
    role: "input_pair_negative",
    properties: { model: "nmos", W: "12u", L: "180n", M: "1", NF: "6" },
  });
  const pLatchL = builder.addDevice("pmos4", -150, -50, {
    name: mosName(builder, "PLAT_P"),
    role: "cross_coupled_pmos_left",
    properties: { model: "pmos", W: "18u", L: "180n", M: "1", NF: "6" },
  });
  const pLatchR = builder.addDevice("pmos4", 150, -50, {
    name: mosName(builder, "PLAT_N"),
    role: "cross_coupled_pmos_right",
    properties: { model: "pmos", W: "18u", L: "180n", M: "1", NF: "6" },
  });
  const nLatchL = builder.addDevice("nmos4", -150, 62, {
    name: mosName(builder, "NLAT_P"),
    role: "cross_coupled_nmos_left",
    properties: { model: "nmos", W: "10u", L: "180n", M: "1", NF: "4" },
  });
  const nLatchR = builder.addDevice("nmos4", 150, 62, {
    name: mosName(builder, "NLAT_N"),
    role: "cross_coupled_nmos_right",
    properties: { model: "nmos", W: "10u", L: "180n", M: "1", NF: "4" },
  });
  const preP = builder.addDevice("pmos4", -58, -145, {
    name: mosName(builder, "PRE_P"),
    role: "precharge_outp",
    properties: { model: "pmos", W: "10u", L: "180n", M: "1", NF: "4" },
  });
  const preN = builder.addDevice("pmos4", 58, -145, {
    name: mosName(builder, "PRE_N"),
    role: "precharge_outn",
    properties: { model: "pmos", W: "10u", L: "180n", M: "1", NF: "4" },
  });
  builder.labelTerminal(inp, "P", "INP", { x: 32, y: 0 });
  builder.labelTerminal(inn, "P", "INN", { x: 32, y: 0 });
  builder.labelTerminal(clk, "P", "CLK", { x: 32, y: 0 });
  builder.labelTerminal(outp, "P", "OUTP", { x: -32, y: 0 });
  builder.labelTerminal(outn, "P", "OUTN", { x: -32, y: 0 });

  builder.labelTerminal(tail, "D", "TAIL", { x: 0, y: -34 });
  builder.labelTerminal(tail, "G", "CLK", { x: -34, y: 0 });
  builder.labelTerminal(tail, "S", "0", { x: 0, y: 34 });
  builder.labelTerminal(tail, "B", "0", { x: 34, y: 0 });
  builder.labelTerminal(mInP, "D", "OUTN", { x: 0, y: -34 });
  builder.labelTerminal(mInP, "G", "INP", { x: -34, y: 0 });
  builder.labelTerminal(mInP, "S", "TAIL", { x: 0, y: 34 });
  builder.labelTerminal(mInP, "B", "0", { x: 34, y: 0 });
  builder.labelTerminal(mInN, "D", "OUTP", { x: 0, y: -34 });
  builder.labelTerminal(mInN, "G", "INN", { x: -34, y: 0 });
  builder.labelTerminal(mInN, "S", "TAIL", { x: 0, y: 34 });
  builder.labelTerminal(mInN, "B", "0", { x: 34, y: 0 });

  for (const pmos of [pLatchL, pLatchR, preP, preN]) {
    builder.labelTerminal(pmos, "S", "VDD", { x: 0, y: -34 });
    builder.labelTerminal(pmos, "B", "VDD", { x: 34, y: 0 });
  }
  builder.labelTerminal(pLatchL, "D", "OUTP", { x: 0, y: 34 });
  builder.labelTerminal(pLatchL, "G", "OUTN", { x: -34, y: 0 });
  builder.labelTerminal(pLatchR, "D", "OUTN", { x: 0, y: 34 });
  builder.labelTerminal(pLatchR, "G", "OUTP", { x: -34, y: 0 });
  builder.labelTerminal(preP, "D", "OUTP", { x: 0, y: 34 });
  builder.labelTerminal(preP, "G", "CLK", { x: -34, y: 0 });
  builder.labelTerminal(preN, "D", "OUTN", { x: 0, y: 34 });
  builder.labelTerminal(preN, "G", "CLK", { x: -34, y: 0 });
  for (const nmos of [nLatchL, nLatchR]) {
    builder.labelTerminal(nmos, "S", "0", { x: 0, y: 34 });
    builder.labelTerminal(nmos, "B", "0", { x: 34, y: 0 });
  }
  builder.labelTerminal(nLatchL, "D", "OUTP", { x: 0, y: -34 });
  builder.labelTerminal(nLatchL, "G", "OUTN", { x: -34, y: 0 });
  builder.labelTerminal(nLatchR, "D", "OUTN", { x: 0, y: -34 });
  builder.labelTerminal(nLatchR, "G", "OUTP", { x: -34, y: 0 });
  builder.addNote(`${builder.instanceName} StrongARM: editable tail/input/precharge/cross-coupled MOS devices`, -280, -175);
}

function buildNmosDiffPair(builder: TemplateBuilder) {
  const inp = builder.addPort("input", -225, -25, "INP", "positive_input");
  const inn = builder.addPort("input", -225, 75, "INN", "negative_input");
  const outp = builder.addPort("output", 220, -55, "OUTP", "positive_drain_output");
  const outn = builder.addPort("output", 220, 55, "OUTN", "negative_drain_output");
  const bias = builder.addPort("input", -225, 165, "IBIAS", "tail_bias");
  builder.addSupply("gnd", 20, 210, "ground");
  const mnP = builder.addDevice("nmos4", -60, 30, {
    name: mosName(builder, "DIFFP"),
    role: "positive_input_nmos",
    properties: { model: "nmos", W: "12u", L: "180n", M: "1", NF: "6" },
  });
  const mnN = builder.addDevice("nmos4", 60, 30, {
    name: mosName(builder, "DIFFN"),
    role: "negative_input_nmos",
    properties: { model: "nmos", W: "12u", L: "180n", M: "1", NF: "6" },
  });
  const tail = builder.addDevice("nmos4", 0, 140, {
    name: mosName(builder, "TAIL"),
    role: "tail_current_nmos",
    properties: { model: "nmos", W: "16u", L: "180n", M: "1", NF: "8" },
  });
  builder.labelTerminal(inp, "P", "INP", { x: 32, y: 0 });
  builder.labelTerminal(inn, "P", "INN", { x: 32, y: 0 });
  builder.labelTerminal(outp, "P", "OUTP", { x: -32, y: 0 });
  builder.labelTerminal(outn, "P", "OUTN", { x: -32, y: 0 });
  builder.labelTerminal(bias, "P", "IBIAS", { x: 32, y: 0 });
  builder.labelTerminal(mnP, "D", "OUTP", { x: 0, y: -34 });
  builder.labelTerminal(mnP, "G", "INP", { x: -34, y: 0 });
  builder.labelTerminal(mnP, "S", "TAIL", { x: 0, y: 34 });
  builder.labelTerminal(mnP, "B", "0", { x: 34, y: 0 });
  builder.labelTerminal(mnN, "D", "OUTN", { x: 0, y: -34 });
  builder.labelTerminal(mnN, "G", "INN", { x: -34, y: 0 });
  builder.labelTerminal(mnN, "S", "TAIL", { x: 0, y: 34 });
  builder.labelTerminal(mnN, "B", "0", { x: 34, y: 0 });
  builder.labelTerminal(tail, "D", "TAIL", { x: 0, y: -34 });
  builder.labelTerminal(tail, "G", "IBIAS", { x: -34, y: 0 });
  builder.labelTerminal(tail, "S", "0", { x: 0, y: 34 });
  builder.labelTerminal(tail, "B", "0", { x: 34, y: 0 });
  builder.addNote(`${builder.instanceName} NMOS differential pair flattened for W/L/tail-bias editing`, -205, -105);
}

function buildPmosCurrentMirror(builder: TemplateBuilder) {
  const iref = builder.addPort("input", -210, 35, "IREF", "reference_branch");
  const iout = builder.addPort("output", 205, 35, "IOUT", "mirror_output");
  builder.addSupply("vdd", 0, -155, "supply");
  const ref = builder.addDevice("pmos4", -65, -40, {
    name: mosName(builder, "REF"),
    role: "diode_connected_pmos",
    properties: { model: "pmos", W: "12u", L: "180n", M: "1", NF: "4" },
  });
  const out = builder.addDevice("pmos4", 95, -40, {
    name: mosName(builder, "OUT"),
    role: "mirrored_pmos",
    properties: { model: "pmos", W: "12u", L: "180n", M: "1", NF: "4" },
  });
  builder.labelTerminal(iref, "P", "IREF", { x: 32, y: 0 });
  builder.labelTerminal(iout, "P", "IOUT", { x: -32, y: 0 });
  builder.labelTerminal(ref, "S", "VDD", { x: 0, y: -34 });
  builder.labelTerminal(ref, "B", "VDD", { x: 34, y: 0 });
  builder.labelTerminal(ref, "D", "IREF", { x: 0, y: 34 });
  builder.labelTerminal(ref, "G", "IREF", { x: -34, y: 0 });
  builder.labelTerminal(out, "S", "VDD", { x: 0, y: -34 });
  builder.labelTerminal(out, "B", "VDD", { x: 34, y: 0 });
  builder.labelTerminal(out, "D", "IOUT", { x: 0, y: 34 });
  builder.labelTerminal(out, "G", "IREF", { x: -34, y: 0 });
  builder.addNote(`${builder.instanceName} PMOS mirror: edit ratio by changing M/W/NF on reference and output devices`, -190, -115);
}

function buildOta5t(builder: TemplateBuilder) {
  const inp = builder.addPort("input", -285, 30, "VINP", "positive_input");
  const inn = builder.addPort("input", -285, 120, "VINN", "negative_input");
  const ibias = builder.addPort("input", -285, 210, "IBIAS", "tail_bias");
  const out = builder.addPort("output", 285, 70, "VOUT", "single_ended_output");
  builder.addSupply("vdd", 0, -215, "supply");
  builder.addSupply("gnd", 0, 265, "ground");
  const mpRef = builder.addDevice("pmos4", -85, -95, {
    name: mosName(builder, "PLOAD_REF"),
    role: "pmos_mirror_reference_load",
    properties: { model: "pmos", W: "18u", L: "180n", M: "1", NF: "6" },
  });
  const mpOut = builder.addDevice("pmos4", 95, -95, {
    name: mosName(builder, "PLOAD_OUT"),
    role: "pmos_mirror_output_load",
    properties: { model: "pmos", W: "18u", L: "180n", M: "1", NF: "6" },
  });
  const mnP = builder.addDevice("nmos4", -85, 50, {
    name: mosName(builder, "INP"),
    role: "positive_input_nmos",
    properties: { model: "nmos", W: "12u", L: "180n", M: "1", NF: "6" },
  });
  const mnN = builder.addDevice("nmos4", 95, 50, {
    name: mosName(builder, "INN"),
    role: "negative_input_nmos",
    properties: { model: "nmos", W: "12u", L: "180n", M: "1", NF: "6" },
  });
  const tail = builder.addDevice("nmos4", 0, 175, {
    name: mosName(builder, "TAIL"),
    role: "tail_current_nmos",
    properties: { model: "nmos", W: "18u", L: "180n", M: "1", NF: "8" },
  });
  builder.labelTerminal(inp, "P", "VINP", { x: 32, y: 0 });
  builder.labelTerminal(inn, "P", "VINN", { x: 32, y: 0 });
  builder.labelTerminal(ibias, "P", "IBIAS", { x: 32, y: 0 });
  builder.labelTerminal(out, "P", "VOUT", { x: -32, y: 0 });
  builder.labelTerminal(mpRef, "S", "VDD", { x: 0, y: -34 });
  builder.labelTerminal(mpRef, "B", "VDD", { x: 34, y: 0 });
  builder.labelTerminal(mpRef, "D", "MIR", { x: 0, y: 34 });
  builder.labelTerminal(mpRef, "G", "MIR", { x: -34, y: 0 });
  builder.labelTerminal(mpOut, "S", "VDD", { x: 0, y: -34 });
  builder.labelTerminal(mpOut, "B", "VDD", { x: 34, y: 0 });
  builder.labelTerminal(mpOut, "D", "VOUT", { x: 0, y: 34 });
  builder.labelTerminal(mpOut, "G", "MIR", { x: -34, y: 0 });
  builder.labelTerminal(mnP, "D", "MIR", { x: 0, y: -34 });
  builder.labelTerminal(mnP, "G", "VINP", { x: -34, y: 0 });
  builder.labelTerminal(mnP, "S", "TAIL", { x: 0, y: 34 });
  builder.labelTerminal(mnP, "B", "0", { x: 34, y: 0 });
  builder.labelTerminal(mnN, "D", "VOUT", { x: 0, y: -34 });
  builder.labelTerminal(mnN, "G", "VINN", { x: -34, y: 0 });
  builder.labelTerminal(mnN, "S", "TAIL", { x: 0, y: 34 });
  builder.labelTerminal(mnN, "B", "0", { x: 34, y: 0 });
  builder.labelTerminal(tail, "D", "TAIL", { x: 0, y: -34 });
  builder.labelTerminal(tail, "G", "IBIAS", { x: -34, y: 0 });
  builder.labelTerminal(tail, "S", "0", { x: 0, y: 34 });
  builder.labelTerminal(tail, "B", "0", { x: 34, y: 0 });
  builder.addNote(`${builder.instanceName} 5T OTA seed: flattened editable MOS-level schematic`, -265, -180);
}

const BUILDERS: Record<SubcircuitTemplateKind, (builder: TemplateBuilder) => void> = {
  transmission_gate_cmos: buildTransmissionGate,
  sample_hold_cmos: buildSampleHold,
  cdac_bit_slice_cmos: buildCdacBitSlice,
  strongarm_comparator_cmos: buildStrongarmComparator,
  nmos_diff_pair_cmos: buildNmosDiffPair,
  pmos_current_mirror_cmos: buildPmosCurrentMirror,
  ota_5t_cmos: buildOta5t,
};

export function getSubcircuitTemplate(kind: SubcircuitTemplateKind): SubcircuitTemplateDefinition {
  const definition = TEMPLATE_BY_KIND.get(kind);
  if (!definition) throw new Error(`Unknown subcircuit template: ${kind}`);
  return definition;
}

export function placeSubcircuitTemplate(
  document: SchematicDocument,
  kind: SubcircuitTemplateKind,
  anchor: Point,
): SchematicDocument {
  const definition = getSubcircuitTemplate(kind);
  const builder = new TemplateBuilder(document, definition, anchor);
  BUILDERS[kind](builder);
  return builder.finish();
}

export function createSubcircuitTemplateCellView(
  document: SchematicDocument,
  kind: SubcircuitTemplateKind,
): SchematicDocument {
  const definition = getSubcircuitTemplate(kind);
  const builder = new TemplateBuilder(
    document,
    definition,
    {
      x: Math.max(240, definition.width / 2 + 80),
      y: Math.max(220, definition.height / 2 + 80),
    },
    false,
  );
  BUILDERS[kind](builder);
  return builder.finish();
}
