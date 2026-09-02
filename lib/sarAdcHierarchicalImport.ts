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
import { importNetlistAsSchematic } from "./netlistImport";
import { parseSchematicDocument } from "./schematicValidation";

const PIN_IDS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"] as const;
const GENERATOR = "configured_speg_sar_adc_hierarchical_import";

interface SourceInstance {
  name: string;
  nets: string[];
  primitive: string;
  source: string;
  lineNumber: number;
}

interface ParsedSarNetlist {
  cellName: string;
  ports: string[];
  instances: SourceInstance[];
  unsupported: Array<{ lineNumber: number; text: string }>;
}

interface ModuleGroup {
  key: string;
  cell: string;
  role: string;
  label: string;
  instanceName: string;
  instances: SourceInstance[];
  x: number;
  y: number;
  childPorts: string[];
  visiblePorts: string[];
}

export interface SarAdcHierarchicalImportOptions {
  project?: string;
  cell?: string;
  library?: string;
  sourceRun?: string;
}

export interface SarAdcHierarchyImportSummary {
  schema: "analog_studio.sar_adc_hierarchy_import.v1";
  generator: string;
  topCell: string;
  sourceInstanceCount: number;
  topPortCount: number;
  moduleCount: number;
  unsupportedLineCount: number;
  topLevelNodeCount: number;
  topLevelEdgeCount: number;
  modules: Array<{
    cell: string;
    role: string;
    instanceCount: number;
    childPortCount: number;
    visiblePortCount: number;
    hiddenPortCount: number;
  }>;
}

export interface SarAdcHierarchicalImportResult {
  document: SchematicDocument;
  summary: SarAdcHierarchyImportSummary;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en", { numeric: true, sensitivity: "base" });
}

function cleanIdentifier(value: string, fallback: string, maxLength = 64): string {
  const replaced = value.trim().replace(/[^A-Za-z0-9_.$!]/g, "_");
  const candidate = (/^[A-Za-z_]/.test(replaced) ? replaced : `_${replaced}`).slice(0, maxLength);
  return candidate || fallback;
}

function documentName(value: string | undefined, fallback: string): string {
  return cleanIdentifier(value ?? "", fallback, 72).replace(/[.$!]/g, "_");
}

function netKey(net: string): string {
  return net.trim().toLocaleLowerCase("en");
}

function splitFields(value: string): string[] {
  return value.trim().split(/\s+/).filter(Boolean);
}

function normalizeNet(net: string): string {
  return net.trim().replace(/^\(/, "").replace(/\)$/, "") || "NC";
}

function stripComment(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith(";")) return "";
  return trimmed.replace(/\s+\/\/.*$/, "").replace(/\s+;.*$/, "").trim();
}

function collectLogicalLines(text: string): Array<{ text: string; lineNumber: number }> {
  const lines: Array<{ text: string; lineNumber: number }> = [];
  let pending: { text: string; lineNumber: number } | null = null;
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

function parseSubcktLine(line: string): { cellName: string; ports: string[] } | null {
  const match = line.match(/^\.?subckt\s+(\S+)(?:\s+(.*))?$/i);
  if (!match) return null;
  const rawPorts = (match[2] ?? "").trim().replace(/^\(/, "").replace(/\)$/, "");
  return {
    cellName: cleanIdentifier(match[1], "sar_adc_dut"),
    ports: splitFields(rawPorts).map(normalizeNet),
  };
}

function parseInstanceLine(line: { text: string; lineNumber: number }): SourceInstance | null {
  const match = line.text.match(/^(\S+)\s*\(([^)]*)\)\s+(\S+)(?:\s+(.*))?$/);
  if (!match) return null;
  const [, rawName, rawNets, primitive] = match;
  return {
    name: cleanIdentifier(rawName, "inst", 80),
    nets: splitFields(rawNets).map(normalizeNet),
    primitive,
    source: line.text,
    lineNumber: line.lineNumber,
  };
}

