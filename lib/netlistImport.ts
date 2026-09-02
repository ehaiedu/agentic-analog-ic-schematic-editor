import {
  createDeviceNode,
  createEmptyDocument,
  getDeviceDefinition,
  getPinWorldPosition,
  snapToElectricalGrid,
  type DeviceKind,
  type EdgeTerminal,
  type NetLabel,
  type Point,
  type SchematicDocument,
  type SchematicEdge,
  type SchematicNode,
} from "./schematic";
import { rootCellKey, withHierarchyCellView } from "./hierarchy";

type NetlistableKind =
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
  | "subckt12";

interface LogicalLine {
  text: string;
  lineNumber: number;
}

interface ParsedInstance {
  name: string;
  kind: NetlistableKind;
  nets: string[];
  properties: Record<string, string>;
  lineNumber: number;
  source: string;
}

export interface NetlistImportOptions {
  project?: string;
  cell?: string;
  library?: string;
}

const PIN_ORDER: Record<NetlistableKind, string[]> = {
  nmos4: ["D", "G", "S", "B"],
  pmos4: ["D", "G", "S", "B"],
  diode: ["P", "N"],
  npn3: ["C", "B", "E"],
  pnp3: ["C", "B", "E"],
  resistor: ["P", "N"],
  capacitor: ["P", "N"],
  inductor: ["P", "N"],
  vsource: ["P", "N"],
  isource: ["P", "N"],
  vcvs: ["P", "N", "CP", "CN"],
  vccs: ["P", "N", "CP", "CN"],
  switch4: ["P", "N", "CP", "CN"],
  transmission_gate: ["A", "B", "EN", "ENB"],
  sampling_switch: ["IN", "OUT", "CLK", "CLKB", "VDD", "VSS"],
  cdac_array: ["TOP", "BOT", "CTRL", "VREFP", "VREFN", "VCM", "VDD", "VSS"],
  sar_logic: ["CLK", "CMP", "CTRL", "DOUT", "RST", "VDD", "VSS"],
  dynamic_comparator: ["INP", "INN", "OUTP", "OUTN", "CLK", "VDD", "VSS"],
  diff_pair: ["INP", "INN", "OUTP", "OUTN", "TAIL", "VDD"],
  current_mirror: ["IN", "OUT", "VDD", "VSS"],
  bias_current: ["OUT", "EN", "VDD", "VSS"],
  gain_stage: ["INP", "INN", "OUT", "VDD", "VSS"],
  latch: ["INP", "INN", "OUTP", "OUTN", "CLK", "VSS"],
  opamp3: ["INP", "INN", "OUT"],
  subckt4: ["A", "B", "C", "D"],
  subckt5: ["A", "B", "C", "D", "E"],
  subckt6: ["A", "B", "C", "D", "E", "F"],
  subckt7: ["A", "B", "C", "D", "E", "F", "G"],
  subckt8: ["A", "B", "C", "D", "E", "F", "G", "H"],
  subckt9: ["A", "B", "C", "D", "E", "F", "G", "H", "I"],
  subckt10: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"],
  subckt11: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"],
  subckt12: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"],
};

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en", { numeric: true, sensitivity: "base" });
}

function stripComment(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith(";")) return "";
  return trimmed.replace(/\s+\/\/.*$/, "").replace(/\s+;.*$/, "").trim();
}

function collectLogicalLines(text: string): LogicalLine[] {
  const lines: LogicalLine[] = [];
  let pending: LogicalLine | null = null;
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = stripComment(raw);
    if (!line) return;
    if (line.startsWith("+") && pending) {
      pending = { ...pending, text: `${pending.text} ${line.slice(1).trim()}`.trim() };
      return;
    }
    if (pending) lines.push(pending);
    pending = { text: line, lineNumber: index + 1 };
  });
  if (pending) lines.push(pending);
  return lines;
}

function splitFields(value: string): string[] {
  return value.trim().split(/\s+/).filter(Boolean);
}

function cleanIdentifier(value: string, fallback: string, maxLength = 64): string {
  const replaced = value.trim().replace(/[^A-Za-z0-9_.$!]/g, "_");
  const candidate = (/^[A-Za-z_]/.test(replaced) ? replaced : `_${replaced}`).slice(0, maxLength);
  return candidate || fallback;
}

function documentName(value: string | undefined, fallback: string): string {
  return cleanIdentifier(value ?? "", fallback, 48).replace(/[.$!]/g, "_");
}

function netKey(net: string): string {
  return net.trim().toLocaleLowerCase("en");
}

function netSortKey(net: string): string {
  const normalized = net.trim();
  if (normalized === "0") return "0000";
  if (supplyKindForNet(normalized) === "gnd") return `0001:${normalized}`;
  if (supplyKindForNet(normalized) === "vdd") return `0002:${normalized}`;
  return `1:${normalized}`;
}

function normalizeNet(net: string): string {
  const trimmed = net.trim();
  return trimmed || "NC";
}

function parseParams(tokens: readonly string[]): Record<string, string> {
  const params: Record<string, string> = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const eqIndex = token.indexOf("=");
    if (eqIndex > 0) {
      const key = token.slice(0, eqIndex).trim();
      const value = token.slice(eqIndex + 1).trim();
      if (key && value) params[key] = value;
      continue;
    }
    const lower = token.toLowerCase();
    if ((lower === "dc" || lower === "ac") && tokens[index + 1]) {
      params[lower] = tokens[index + 1];
      index += 1;
    }
  }
  return params;
}

function readParam(params: Record<string, string>, keys: readonly string[], fallback = ""): string {
  for (const key of keys) {
    const exact = params[key];
    if (exact) return exact;
    const match = Object.entries(params).find(([candidate]) => candidate.toLowerCase() === key.toLowerCase());
    if (match?.[1]) return match[1];
  }
  return fallback;
}

function mosKindFromModel(model: string): "nmos4" | "pmos4" {
  const normalized = model.toLowerCase();
  if (/(^|[_-])(p|pmos|pch|pfet)([_-]|$)/.test(normalized)) return "pmos4";
  if (/^(p|pmos|pch|pfet)/.test(normalized)) return "pmos4";
  return "nmos4";
}

function bjtKindFromModel(model: string): "npn3" | "pnp3" {
  return /pnp|p_bjt|pch|pnp/i.test(model) ? "pnp3" : "npn3";
}

function macroKindFromMaster(master: string, pinCount: number): NetlistableKind {
  const normalized = master.toLowerCase();
  const semanticKind = (() => {
    if (/cdac|cap.*array|dac_array/.test(normalized)) return "cdac_array";
    if (/sar.*logic|logic.*sar|sar_ctrl|sar_control/.test(normalized)) return "sar_logic";
    if (/dynamic.*comp|strongarm|comparator|cmp/.test(normalized)) return "dynamic_comparator";
    if (/sample|track|hold|boot.*switch|sampling/.test(normalized)) return "sampling_switch";
    if (/transmission.*gate|tgate|tg/.test(normalized)) return "transmission_gate";
    if (/diff.*pair|differential_pair/.test(normalized)) return "diff_pair";
    if (/current.*mirror|mirror/.test(normalized)) return "current_mirror";
    if (/bias|iref/.test(normalized)) return "bias_current";
    if (/gain.*stage|preamp|amplifier_stage/.test(normalized)) return "gain_stage";
    if (/latch|regen/.test(normalized)) return "latch";
    if (/op.?amp|ota/.test(normalized)) return "opamp3";
    return null;
  })() as NetlistableKind | null;
  if (semanticKind) {
    const definition = getDeviceDefinition(semanticKind);
    const requiredPins = definition.pins.filter((pin) => pin.required).length;
    if (pinCount >= requiredPins && pinCount <= PIN_ORDER[semanticKind].length) return semanticKind;
  }
  if (pinCount <= 4) return "subckt4";
  if (pinCount <= 5) return "subckt5";
  if (pinCount <= 6) return "subckt6";
  if (pinCount <= 7) return "subckt7";
  if (pinCount <= 8) return "subckt8";
  if (pinCount <= 9) return "subckt9";
  if (pinCount <= 10) return "subckt10";
  if (pinCount <= 11) return "subckt11";
  return "subckt12";
}

function macroProperties(master: string, params: Record<string, string>): Record<string, string> {
  return { master, ...params };
}