function parseSarNetlist(text: string): ParsedSarNetlist {
  const parsed: ParsedSarNetlist = {
    cellName: "sar_adc_dut",
    ports: [],
    instances: [],
    unsupported: [],
  };
  for (const line of collectLogicalLines(text)) {
    const subckt = parseSubcktLine(line.text);
    if (subckt) {
      parsed.cellName = subckt.cellName;
      parsed.ports = subckt.ports;
      continue;
    }
    if (/^(\.?ends?|simulator\s+lang|\.?include|\.?lib|\.?global|\.?model|parameters?\b|ahdl_include\b)/i.test(line.text)) {
      continue;
    }
    const instance = parseInstanceLine(line);
    if (instance) {
      parsed.instances.push(instance);
    } else {
      parsed.unsupported.push({ lineNumber: line.lineNumber, text: line.text.slice(0, 240) });
    }
  }
  return {
    ...parsed,
    ports: uniqueByKey(parsed.ports),
  };
}

function uniqueByKey(values: readonly string[]): string[] {
  const byKey = new Map<string, string>();
  values.forEach((value) => {
    const normalized = normalizeNet(value);
    if (!byKey.has(netKey(normalized))) byKey.set(netKey(normalized), normalized);
  });
  return [...byKey.values()];
}

function bitIndexFromInstanceName(rawName: string): number | null {
  const name = rawName.toLowerCase();
  const direct = name.match(/^(?:c|m|r)?bit(\d+)(?:_|$)/)
    ?? name.match(/^m(?:sp|sn)(\d+)(?:_|$)/)
    ?? name.match(/^mdout(\d+)(?:_|$)/);
  if (direct) return Number(direct[1]);
  const phi = name.match(/^mphi_(?:bit|dec|cap|hold)_(\d+)(?:_|$)/);
  return phi ? Number(phi[1]) : null;
}

function roleForInstance(instance: SourceInstance): string {
  const name = instance.name.toLowerCase();
  if (name === "xctrl_timing") return "timing_controller";
  if (/^(ccdacp_|rcdac_p$)/.test(name)) return "cdac_p_array";
  if (/^(ccdacn_|rcdac_n$)/.test(name)) return "cdac_n_array";
  if (/^[rc]bp_/.test(name)) return "reference_ladder";
  if (/^(mstart_|msample_|rcdac_[pn]_hold$)/.test(name)) return "input_sampling";
  if (/^[rmc]cmp/.test(name)) return "comparator_core";
  const bitIndex = bitIndexFromInstanceName(name);
  if (bitIndex !== null && Number.isInteger(bitIndex) && bitIndex >= 0 && bitIndex <= 31) {
    return `sar_bit_${bitIndex}_slice`;
  }
  return "sar_adc_misc";
}

function roleCell(role: string): string {
  const bit = role.match(/^sar_bit_(\d+)_slice$/);
  if (bit) return `sar_bit${bit[1]}_slice`;
  return role;
}

function roleLabel(role: string): string {
  const bit = role.match(/^sar_bit_(\d+)_slice$/);
  if (bit) return `BIT${bit[1]} Slice`;
  return role.split("_").map((part) => part.toUpperCase()).join(" ");
}

function roleInstanceName(role: string): string {
  const bit = role.match(/^sar_bit_(\d+)_slice$/);
  if (bit) return `XBIT${bit[1]}`;
  const stem: Record<string, string> = {
    timing_controller: "XTIMING",
    input_sampling: "XSAMPLE",
    reference_ladder: "XREF",
    cdac_p_array: "XCDACP",
    cdac_n_array: "XCDACN",
    comparator_core: "XCOMP",
    sar_adc_misc: "XMISC",
  };
  return stem[role] ?? `X${cleanIdentifier(role, "MODULE", 24).toUpperCase()}`;
}

function rolePlacement(role: string): Point {
  const bit = role.match(/^sar_bit_(\d+)_slice$/);
  if (bit) {
    const index = Number(bit[1]);
    return {
      x: 1320 + (index % 5) * 260,
      y: 170 + Math.floor(index / 5) * 330,
    };
  }
  const fixed: Record<string, Point> = {
    timing_controller: { x: 330, y: 110 },
    input_sampling: { x: 330, y: 410 },
    reference_ladder: { x: 330, y: 710 },
    cdac_p_array: { x: 690, y: 240 },
    cdac_n_array: { x: 690, y: 560 },
    comparator_core: { x: 1030, y: 405 },
    sar_adc_misc: { x: 1030, y: 720 },
  };
  return fixed[role] ?? { x: 1050, y: 720 };
}

function moduleSortKey(role: string): string {
  const bit = role.match(/^sar_bit_(\d+)_slice$/);
  if (bit) return `70:${bit[1].padStart(2, "0")}`;
  const order: Record<string, string> = {
    timing_controller: "00",
    input_sampling: "10",
    reference_ladder: "20",
    cdac_p_array: "30",
    cdac_n_array: "40",
    comparator_core: "50",
    sar_adc_misc: "90",
  };
  return order[role] ?? `80:${role}`;
}