function supplyKindForNet(net: string): "vdd" | "gnd" | null {
  const normalized = net.replace(/!/g, "").toLowerCase();
  if (normalized === "0" || normalized === "gnd" || normalized === "vss" || normalized === "vssa" || normalized === "vssd") {
    return "gnd";
  }
  if (normalized === "vdd" || normalized === "vdda" || normalized === "vddd" || normalized === "avdd" || normalized === "dvdd" || normalized === "vcc") {
    return "vdd";
  }
  return null;
}

function classifyPortKind(net: string): DeviceKind {
  const normalized = net.toLowerCase();
  if (/(out|dout|vout|cmp|done|ready)/.test(normalized)) return "output";
  if (/(in|vin|clk|rst|reset|bias|ref|sample)/.test(normalized)) return "input";
  return "bidir";
}

function spicePrimitive(line: LogicalLine): ParsedInstance | null {
  const fields = splitFields(line.text);
  if (fields.length < 4) return null;
  const name = fields[0];
  const prefix = name[0]?.toUpperCase();
  if (prefix === "M" && fields.length >= 6) {
    const rawParams = parseParams(fields.slice(6));
    const model = fields[5];
    const kind = mosKindFromModel(model);
    return {
      name,
      kind,
      nets: fields.slice(1, 5).map(normalizeNet),
      properties: {
        model,
        W: readParam(rawParams, ["W", "w"], kind === "pmos4" ? "20u" : "10u"),
        L: readParam(rawParams, ["L", "l"], "180n"),
        M: readParam(rawParams, ["M", "m"], "1"),
        NF: readParam(rawParams, ["NF", "nf", "fingers"], "1"),
      },
      lineNumber: line.lineNumber,
      source: line.text,
    };
  }
  if (prefix === "D" && fields.length >= 4) {
    const rawParams = parseParams(fields.slice(4));
    return {
      name,
      kind: "diode",
      nets: fields.slice(1, 3).map(normalizeNet),
      properties: {
        model: fields[3],
        area: readParam(rawParams, ["AREA", "area"], "1"),
        M: readParam(rawParams, ["M", "m"], "1"),
      },
      lineNumber: line.lineNumber,
      source: line.text,
    };
  }
  if (prefix === "Q" && fields.length >= 5) {
    const model = fields[4];
    const rawParams = parseParams(fields.slice(5));
    return {
      name,
      kind: bjtKindFromModel(model),
      nets: fields.slice(1, 4).map(normalizeNet),
      properties: {
        model,
        area: readParam(rawParams, ["AREA", "area"], "1"),
        M: readParam(rawParams, ["M", "m"], "1"),
      },
      lineNumber: line.lineNumber,
      source: line.text,
    };
  }
  if ((prefix === "R" || prefix === "C" || prefix === "L") && fields.length >= 4) {
    const rawParams = parseParams(fields.slice(3));
    const kind = prefix === "R" ? "resistor" : prefix === "C" ? "capacitor" : "inductor";
    return {
      name,
      kind,
      nets: fields.slice(1, 3).map(normalizeNet),
      properties: { value: readParam(rawParams, ["value", "r", "resistance", "c", "capacitance", "l", "inductance"], fields[3]) },
      lineNumber: line.lineNumber,
      source: line.text,
    };
  }
  if ((prefix === "V" || prefix === "I") && fields.length >= 4) {
    const rawParams = parseParams(fields.slice(3));
    return {
      name,
      kind: prefix === "V" ? "vsource" : "isource",
      nets: fields.slice(1, 3).map(normalizeNet),
      properties: {
        dc: readParam(rawParams, ["dc"], fields[3].toLowerCase() === "dc" ? fields[4] ?? "0" : fields[3]),
        ac: readParam(rawParams, ["ac"], "0"),
      },
      lineNumber: line.lineNumber,
      source: line.text,
    };
  }
  if ((prefix === "E" || prefix === "G") && fields.length >= 6) {
    return {
      name,
      kind: prefix === "E" ? "vcvs" : "vccs",
      nets: fields.slice(1, 5).map(normalizeNet),
      properties: prefix === "E" ? { gain: fields[5] } : { gm: fields[5] },
      lineNumber: line.lineNumber,
      source: line.text,
    };
  }
  if (prefix === "S" && fields.length >= 6) {
    return {
      name,
      kind: "switch4",
      nets: fields.slice(1, 5).map(normalizeNet),
      properties: { model: fields[5] },
      lineNumber: line.lineNumber,
      source: line.text,
    };
  }
  if (prefix === "X" && fields.length >= 3) {
    const afterName = fields.slice(1);
    const firstParam = afterName.findIndex((token) => token.includes("="));
    const masterIndex = firstParam > 0 ? firstParam - 1 : afterName.length - 1;
    const master = afterName[masterIndex];
    const nets = afterName.slice(0, masterIndex).map(normalizeNet);
    const rawParams = parseParams(firstParam >= 0 ? afterName.slice(firstParam) : []);
    const kind = macroKindFromMaster(master, nets.length);
    return {
      name,
      kind,
      nets,
      properties: macroProperties(master, rawParams),
      lineNumber: line.lineNumber,
      source: line.text,
    };
  }
  return null;
}