function buildGroups(instances: readonly SourceInstance[]): ModuleGroup[] {
  const byRole = new Map<string, SourceInstance[]>();
  instances.forEach((instance) => {
    const role = roleForInstance(instance);
    const current = byRole.get(role) ?? [];
    current.push(instance);
    byRole.set(role, current);
  });
  return [...byRole.entries()]
    .sort(([left], [right]) => compareText(moduleSortKey(left), moduleSortKey(right)))
    .map(([role, groupInstances]) => {
      const placement = rolePlacement(role);
      return {
        key: role,
        cell: roleCell(role),
        role,
        label: roleLabel(role),
        instanceName: roleInstanceName(role),
        instances: groupInstances,
        x: placement.x,
        y: placement.y,
        childPorts: [],
        visiblePorts: [],
      };
    });
}

function isSupplyOrReference(net: string): boolean {
  const normalized = netKey(net);
  return normalized === "0" || normalized === "vdd" || normalized === "vss" || normalized === "vref";
}

function buildChildPorts(
  groups: readonly ModuleGroup[],
  topPorts: readonly string[],
): Map<string, string[]> {
  const topPortKeys = new Set(topPorts.map(netKey));
  const nameByKey = new Map<string, string>();
  const groupsByNet = new Map<string, Set<string>>();
  for (const group of groups) {
    for (const instance of group.instances) {
      for (const net of instance.nets) {
        const key = netKey(net);
        nameByKey.set(key, net);
        const consumers = groupsByNet.get(key) ?? new Set<string>();
        consumers.add(group.key);
        groupsByNet.set(key, consumers);
      }
    }
  }
  topPorts.forEach((port) => nameByKey.set(netKey(port), port));

  const result = new Map<string, string[]>();
  for (const group of groups) {
    const ports = new Set<string>();
    for (const instance of group.instances) {
      for (const net of instance.nets) {
        const key = netKey(net);
        if (topPortKeys.has(key) || isSupplyOrReference(net) || (groupsByNet.get(key)?.size ?? 0) > 1) {
          ports.add(nameByKey.get(key) ?? net);
        }
      }
    }
    result.set(group.key, sortPortsForRole(group.role, [...ports]));
  }
  return result;
}

function preferredPortsForRole(role: string): string[] {
  const bit = role.match(/^sar_bit_(\d+)_slice$/);
  if (bit) {
    const index = bit[1];
    return [
      `phi_bit_${index}`,
      `phi_cap_${index}`,
      `cmp_logic_p`,
      `cmp_logic_n`,
      `dout${index}`,
      `sp${index}`,
      `sn${index}`,
      "bp_hi",
      "bp_mid",
      "bp_lo",
      "vdd",
      "vss",
      "start",
      "start_bar",
      `phi_dec_${index}`,
    ];
  }
  const preferred: Record<string, string[]> = {
    timing_controller: [
      "clk",
      "start",
      "rst_n",
      "vdd",
      "vss",
      "valid",
      "eoc",
      "cmp_eval",
      "phi_bit_9",
      "phi_dec_9",
      "phi_cap_9",
      "phi_bit_0",
    ],
    input_sampling: ["vip", "vin", "start", "start_bar", "cdac_p", "cdac_n", "vdd", "vss"],
    reference_ladder: ["vref", "bp_hi", "bp_mid", "bp_lo", "vdd", "vss"],
    cdac_p_array: ["cdac_p", "sp0", "sp1", "sp2", "sp3", "sp4", "sp5", "sp6", "sp7", "sp8", "sp9", "vss"],
    cdac_n_array: ["cdac_n", "sn0", "sn1", "sn2", "sn3", "sn4", "sn5", "sn6", "sn7", "sn8", "sn9", "vss"],
    comparator_core: [
      "cdac_p",
      "cdac_n",
      "cmp_eval",
      "cmp_logic_p",
      "cmp_logic_n",
      "comp_p",
      "comp_n",
      "cmp_logic_eval",
      "vdd",
      "vss",
    ],
  };
  return preferred[role] ?? ["vdd", "vss"];
}