function spectrePrimitive(line: LogicalLine): ParsedInstance | null {
  const match = line.text.match(/^(\S+)\s*\(([^)]*)\)\s+(\S+)(?:\s+(.*))?$/);
  if (!match) return null;
  const [, name, netList, primitive, tail = ""] = match;
  const nets = splitFields(netList).map(normalizeNet);
  const params = parseParams(splitFields(tail));
  const lowerPrimitive = primitive.toLowerCase();
  if (nets.length === 4 && (name[0]?.toUpperCase() === "M" || /mos|fet|pch|nch|pmos|nmos/.test(lowerPrimitive))) {
    const kind = mosKindFromModel(primitive);
    return {
      name,
      kind,
      nets,
      properties: {
        model: primitive,
        W: readParam(params, ["w", "W"], kind === "pmos4" ? "20u" : "10u"),
        L: readParam(params, ["l", "L"], "180n"),
        M: readParam(params, ["m", "M"], "1"),
        NF: readParam(params, ["nf", "NF", "fingers"], "1"),
      },
      lineNumber: line.lineNumber,
      source: line.text,
    };
  }
  if (nets.length >= 2 && (name[0]?.toUpperCase() === "D" || /^(diode|dio|d)$/.test(lowerPrimitive))) {
    return {
      name,
      kind: "diode",
      nets: nets.slice(0, 2),
      properties: {
        model: primitive,
        area: readParam(params, ["area", "AREA"], "1"),
        M: readParam(params, ["m", "M"], "1"),
      },
      lineNumber: line.lineNumber,
      source: line.text,
    };
  }
  if (nets.length >= 3 && (name[0]?.toUpperCase() === "Q" || /bjt|npn|pnp/.test(lowerPrimitive))) {
    return {
      name,
      kind: bjtKindFromModel(primitive),
      nets: nets.slice(0, 3),
      properties: {
        model: primitive,
        area: readParam(params, ["area", "AREA"], "1"),
        M: readParam(params, ["m", "M"], "1"),
      },
      lineNumber: line.lineNumber,
      source: line.text,
    };
  }
  if (nets.length >= 2 && /^(resistor|res|r)$/.test(lowerPrimitive)) {
    return {
      name,
      kind: "resistor",
      nets: nets.slice(0, 2),
      properties: { value: readParam(params, ["r", "value", "resistance"], "1k") },
      lineNumber: line.lineNumber,
      source: line.text,
    };
  }
  if (nets.length >= 2 && /^(capacitor|cap|c)$/.test(lowerPrimitive)) {
    return {
      name,
      kind: "capacitor",
      nets: nets.slice(0, 2),
      properties: { value: readParam(params, ["c", "value", "capacitance"], "1p") },
      lineNumber: line.lineNumber,
      source: line.text,
    };
  }
  if (nets.length >= 2 && /^(inductor|ind|l)$/.test(lowerPrimitive)) {
    return {
      name,
      kind: "inductor",
      nets: nets.slice(0, 2),
      properties: { value: readParam(params, ["l", "value", "inductance"], "1n") },
      lineNumber: line.lineNumber,
      source: line.text,
    };
  }
  if (nets.length >= 2 && /^(vsource|vdc|vpulse)$/.test(lowerPrimitive)) {
    return {
      name,
      kind: "vsource",
      nets: nets.slice(0, 2),
      properties: { dc: readParam(params, ["dc", "dcval"], "0"), ac: readParam(params, ["ac", "acmag"], "0") },
      lineNumber: line.lineNumber,
      source: line.text,
    };
  }
  if (nets.length >= 2 && /^(isource|idc|ipulse)$/.test(lowerPrimitive)) {
    return {
      name,
      kind: "isource",
      nets: nets.slice(0, 2),
      properties: { dc: readParam(params, ["dc", "dcval"], "0"), ac: readParam(params, ["ac", "acmag"], "0") },
      lineNumber: line.lineNumber,
      source: line.text,
    };
  }
  if (nets.length >= 4 && /^(vcvs|e)$/.test(lowerPrimitive)) {
    return {
      name,
      kind: "vcvs",
      nets: nets.slice(0, 4),
      properties: { gain: readParam(params, ["gain"], "1") },
      lineNumber: line.lineNumber,
      source: line.text,
    };
  }
  if (nets.length >= 4 && /^(vccs|g)$/.test(lowerPrimitive)) {
    return {
      name,
      kind: "vccs",
      nets: nets.slice(0, 4),
      properties: { gm: readParam(params, ["gm"], "1m") },
      lineNumber: line.lineNumber,
      source: line.text,
    };
  }
  if (nets.length >= 4 && /^(switch|sw)$/.test(lowerPrimitive)) {
    return {
      name,
      kind: "switch4",
      nets: nets.slice(0, 4),
      properties: {
        model: readParam(params, ["model"], primitive),
        ron: readParam(params, ["ron"], "1"),
        roff: readParam(params, ["roff"], "1G"),
        vt: readParam(params, ["vt"], "0.5"),
        vh: readParam(params, ["vh"], "0"),
      },
      lineNumber: line.lineNumber,
      source: line.text,
    };
  }
  if (name[0]?.toUpperCase() === "X" && nets.length >= 1) {
    const kind = macroKindFromMaster(primitive, nets.length);
    return {
      name,
      kind,
      nets,
      properties: macroProperties(primitive, params),
      lineNumber: line.lineNumber,
      source: line.text,
    };
  }
  return null;
}

function parseNetlist(text: string) {
  const instances: ParsedInstance[] = [];
  const ports: string[] = [];
  const globals: string[] = [];
  const unsupported: Array<{ lineNumber: number; text: string }> = [];
  let cellName = "";

  for (const line of collectLogicalLines(text)) {
    const subckt = line.text.match(/^\.?subckt\s+(\S+)(?:\s+(.*))?$/i);
    if (subckt) {
      cellName ||= subckt[1];
      ports.push(...splitFields(subckt[2] ?? "").map(normalizeNet));
      continue;
    }
    const global = line.text.match(/^\.?global\s+(.+)$/i);
    if (global) {
      globals.push(...splitFields(global[1]).map(normalizeNet));
      continue;
    }
    if (/^(\.?ends?|simulator\s+lang|\.?include|\.?lib|\.?model|parameters?\b|ahdl_include\b)/i.test(line.text)) {
      continue;
    }

    const instance = spectrePrimitive(line) ?? spicePrimitive(line);
    if (instance) {
      instances.push(instance);
    } else {
      unsupported.push({ lineNumber: line.lineNumber, text: line.text.slice(0, 240) });
    }
  }

  return {
    cellName,
    instances,
    ports: [...new Map(ports.map((net) => [netKey(net), net])).values()],
    globals: [...new Map(globals.map((net) => [netKey(net), net])).values()],
    unsupported,
  };
}

function uniqueNodeId(base: string, used: Set<string>): string {
  const clean = cleanIdentifier(base, "node", 80);
  let candidate = clean;
  let index = 2;
  while (used.has(candidate)) {
    candidate = `${clean.slice(0, 72)}_${index}`;
    index += 1;
  }
  used.add(candidate);
  return candidate;
}

function terminalPoint(nodes: readonly SchematicNode[], terminal: EdgeTerminal): Point {
  const node = nodes.find((candidate) => candidate.id === terminal.nodeId);
  const point = node ? getPinWorldPosition(node, terminal.portId) : null;
  return point ?? { x: 0, y: 0 };
}