function sortPortsForRole(role: string, ports: readonly string[]): string[] {
  const unique = uniqueByKey(ports);
  const preferred = preferredPortsForRole(role);
  const preferredKeys = new Map(preferred.map((port, index) => [netKey(port), index]));
  return unique.sort((left, right) => {
    const leftPreferred = preferredKeys.get(netKey(left));
    const rightPreferred = preferredKeys.get(netKey(right));
    if (leftPreferred !== undefined || rightPreferred !== undefined) {
      return (leftPreferred ?? 10_000) - (rightPreferred ?? 10_000);
    }
    const leftSupply = isSupplyOrReference(left) ? 0 : 1;
    const rightSupply = isSupplyOrReference(right) ? 0 : 1;
    return leftSupply - rightSupply || compareText(left, right);
  });
}

function chooseVisiblePorts(role: string, childPorts: readonly string[]): string[] {
  const preferred = preferredPortsForRole(role);
  const byKey = new Map(childPorts.map((port) => [netKey(port), port]));
  const visible: string[] = [];
  for (const preferredPort of preferred) {
    const actual = byKey.get(netKey(preferredPort));
    if (actual && !visible.some((port) => netKey(port) === netKey(actual))) visible.push(actual);
    if (visible.length >= PIN_IDS.length) return visible;
  }
  for (const port of childPorts) {
    if (!visible.some((existing) => netKey(existing) === netKey(port))) visible.push(port);
    if (visible.length >= PIN_IDS.length) break;
  }
  return visible;
}

function childNetlistForGroup(group: ModuleGroup): string {
  return [
    `simulator lang=spectre`,
    `subckt ${group.cell}${group.childPorts.length ? ` ${group.childPorts.join(" ")}` : ""}`,
    ...group.instances.map((instance) => `  ${instance.source}`),
    `ends ${group.cell}`,
    "",
  ].join("\n");
}

function buildChildDocument(
  group: ModuleGroup,
  project: string,
  library: string,
  topCell: string,
  sourceRun: string,
): SchematicDocument {
  const imported = importNetlistAsSchematic(childNetlistForGroup(group), {
    project,
    cell: group.cell,
    library,
  });
  return parseSchematicDocument({
    ...imported,
    properties: {
      ...imported.properties,
      generatedBy: GENERATOR,
      sourceFlow: "sar_adc_flat_dut_partition",
      sourceRun,
      topCell,
      moduleRole: group.role,
      sourceInstanceCount: String(group.instances.length),
    },
    extensions: {
      ...imported.extensions,
      sarAdcModuleSource: {
        schema: "analog_studio.sar_adc_module_source.v1",
        role: group.role,
        cell: group.cell,
        sourceInstanceCount: group.instances.length,
        childPorts: group.childPorts,
        sourceLineNumbers: group.instances.map((instance) => instance.lineNumber),
      },
    },
  });
}