function terminalEscapePoint(
  nodes: readonly SchematicNode[],
  terminal: EdgeTerminal,
  netIndex: number,
): Point {
  const node = nodes.find((candidate) => candidate.id === terminal.nodeId);
  const point = terminalPoint(nodes, terminal);
  const pin = node && getDeviceDefinition(node.kind).pins.find((candidate) => candidate.id === terminal.portId);
  const distance = 18 + (netIndex % 3) * 4;
  if (pin?.side === "left") return { x: snapToElectricalGrid(point.x - distance), y: point.y };
  if (pin?.side === "right") return { x: snapToElectricalGrid(point.x + distance), y: point.y };
  if (pin?.side === "top") return { x: point.x, y: snapToElectricalGrid(point.y - distance) };
  if (pin?.side === "bottom") return { x: point.x, y: snapToElectricalGrid(point.y + distance) };
  return { x: snapToElectricalGrid(point.x + distance), y: point.y };
}

function terminalRouteVertices(
  nodes: readonly SchematicNode[],
  terminal: EdgeTerminal,
  target: Point,
  netIndex: number,
): Point[] {
  const sourcePoint = terminalPoint(nodes, terminal);
  if (sourcePoint.x === target.x || sourcePoint.y === target.y) return [];
  const node = nodes.find((candidate) => candidate.id === terminal.nodeId);
  const pin = node && getDeviceDefinition(node.kind).pins.find((candidate) => candidate.id === terminal.portId);
  const distance = 18 + (netIndex % 3) * 4;
  const first = pin?.side === "top" || pin?.side === "bottom"
    ? {
      x: snapToElectricalGrid(sourcePoint.x + (target.x >= sourcePoint.x ? distance : -distance)),
      y: sourcePoint.y,
    }
    : terminalEscapePoint(nodes, terminal, netIndex);
  const corridor = { x: first.x, y: target.y };
  const points = [first, corridor];
  const deduped: Point[] = [];
  for (const point of points) {
    if (point.x === sourcePoint.x && point.y === sourcePoint.y) continue;
    if (point.x === target.x && point.y === target.y) continue;
    if (deduped.at(-1)?.x === point.x && deduped.at(-1)?.y === point.y) continue;
    deduped.push(point);
  }
  return deduped;
}

function importFlatNetlistAsSchematic(text: string, options: NetlistImportOptions = {}): SchematicDocument {
  const parsed = parseNetlist(text);
  if (!parsed.instances.length && !parsed.ports.length) {
    throw new Error("No supported primitive devices or subckt ports were found.");
  }

  const project = documentName(options.project, "speg_import");
  const cell = documentName(options.cell || parsed.cellName, "imported_netlist");
  const document = createEmptyDocument(project, cell);
  const nodes: SchematicNode[] = [];
  const edges: SchematicEdge[] = [];
  const netLabels: NetLabel[] = [];
  const terminalsByNet = new Map<string, EdgeTerminal[]>();
  const netNamesByKey = new Map<string, string>();
  const usedNodeIds = new Set<string>();
  const addTerminal = (net: string, terminal: EdgeTerminal) => {
    const normalized = normalizeNet(net);
    const key = netKey(normalized);
    netNamesByKey.set(key, normalized);
    const terminals = terminalsByNet.get(key) ?? [];
    terminals.push(terminal);
    terminalsByNet.set(key, terminals);
  };

  const instanceColumns = Math.max(1, Math.ceil(Math.sqrt(parsed.instances.length || 1)));
  parsed.instances.forEach((instance, index) => {
    const x = 280 + (index % instanceColumns) * 210;
    const y = 180 + Math.floor(index / instanceColumns) * 160;
    const base = createDeviceNode(instance.kind, x, y, nodes);
    const pinOrder = PIN_ORDER[instance.kind];
    const importedPortOrder = pinOrder.slice(0, instance.nets.length);
    const portProperties = Object.fromEntries(pinOrder.map((portId) => [`port_${portId}`, portId]));
    const node: SchematicNode = {
      ...base,
      id: uniqueNodeId(`inst_${instance.name}`, usedNodeIds),
      instanceName: cleanIdentifier(instance.name, base.instanceName),
      properties: {
        ...base.properties,
        ...instance.properties,
        ...(importedPortOrder.length ? {
          portOrder: importedPortOrder.join(","),
          portOrderFull: importedPortOrder.join(","),
          ...portProperties,
        } : {}),
        originalLine: String(instance.lineNumber),
      },
    };
    nodes.push(node);
    pinOrder.forEach((portId, pinIndex) => {
      if (instance.nets[pinIndex] === undefined) return;
      addTerminal(instance.nets[pinIndex], { nodeId: node.id, portId });
    });
  });

  const portKeys = new Set(parsed.ports.map(netKey));
  const globalKeys = new Set(parsed.globals.map(netKey));
  const sortedNetKeys = [...terminalsByNet.keys(), ...portKeys, ...globalKeys]
    .filter((key, index, values) => values.indexOf(key) === index)
    .sort((left, right) => compareText(netSortKey(netNamesByKey.get(left) ?? left), netSortKey(netNamesByKey.get(right) ?? right)));

  const minDeviceX = Math.min(...nodes.map((node) => node.x));
  const maxDeviceX = Math.max(...nodes.map((node) => node.x + node.width));
  const maxDeviceY = Math.max(...nodes.map((node) => node.y + node.height));
  let leftPortIndex = 0;
  let rightPortIndex = 0;
  let supplyIndex = 0;
  let groundIndex = 0;

  sortedNetKeys.forEach((key) => {
    const net = netNamesByKey.get(key) ?? parsed.ports.find((port) => netKey(port) === key) ?? parsed.globals.find((item) => netKey(item) === key) ?? key;
    const supplyKind = supplyKindForNet(net);
    const shouldCreatePort = portKeys.has(key) || globalKeys.has(key) || supplyKind !== null;
    if (!shouldCreatePort) return;
    const kind = portKeys.has(key) ? classifyPortKind(net) : supplyKind ?? classifyPortKind(net);
    const placement = (() => {
      if (kind === "vdd") {
        const value = { x: maxDeviceX + 420 + supplyIndex * 120, y: 60 };
        supplyIndex += 1;
        return value;
      }
      if (kind === "gnd") {
        const value = { x: maxDeviceX + 420 + groundIndex * 120, y: maxDeviceY + 150 };
        groundIndex += 1;
        return value;
      }
      if (kind === "output") {
        const value = { x: maxDeviceX + 420, y: 160 + rightPortIndex * 92 };
        rightPortIndex += 1;
        return value;
      }
      const value = { x: minDeviceX - 420, y: 160 + leftPortIndex * 92 };
      leftPortIndex += 1;
      return value;
    })();
    const base = createDeviceNode(kind, placement.x, placement.y, nodes);
    const node: SchematicNode = {
      ...base,
      id: uniqueNodeId(`port_${net}`, usedNodeIds),
      instanceName: cleanIdentifier(net, base.instanceName),
      properties: { ...base.properties, netName: net },
    };
    nodes.push(node);
    addTerminal(net, { nodeId: node.id, portId: "P" });
  });

  const makeEdge = (net: string, source: EdgeTerminal, target: Point, netIndex: number) => {
    const order = edges.length + 1;
    const safeNet = cleanIdentifier(net, "net", 42);
    const vertices = terminalRouteVertices(nodes, source, target, netIndex);
    const edge: SchematicEdge = {
      id: `wire_${safeNet}_${order}`,
      source,
      target,
      ...(vertices.length ? { vertices } : {}),
      style: "NORMAL",
      width: 1,
      creationOrder: order,
    };
    edges.push(edge);
    return edge;
  };

  sortedNetKeys.forEach((key, netIndex) => {
    const net = netNamesByKey.get(key) ?? key;
    const terminals = terminalsByNet.get(key) ?? [];
    if (!terminals.length) return;
    terminals.forEach((terminal, terminalIndex) => {
      const target = terminalEscapePoint(nodes, terminal, (netIndex % 5) + terminalIndex);
      const labelEdge = makeEdge(net, terminal, target, (netIndex % 5) + terminalIndex);
      netLabels.push({
        id: `label_${cleanIdentifier(net, "net", 56)}_${netLabels.length + 1}`,
        text: net,
        wireId: labelEdge.id,
        segmentIndex: labelEdge.vertices?.length ?? 0,
        anchorPoint: target,
        orientation: 0,
        textAlignment: "middle",
      });
    });
  });

  return {
    ...document,
    library: documentName(options.library, "work"),
    properties: {
      ...document.properties,
      importedPortOrder: parsed.ports.join(","),
    },
    nodes,
    edges,
    netLabels,
    revisions: {
      designRevision: 1,
      savedRevision: 0,
      connectivityRevision: 0,
      checkRevision: 0,
    },
    extensions: {
      importedNetlist: {
        source: "speg_or_eda_netlist_text",
        primitiveInstanceCount: parsed.instances.length,
        netCount: sortedNetKeys.length,
        ports: parsed.ports,
        globals: parsed.globals,
        unsupportedLines: parsed.unsupported.slice(0, 100),
      },
    },
  };
}