function chooseSubcktKind(pinCount: number): DeviceKind {
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

function pinSide(node: SchematicNode, portId: string) {
  return getDeviceDefinition(node.kind).pins.find((pin) => pin.id === portId)?.side ?? "right";
}

function stubTarget(node: SchematicNode, terminal: EdgeTerminal, index: number): Point {
  const origin = getPinWorldPosition(node, terminal.portId) ?? { x: node.x, y: node.y };
  const side = pinSide(node, terminal.portId);
  const length = 24 + (index % 3) * 4;
  if (side === "left") return { x: snapToElectricalGrid(origin.x - length), y: origin.y };
  if (side === "right") return { x: snapToElectricalGrid(origin.x + length), y: origin.y };
  if (side === "top") return { x: origin.x, y: snapToElectricalGrid(origin.y - length) };
  return { x: origin.x, y: snapToElectricalGrid(origin.y + length) };
}

function labelAnchor(source: Point, target: Point): Point {
  return {
    x: snapToElectricalGrid((source.x + target.x) / 2),
    y: snapToElectricalGrid((source.y + target.y) / 2),
  };
}

function addNetStub(
  nodes: readonly SchematicNode[],
  edges: SchematicEdge[],
  netLabels: NetLabel[],
  terminal: EdgeTerminal,
  net: string,
  index: number,
) {
  const node = nodes.find((candidate) => candidate.id === terminal.nodeId);
  if (!node) return;
  const source = getPinWorldPosition(node, terminal.portId) ?? { x: node.x, y: node.y };
  const target = stubTarget(node, terminal, index);
  const edge: SchematicEdge = {
    id: `wire_${edges.length + 1}`,
    source: terminal,
    target,
    style: "NORMAL",
    width: 1,
    creationOrder: edges.length + 1,
  };
  edges.push(edge);
  netLabels.push({
    id: `label_${cleanIdentifier(net, "net", 44)}_${netLabels.length + 1}`,
    text: net,
    wireId: edge.id,
    segmentIndex: 0,
    anchorPoint: labelAnchor(source, target),
    orientation: 0,
    textAlignment: "middle",
  });
}

function topPortKind(port: string): DeviceKind {
  const normalized = netKey(port);
  if (/^(dout\d+|valid|eoc|comp_[pn])$/.test(normalized)) return "output";
  if (/^(sp\d+|sn\d+|cdac_[pn])$/.test(normalized)) return "bidir";
  return "input";
}

function topPortPlacement(port: string, inputIndex: number, rightIndex: number): Point {
  const normalized = netKey(port);
  const fixedLeft = ["vip", "vin", "clk", "start", "rst_n", "vref", "vdd", "vss"];
  const fixedIndex = fixedLeft.indexOf(normalized);
  if (fixedIndex >= 0) return { x: 70, y: 130 + fixedIndex * 82 };
  if (/^dout\d+$/.test(normalized)) {
    const bit = Number(normalized.replace("dout", ""));
    return { x: 2750, y: 120 + bit * 58 };
  }
  if (/^sp\d+$/.test(normalized)) {
    const bit = Number(normalized.replace("sp", ""));
    return { x: 2750, y: 740 + bit * 48 };
  }
  if (/^sn\d+$/.test(normalized)) {
    const bit = Number(normalized.replace("sn", ""));
    return { x: 2950, y: 740 + bit * 48 };
  }
  if (normalized === "valid" || normalized === "eoc" || normalized === "comp_p" || normalized === "comp_n") {
    const order = ["comp_p", "comp_n", "valid", "eoc"].indexOf(normalized);
    return { x: 2750, y: 610 + Math.max(order, 0) * 58 };
  }
  if (normalized === "cdac_p" || normalized === "cdac_n") {
    return { x: 1080, y: normalized.endsWith("_p") ? 255 : 625 };
  }
  return topPortKind(port) === "input"
    ? { x: 70, y: 130 + inputIndex * 82 }
    : { x: 2750, y: 120 + rightIndex * 58 };
}

function addTopPorts(
  nodes: SchematicNode[],
  edges: SchematicEdge[],
  netLabels: NetLabel[],
  topPorts: readonly string[],
) {
  let inputIndex = 0;
  let rightIndex = 0;
  for (const port of topPorts) {
    const kind = topPortKind(port);
    const placement = topPortPlacement(port, inputIndex, rightIndex);
    if (kind === "input" && !["vip", "vin", "clk", "start", "rst_n", "vref", "vdd", "vss"].includes(netKey(port))) {
      inputIndex += 1;
    }
    if (kind !== "input") rightIndex += 1;
    const seed = createDeviceNode(kind, placement.x, placement.y, nodes);
    const node: SchematicNode = {
      ...seed,
      id: `port_${cleanIdentifier(port, "net", 72)}`,
      instanceName: port.toUpperCase(),
      properties: {
        ...seed.properties,
        netName: port,
      },
    };
    nodes.push(node);
    addNetStub(nodes, edges, netLabels, { nodeId: node.id, portId: "P" }, port, edges.length);
  }
}

function addModuleInstance(
  nodes: SchematicNode[],
  edges: SchematicEdge[],
  netLabels: NetLabel[],
  group: ModuleGroup,
  child: SchematicDocument,
) {
  const kind = chooseSubcktKind(group.visiblePorts.length);
  const seed = createDeviceNode(kind, group.x, group.y, nodes);
  const childKey = rootCellKey(child);
  const portProperties = Object.fromEntries(PIN_IDS.map((pin, index) => [`port_${pin}`, group.visiblePorts[index] ?? ""]));
  const node: SchematicNode = {
    ...seed,
    id: `inst_${cleanIdentifier(group.cell, "module", 72)}`,
    instanceName: group.instanceName,
    properties: {
      ...seed.properties,
      master: child.cell,
      hierarchyChildKey: childKey,
      hierarchyCell: child.cell,
      hierarchyLibrary: child.library,
      hierarchyView: child.view,
      hierarchyEditable: "true",
      generatedBy: GENERATOR,
      moduleRole: group.role,
      sourceInstanceCount: String(group.instances.length),
      sourcePortCount: String(group.childPorts.length),
      portOrder: group.visiblePorts.join(","),
      portOrderFull: group.childPorts.join(","),
      moduleLabel: group.label,
      ...portProperties,
    },
  };
  nodes.push(node);
  group.visiblePorts.forEach((net, index) => {
    addNetStub(nodes, edges, netLabels, { nodeId: node.id, portId: PIN_IDS[index] }, net, index);
  });
}

function assignPorts(groups: ModuleGroup[], topPorts: readonly string[]) {
  const childPortsByRole = buildChildPorts(groups, topPorts);
  groups.forEach((group) => {
    const childPorts = childPortsByRole.get(group.key) ?? [];
    group.childPorts = childPorts;
    group.visiblePorts = chooseVisiblePorts(group.role, childPorts);
  });
}

export function importSarAdcFlatNetlistAsHierarchy(
  text: string,
  options: SarAdcHierarchicalImportOptions = {},
): SarAdcHierarchicalImportResult {
  const parsed = parseSarNetlist(text);
  if (!parsed.instances.length) throw new Error("SAR ADC netlist did not contain any supported instances.");
  const project = documentName(options.project, "SAR_ADC");
  const topCell = documentName(options.cell || parsed.cellName, "sar_adc_dut");
  const library = documentName(options.library, "AS_SAR_ADC_REAL");
  const sourceRun = options.sourceRun ?? "";
  const groups = buildGroups(parsed.instances);
  assignPorts(groups, parsed.ports);

  const children = groups.map((group) => buildChildDocument(group, project, library, topCell, sourceRun));
  const rootSeed = createEmptyDocument(project, topCell);
  const nodes: SchematicNode[] = [];
  const edges: SchematicEdge[] = [];
  const netLabels: NetLabel[] = [];
  addTopPorts(nodes, edges, netLabels, parsed.ports);
  groups.forEach((group, index) => addModuleInstance(nodes, edges, netLabels, group, children[index]));

  let document: SchematicDocument = {
    ...rootSeed,
    library,
    nodes: nodes.sort((left, right) => compareText(left.id, right.id)),
    edges,
    netLabels,
    properties: {
      ...rootSeed.properties,
      generatedBy: GENERATOR,
      sourceFlow: "sar_adc_flat_dut_partition",
      sourceRun,
      sourceTopCell: parsed.cellName,
      sourceInstanceCount: String(parsed.instances.length),
      sourceModuleCount: String(groups.length),
      hierarchyEditable: "true",
      routingStyle: "hierarchical_named_net_stubs",
    },
    revisions: {
      designRevision: 1,
      savedRevision: 0,
      connectivityRevision: 0,
      checkRevision: 0,
    },
    extensions: {
      sarAdcHierarchyImport: {
        schema: "analog_studio.sar_adc_hierarchy_import.v1",
        generator: GENERATOR,
        sourceRun,
        topCell,
        sourceInstanceCount: parsed.instances.length,
        topPorts: parsed.ports,
        modules: groups.map((group) => ({
          cell: group.cell,
          role: group.role,
          instanceName: group.instanceName,
          sourceInstanceCount: group.instances.length,
          childPorts: group.childPorts,
          visiblePorts: group.visiblePorts,
        })),
        unsupportedLines: parsed.unsupported.slice(0, 20),
      },
    },
  };
  children.forEach((child) => {
    document = withHierarchyCellView(document, child, false);
  });
  const validated = parseSchematicDocument(document);
  return {
    document: validated,
    summary: {
      schema: "analog_studio.sar_adc_hierarchy_import.v1",
      generator: GENERATOR,
      topCell,
      sourceInstanceCount: parsed.instances.length,
      topPortCount: parsed.ports.length,
      moduleCount: groups.length,
      unsupportedLineCount: parsed.unsupported.length,
      topLevelNodeCount: validated.nodes.length,
      topLevelEdgeCount: validated.edges.length,
      modules: groups.map((group) => ({
        cell: group.cell,
        role: group.role,
        instanceCount: group.instances.length,
        childPortCount: group.childPorts.length,
        visiblePortCount: group.visiblePorts.length,
        hiddenPortCount: Math.max(0, group.childPorts.length - group.visiblePorts.length),
      })),
    },
  };
}