interface NetlistSubcircuitSource {
  name: string;
  text: string;
  referencedMasters: string[];
}

function splitSubcircuitSources(text: string): NetlistSubcircuitSource[] {
  const sources: NetlistSubcircuitSource[] = [];
  let current: { name: string; lines: string[] } | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripComment(rawLine);
    const opening = line.match(/^\.?subckt\s+(\S+)/i);
    if (opening) {
      if (current) sources.push({ name: current.name, text: `${current.lines.join("\n")}\n`, referencedMasters: [] });
      current = { name: opening[1], lines: [rawLine] };
      continue;
    }
    if (!current) continue;
    current.lines.push(rawLine);
    if (/^\.?ends?\b/i.test(line)) {
      sources.push({ name: current.name, text: `${current.lines.join("\n")}\n`, referencedMasters: [] });
      current = null;
    }
  }
  if (current) sources.push({ name: current.name, text: `${current.lines.join("\n")}\n`, referencedMasters: [] });
  return sources.map((source) => {
    const referencedMasters: string[] = [];
    for (const line of collectLogicalLines(source.text)) {
      const instance = spectrePrimitive(line) ?? spicePrimitive(line);
      if (instance?.name[0]?.toUpperCase() === "X" && instance.properties.master) {
        referencedMasters.push(instance.properties.master);
      }
    }
    return { ...source, referencedMasters };
  });
}

function linkHierarchyInstances(
  document: SchematicDocument,
  childrenByCell: Map<string, SchematicDocument>,
): SchematicDocument {
  return {
    ...document,
    nodes: document.nodes.map((node) => {
      const master = node.properties.master?.toLowerCase();
      const child = master ? childrenByCell.get(master) : undefined;
      if (!child) return node;
      return {
        ...node,
        properties: {
          ...node.properties,
          hierarchyChildKey: rootCellKey(child),
          hierarchyCell: child.cell,
          hierarchyLibrary: child.library,
          hierarchyView: child.view,
          hierarchyEditable: "true",
        },
      };
    }),
  };
}

export function importNetlistAsSchematic(text: string, options: NetlistImportOptions = {}): SchematicDocument {
  const sources = splitSubcircuitSources(text);
  if (sources.length <= 1) return importFlatNetlistAsSchematic(text, options);
  const referenced = new Set(sources.flatMap((source) => source.referencedMasters.map((name) => name.toLowerCase())));
  const rootSource = sources.find((source) => !referenced.has(source.name.toLowerCase())) ?? sources[0];
  const project = documentName(options.project, "speg_import");
  const library = documentName(options.library, "work");
  const documents = sources.map((source) => importFlatNetlistAsSchematic(source.text, {
    project,
    library,
    cell: source.name,
  }));
  const childrenByCell = new Map(documents.map((document) => [document.cell.toLowerCase(), document]));
  const linkedDocuments = documents.map((document) => linkHierarchyInstances(document, childrenByCell));
  const linkedByCell = new Map(linkedDocuments.map((document) => [document.cell.toLowerCase(), document]));
  let root = linkedByCell.get(rootSource.name.toLowerCase()) ?? linkedDocuments[0];
  linkedDocuments.forEach((child) => {
    if (child.cell.toLowerCase() !== root.cell.toLowerCase()) root = withHierarchyCellView(root, child, false);
  });
  return {
    ...root,
    extensions: {
      ...root.extensions,
      importedHierarchy: {
        schema: "analog_studio.imported_hierarchy.v1",
        topCell: root.cell,
        cellCount: linkedDocuments.length,
        cells: linkedDocuments.map((document) => document.cell),
      },
    },
  };
}
