import {
  extractConnectivity,
  terminalNetName,
  type ConnectivityIssue,
  type LogicalNet,
  type TerminalRef,
} from "./connectivity";
import {
  getDeviceDefinition,
  orientationOf,
  type DeviceKind,
  type SchematicDocument,
  type SchematicNode,
} from "./schematic";
import { hierarchyCellViews } from "./hierarchy";

export type NetlistDialect = "spectre" | "spice" | "cdl" | "empyrean_cdl" | "oa_exchange" | "cadence_skill";

export interface ERCIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  objectRefs?: string[];
  nodeId?: string;
  portId?: string;
  edgeId?: string;
}
export type NetTerminal = TerminalRef;

export interface CompiledNet {
  id: string;
  name: string;
  terminals: NetTerminal[];
  wireIds: string[];
  global: boolean;
}

export interface CompileResult {
  text: string;
  issues: ERCIssue[];
  nets: CompiledNet[];
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en", { numeric: true, sensitivity: "base" });
}

function cleanIdentifier(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const replaced = trimmed.replace(/[^A-Za-z0-9_.$!]/g, "_");
  return /^[A-Za-z_]/.test(replaced) ? replaced : `_${replaced}`;
}

function property(node: SchematicNode, key: string): string {
  const exact = node.properties[key];
  if (exact !== undefined) return exact;
  const match = Object.entries(node.properties)
    .find(([candidate]) => candidate.toLowerCase() === key.toLowerCase());
  return match?.[1] ?? "";
}

function mapConnectivityIssue(issue: ConnectivityIssue): ERCIssue {
  return {
    severity: issue.severity === "error" ? "error" : "warning",
    code: issue.code,
    message: issue.message,
    objectRefs: issue.objectRefs,
    nodeId: issue.nodeId,
    portId: issue.portId,
    edgeId: issue.edgeId,
  };
}

function validateName(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_.$!]*$/.test(value);
}

function collectERC(
  document: SchematicDocument,
  logicalNets: readonly LogicalNet[],
  terminalConnectionCount: ReadonlyMap<string, number>,
  connectivityIssues: readonly ConnectivityIssue[],
): ERCIssue[] {
  const issues = connectivityIssues.map(mapConnectivityIssue);
  const instanceNames = new Map<string, SchematicNode[]>();
  const noConnectTerminals = new Set(document.noConnects.map((item) => `${item.nodeId}\u0000${item.portId}`));

  for (const node of document.nodes) {
    const definition = getDeviceDefinition(node.kind);
    if (definition.netlistable) {
      const name = node.instanceName.trim();
      if (!name || !validateName(name)) {
        issues.push({
          severity: "error",
          code: "ILLEGAL_INSTANCE_NAME",
          message: `${definition.label} 的实例名为空或包含非法字符。`,
          objectRefs: [node.id],
          nodeId: node.id,
        });
      } else {
        const values = instanceNames.get(name.toUpperCase()) ?? [];
        values.push(node);
        instanceNames.set(name.toUpperCase(), values);
      }
    }

    for (const pin of definition.pins) {
      if (!pin.required) continue;
      const key = `${node.id}\u0000${pin.id}`;
      if ((terminalConnectionCount.get(`T:${key}`) ?? 0) > 0 || noConnectTerminals.has(key)) continue;
      issues.push({
        severity: "warning",
        code: "UNCONNECTED_REQUIRED_TERMINAL",
        message: `${node.instanceName || definition.label} 的 ${pin.id} 端口未连接。`,
        objectRefs: [node.id],
        nodeId: node.id,
        portId: pin.id,
      });
    }

    for (const required of definition.requiredProperties) {
      if (property(node, required).trim()) continue;
      issues.push({
        severity: "error",
        code: "EMPTY_PARAMETER",
        message: `${node.instanceName || definition.label} 的参数 ${required} 不能为空。`,
        objectRefs: [node.id],
        nodeId: node.id,
      });
    }
  }

  for (const duplicates of instanceNames.values()) {
    if (duplicates.length < 2) continue;
    for (const node of duplicates) {
      issues.push({
        severity: "error",
        code: "DUPLICATE_INSTANCE_NAME",
        message: `实例名 “${node.instanceName}” 重复。`,
        objectRefs: duplicates.map((candidate) => candidate.id),
        nodeId: node.id,
      });
    }
  }

  const topPinNames = new Map<string, SchematicNode[]>();
  for (const node of document.nodes.filter((candidate) =>
    candidate.kind === "input" || candidate.kind === "output" || candidate.kind === "bidir")) {
    const name = (property(node, "netName") || node.instanceName).trim();
    const values = topPinNames.get(name) ?? [];
    values.push(node);
    topPinNames.set(name, values);
  }
  for (const duplicates of topPinNames.values()) {
    if (duplicates.length < 2) continue;
    duplicates.forEach((node) => issues.push({
      severity: "error",
      code: "DUPLICATE_PIN_NAME",
      message: `顶层 Pin 名称 “${property(node, "netName") || node.instanceName}” 重复。`,
      objectRefs: duplicates.map((candidate) => candidate.id),
      nodeId: node.id,
    }));
  }

  // A named net that contains several conflicting explicit names is already
  // reported by extraction. Keep logical net ordering deterministic here.
  void logicalNets;
  return issues.sort((left, right) => {
    if (left.severity !== right.severity) return left.severity === "error" ? -1 : 1;
    return compareText(left.code, right.code)
      || compareText(left.nodeId ?? left.edgeId ?? "", right.nodeId ?? right.edgeId ?? "")
      || compareText(left.portId ?? "", right.portId ?? "");
  });
}

function netFor(
  document: SchematicDocument,
  connectivity: ReturnType<typeof extractConnectivity>,
  node: SchematicNode,
  portId: string,
): string {
  const key = `T:${node.id}\u0000${portId}`;
  const noConnect = document.noConnects.some((item) => item.nodeId === node.id && item.portId === portId);
  if (noConnect || (connectivity.terminalConnectionCount.get(key) ?? 0) === 0) return "NC";
  return terminalNetName(connectivity, node.id, portId) ?? "NC";
}

const MACRO_KINDS = new Set<DeviceKind>([
  "transmission_gate",
  "sampling_switch",
  "cdac_array",
  "sar_logic",
  "dynamic_comparator",
  "diff_pair",
  "current_mirror",
  "bias_current",
  "gain_stage",
  "latch",
  "opamp3",
  "subckt4",
  "subckt5",
  "subckt6",
  "subckt7",
  "subckt8",
  "subckt9",
  "subckt10",
  "subckt11",
  "subckt12",
]);

function macroMaster(node: SchematicNode): string {
  return cleanIdentifier(property(node, "master") || node.kind, node.kind);
}

const INTERNAL_NETLIST_PROPERTY_KEYS = new Set([
  "hierarchycell",
  "hierarchychildkey",
  "hierarchyeditable",
  "hierarchylibrary",
  "hierarchyview",
  "master",
  "originalline",
  "portorder",
  "portorderfull",
  "templatekind",
]);

function isInternalNetlistProperty(key: string): boolean {
  const lower = key.toLowerCase();
  return INTERNAL_NETLIST_PROPERTY_KEYS.has(lower)
    || lower.startsWith("cadence")
    || lower.startsWith("port_");
}

function macroParameterSuffix(node: SchematicNode, casing: "lower" | "upper"): string {
  return Object.entries(node.properties)
    .filter(([key, value]) => !isInternalNetlistProperty(key) && String(value).trim())
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, value]) => `${casing === "upper" ? key.toUpperCase() : key}=${value}`)
    .join(" ");
}

function sourcePrimitiveKindFromText(value: string): "vsource" | "isource" | null {
  const lower = value.trim().toLowerCase();
  if (/^(isource|idc|iac)$/.test(lower)) return "isource";
  if (/^(vsource|vdc|vac)$/.test(lower)) return "vsource";
  return null;
}

function sourcePrimitiveForNode(node: SchematicNode): "vsource" | "isource" | null {
  if (node.kind === "vsource" || node.kind === "isource") return node.kind;
  for (const candidate of [
    property(node, "master"),
    property(node, "cadenceMasterCell"),
    property(node, "sourcePrimitiveType"),
    property(node, "source_primitive_type"),
  ]) {
    const primitive = sourcePrimitiveKindFromText(candidate);
    if (primitive) return primitive;
  }
  return null;
}

function sourceDcValue(node: SchematicNode, primitive: "vsource" | "isource"): string {
  const keys = primitive === "isource"
    ? ["dc", "idc", "i", "value"]
    : ["dc", "vdc", "v", "value"];
  for (const key of keys) {
    const value = property(node, key).trim();
    if (value) return value;
  }
  const expression = property(node, "source_expression").trim();
  const match = /^dc\s+(.+)$/i.exec(expression);
  return match?.[1]?.trim() || "?";
}

function splitPortOrder(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function macroPinsForNode(
  document: SchematicDocument,
  node: SchematicNode,
  connectivity: ReturnType<typeof extractConnectivity>,
): string[] {
  const definitionPins = getDeviceDefinition(node.kind).pins;
  const localPins = definitionPins.map((pin) => netFor(document, connectivity, node, pin.id));
  const sourceOrder = splitPortOrder(property(node, "portOrderFull"));
  if (!MACRO_KINDS.has(node.kind) || !sourceOrder.length) return localPins;

  const localPortBySourcePin = new Map<string, string>();
  for (const pin of definitionPins) {
    const sourcePin = property(node, `port_${pin.id}`).trim();
    if (sourcePin) localPortBySourcePin.set(sourcePin.toUpperCase(), pin.id);
  }
  const reordered = sourceOrder.map((sourcePin) => {
    const localPort = localPortBySourcePin.get(sourcePin.toUpperCase());
    return localPort ? netFor(document, connectivity, node, localPort) : undefined;
  });
  return reordered.every((net): net is string => typeof net === "string") ? reordered : localPins;
}

function sourceAcValue(node: SchematicNode, primitive: "vsource" | "isource"): string {
  const keys = primitive === "isource" ? ["ac", "iac", "acmag"] : ["ac", "vac", "acmag"];
  for (const key of keys) {
    const value = property(node, key).trim();
    if (value && value !== "0") return value;
  }
  return "";
}

function formatSpectreSourceInstance(
  node: SchematicNode,
  pins: readonly string[],
  primitive: "vsource" | "isource",
): string {
  const sourcePins = pins.slice(0, 2);
  const ac = sourceAcValue(node, primitive);
  return `${node.instanceName} (${sourcePins.join(" ")}) ${primitive} dc=${sourceDcValue(node, primitive)}${ac ? ` acmag=${ac}` : ""}`;
}

function formatSpiceSourceInstance(
  node: SchematicNode,
  pins: readonly string[],
  primitive: "vsource" | "isource",
): string {
  const sourcePins = pins.slice(0, 2);
  const ac = sourceAcValue(node, primitive);
  return `${node.instanceName} ${sourcePins.join(" ")} DC ${sourceDcValue(node, primitive)}${ac ? ` AC ${ac}` : ""}`;
}

function formatCdlSourceInstance(
  node: SchematicNode,
  pins: readonly string[],
  primitive: "vsource" | "isource",
): string {
  const sourcePins = pins.slice(0, 2);
  return `* ${node.instanceName} ${sourcePins.join(" ")} ${primitive} DC=${sourceDcValue(node, primitive)}`;
}

function formatSpectreInstance(
  document: SchematicDocument,
  node: SchematicNode,
  connectivity: ReturnType<typeof extractConnectivity>,
): string | null {
  const pins = macroPinsForNode(document, node, connectivity);
  const sourcePrimitive = sourcePrimitiveForNode(node);
  if (node.kind === "vsource" || node.kind === "isource") {
    return formatSpectreSourceInstance(node, pins, sourcePrimitive ?? node.kind);
  }
  if (node.kind === "nmos4" || node.kind === "pmos4") {
    return `${node.instanceName} (${pins.join(" ")}) ${property(node, "model") || "model_missing"} w=${property(node, "W") || "?"} l=${property(node, "L") || "?"} m=${property(node, "M") || "?"} nf=${property(node, "NF") || "?"}`;
  }
  if (node.kind === "diode") {
    return `${node.instanceName} (${pins.join(" ")}) ${property(node, "model") || "diode"} area=${property(node, "area") || "1"} m=${property(node, "M") || "1"}`;
  }
  if (node.kind === "npn3" || node.kind === "pnp3") {
    return `${node.instanceName} (${pins.join(" ")}) ${property(node, "model") || (node.kind === "pnp3" ? "pnp" : "npn")} area=${property(node, "area") || "1"} m=${property(node, "M") || "1"}`;
  }
  if (node.kind === "resistor") return `${node.instanceName} (${pins.join(" ")}) resistor r=${property(node, "value") || "?"}`;
  if (node.kind === "capacitor") return `${node.instanceName} (${pins.join(" ")}) capacitor c=${property(node, "value") || "?"}`;
  if (node.kind === "inductor") return `${node.instanceName} (${pins.join(" ")}) inductor l=${property(node, "value") || "?"}`;
  if (node.kind === "vcvs") return `${node.instanceName} (${pins.join(" ")}) vcvs gain=${property(node, "gain") || "?"}`;
  if (node.kind === "vccs") return `${node.instanceName} (${pins.join(" ")}) vccs gm=${property(node, "gm") || "?"}`;
  if (node.kind === "switch4") {
    return `${node.instanceName} (${pins.join(" ")}) switch model=${property(node, "model") || "sw"} ron=${property(node, "ron") || "1"} roff=${property(node, "roff") || "1G"} vt=${property(node, "vt") || "0.5"} vh=${property(node, "vh") || "0"}`;
  }
  if (MACRO_KINDS.has(node.kind)) {
    if (sourcePrimitive) return formatSpectreSourceInstance(node, pins, sourcePrimitive);
    const suffix = macroParameterSuffix(node, "lower");
    return `${node.instanceName} (${pins.join(" ")}) ${macroMaster(node)}${suffix ? ` ${suffix}` : ""}`;
  }
  return null;
}

function formatSpiceInstance(
  document: SchematicDocument,
  node: SchematicNode,
  connectivity: ReturnType<typeof extractConnectivity>,
): string | null {
  const pins = macroPinsForNode(document, node, connectivity);
  const sourcePrimitive = sourcePrimitiveForNode(node);
  if (node.kind === "vsource" || node.kind === "isource") {
    return formatSpiceSourceInstance(node, pins, sourcePrimitive ?? node.kind);
  }
  if (node.kind === "nmos4" || node.kind === "pmos4") {
    return `${node.instanceName} ${pins.join(" ")} ${property(node, "model") || "model_missing"} W=${property(node, "W") || "?"} L=${property(node, "L") || "?"} M=${property(node, "M") || "?"} NF=${property(node, "NF") || "?"}`;
  }
  if (node.kind === "diode") {
    return `${node.instanceName} ${pins.join(" ")} ${property(node, "model") || "diode"} AREA=${property(node, "area") || "1"} M=${property(node, "M") || "1"}`;
  }
  if (node.kind === "npn3" || node.kind === "pnp3") {
    return `${node.instanceName} ${pins.join(" ")} ${property(node, "model") || (node.kind === "pnp3" ? "pnp" : "npn")} AREA=${property(node, "area") || "1"} M=${property(node, "M") || "1"}`;
  }
  if (node.kind === "resistor" || node.kind === "capacitor" || node.kind === "inductor") {
    return `${node.instanceName} ${pins.join(" ")} ${property(node, "value") || "?"}`;
  }
  if (node.kind === "vcvs") return `${node.instanceName} ${pins.join(" ")} ${property(node, "gain") || "?"}`;
  if (node.kind === "vccs") return `${node.instanceName} ${pins.join(" ")} ${property(node, "gm") || "?"}`;
  if (node.kind === "switch4") return `${node.instanceName} ${pins.join(" ")} ${property(node, "model") || "sw"}`;
  if (MACRO_KINDS.has(node.kind)) {
    if (sourcePrimitive) return formatSpiceSourceInstance(node, pins, sourcePrimitive);
    const suffix = macroParameterSuffix(node, "upper");
    return `${node.instanceName} ${pins.join(" ")} ${macroMaster(node)}${suffix ? ` ${suffix}` : ""}`;
  }
  return null;
}

function formatCdlInstance(
  document: SchematicDocument,
  node: SchematicNode,
  connectivity: ReturnType<typeof extractConnectivity>,
): string | null {
  const pins = macroPinsForNode(document, node, connectivity);
  const sourcePrimitive = sourcePrimitiveForNode(node);
  if (node.kind === "vsource" || node.kind === "isource") {
    return formatCdlSourceInstance(node, pins, sourcePrimitive ?? node.kind);
  }
  if (node.kind === "nmos4" || node.kind === "pmos4") {
    return `${node.instanceName} ${pins.join(" ")} ${property(node, "model") || "model_missing"} W=${property(node, "W") || "?"} L=${property(node, "L") || "?"} M=${property(node, "M") || "?"} NF=${property(node, "NF") || "?"}`;
  }
  if (node.kind === "diode") {
    return `${node.instanceName} ${pins.join(" ")} ${property(node, "model") || "diode"} AREA=${property(node, "area") || "1"} M=${property(node, "M") || "1"}`;
  }
  if (node.kind === "npn3" || node.kind === "pnp3") {
    return `${node.instanceName} ${pins.join(" ")} ${property(node, "model") || (node.kind === "pnp3" ? "pnp" : "npn")} AREA=${property(node, "area") || "1"} M=${property(node, "M") || "1"}`;
  }
  if (node.kind === "resistor" || node.kind === "capacitor" || node.kind === "inductor") {
    return `${node.instanceName} ${pins.join(" ")} ${property(node, "value") || "?"}`;
  }
  if (node.kind === "vcvs") return `${node.instanceName} ${pins.join(" ")} ${property(node, "gain") || "?"}`;
  if (node.kind === "vccs") return `${node.instanceName} ${pins.join(" ")} ${property(node, "gm") || "?"}`;
  if (node.kind === "switch4") return `${node.instanceName} ${pins.join(" ")} ${property(node, "model") || "sw"}`;
  if (MACRO_KINDS.has(node.kind)) {
    if (sourcePrimitive) return formatCdlSourceInstance(node, pins, sourcePrimitive);
    const suffix = macroParameterSuffix(node, "upper");
    return `${node.instanceName} ${pins.join(" ")} ${macroMaster(node)}${suffix ? ` ${suffix}` : ""}`;
  }
  return null;
}

function collectPorts(
  document: SchematicDocument,
  connectivity: ReturnType<typeof extractConnectivity>,
): string[] {
  const portKinds = new Set<DeviceKind>(["input", "output", "bidir"]);
  const connectedPorts = [...new Set(document.nodes
    .filter((node) => portKinds.has(node.kind))
    .map((node) => netFor(document, connectivity, node, "P"))
    .filter((name) => name !== "NC"))];
  const connected = new Set(connectedPorts.map((name) => name.toLowerCase()));
  const importedOrder = splitPortOrder(document.properties?.importedPortOrder ?? "")
    .filter((name) => connected.has(name.toLowerCase()));
  const ordered = new Set(importedOrder.map((name) => name.toLowerCase()));
  return [...importedOrder, ...connectedPorts.filter((name) => !ordered.has(name.toLowerCase())).sort(compareText)];
}

function collectGlobals(
  document: SchematicDocument,
  connectivity: ReturnType<typeof extractConnectivity>,
): string[] {
  const explicitGlobalNets = connectivity.logicalNets.filter((net) => net.global).map((net) => net.name);
  const supplyNets = document.nodes
    .filter((node) => node.kind === "gnd" || node.kind === "vdd")
    .map((node) => netFor(document, connectivity, node, "P"))
    .filter((name) => name !== "NC");
  return [...new Set([...explicitGlobalNets, ...supplyNets])].sort((left, right) => {
    if (left === "0") return -1;
    if (right === "0") return 1;
    return compareText(left, right);
  });
}

function masterForNode(node: SchematicNode): { library: string; cell: string; view: string } {
  if (node.kind === "nmos4") return { library: "pdk", cell: property(node, "model") || "nmos", view: "symbol" };
  if (node.kind === "pmos4") return { library: "pdk", cell: property(node, "model") || "pmos", view: "symbol" };
  if (node.kind === "diode" || node.kind === "npn3" || node.kind === "pnp3") {
    return { library: "pdk", cell: property(node, "model") || node.kind, view: "symbol" };
  }
  if (node.kind === "resistor") return { library: "analogLib", cell: "res", view: "symbol" };
  if (node.kind === "capacitor") return { library: "analogLib", cell: "cap", view: "symbol" };
  if (node.kind === "inductor") return { library: "analogLib", cell: "ind", view: "symbol" };
  if (node.kind === "vsource") return { library: "analogLib", cell: "vsource", view: "symbol" };
  if (node.kind === "isource") return { library: "analogLib", cell: "isource", view: "symbol" };
  if (node.kind === "vcvs" || node.kind === "vccs" || node.kind === "switch4") {
    return { library: "analogLib", cell: node.kind, view: "symbol" };
  }
  if (MACRO_KINDS.has(node.kind)) return { library: "work", cell: macroMaster(node), view: "symbol" };
  return { library: "basic", cell: node.kind, view: "symbol" };
}

function collectNetTerminals(
  document: SchematicDocument,
  connectivity: ReturnType<typeof extractConnectivity>,
  node: SchematicNode,
) {
  return getDeviceDefinition(node.kind).pins.map((pin) => ({
    pin: pin.id,
    label: pin.label,
    net: netFor(document, connectivity, node, pin.id),
    required: pin.required,
  }));
}

function renderOaExchange(
  document: SchematicDocument,
  connectivity: ReturnType<typeof extractConnectivity>,
): string {
  const globals = collectGlobals(document, connectivity);
  const globalSet = new Set(globals);
  const payload = {
    format: "analog-studio-oa-exchange",
    version: 1,
    policy: {
      openAccessBinaryGenerated: false,
      backendJobRequired: true,
      note: "This browser export is a safe exchange package. A configured Cadence/OpenAccess backend must create the real OA library.",
    },
    source: {
      editorProfile: document.editorProfile,
      documentVersion: document.version,
      formatVersion: document.formatVersion,
      project: document.project,
      library: document.library,
      cell: document.cell,
      view: document.view,
      units: document.units,
    },
    cellview: {
      library: cleanIdentifier(document.library || document.project, "work"),
      cell: cleanIdentifier(document.cell, "untitled"),
      view: "schematic",
    },
    ports: collectPorts(document, connectivity).filter((port) => !globalSet.has(port)),
    globals,
    instances: document.nodes
      .filter((node) => getDeviceDefinition(node.kind).netlistable)
      .sort((left, right) => compareText(left.instanceName, right.instanceName) || compareText(left.id, right.id))
      .map((node) => ({
        id: node.id,
        name: cleanIdentifier(node.instanceName, node.id),
        kind: node.kind,
        master: masterForNode(node),
        terminals: collectNetTerminals(document, connectivity, node),
        properties: { ...node.properties },
        placement: {
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          orientation: orientationOf(node),
        },
      })),
    nets: connectivity.logicalNets.map((net) => ({
      name: net.name,
      global: net.global,
      terminals: net.terminals,
      wireIds: net.wireIds,
    })),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function skillString(value: string): string {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

function renderCadenceSkillImporter(
  document: SchematicDocument,
  connectivity: ReturnType<typeof extractConnectivity>,
): string {
  const cell = cleanIdentifier(document.cell, "untitled");
  const library = cleanIdentifier(document.library || document.project, "work");
  const lines = [
    `; Analog Studio Cadence SKILL importer scaffold`,
    `; Source: ${document.project} / ${document.cell} / schematic`,
    `; Generated from analog_studio_oa_exchange data; run only inside a configured Virtuoso/OpenAccess session.`,
    `(procedure (analogStudioImport_${cell} @optional (targetLib ${skillString(library)}))`,
    `  (let ((cv nil))`,
    `    (setq cv (dbOpenCellViewByType targetLib ${skillString(cell)} "schematic" "schematic" "a"))`,
    `    (unless cv (error "Cannot open target schematic cellview"))`,
  ];
  for (const node of document.nodes
    .filter((candidate) => getDeviceDefinition(candidate.kind).netlistable)
    .sort((left, right) => compareText(left.instanceName, right.instanceName) || compareText(left.id, right.id))) {
    const master = masterForNode(node);
    const nets = collectNetTerminals(document, connectivity, node).map((terminal) => terminal.net);
    lines.push(
      `    ; ${node.instanceName} ${node.kind} ${nets.join(" ")}`,
      `    (schCreateInst cv (dbOpenCellViewByType ${skillString(master.library)} ${skillString(master.cell)} ${skillString(master.view)} nil "r") ${skillString(node.instanceName)} (list ${Math.round(node.x)} ${Math.round(node.y)}) ${skillString(orientationOf(node))} 1)`,
    );
  }
  lines.push(
    `    (schCheck cv)`,
    `    (dbSave cv)`,
    `    cv`,
    `  )`,
    `)`,
    ``,
  );
  return lines.join("\n");
}

function renderNetlist(
  document: SchematicDocument,
  dialect: NetlistDialect,
  connectivity: ReturnType<typeof extractConnectivity>,
): string {
  const cell = cleanIdentifier(document.cell, "untitled");
  const project = document.project.trim() || "analog-studio";
  const globals = collectGlobals(document, connectivity);
  const globalSet = new Set(globals);
  const ports = collectPorts(document, connectivity).filter((port) => !globalSet.has(port));
  const instances = document.nodes
    .filter((node) => getDeviceDefinition(node.kind).netlistable)
    .sort((left, right) => compareText(left.instanceName, right.instanceName) || compareText(left.id, right.id));

  if (dialect === "spectre") {
    const lines = [`// ${project} / ${document.cell}`, "simulator lang=spectre"];
    if (globals.length) lines.push(`global ${globals.join(" ")}`);
    lines.push(`subckt ${cell}${ports.length ? ` ${ports.join(" ")}` : ""}`);
    for (const node of instances) {
      const instance = formatSpectreInstance(document, node, connectivity);
      if (instance) lines.push(`  ${instance}`);
    }
    lines.push(`ends ${cell}`, "");
    return lines.join("\n");
  }

  if (dialect === "oa_exchange") {
    return renderOaExchange(document, connectivity);
  }

  if (dialect === "cadence_skill") {
    return renderCadenceSkillImporter(document, connectivity);
  }

  if (dialect === "cdl" || dialect === "empyrean_cdl") {
    const header = dialect === "empyrean_cdl"
      ? [`* ${project} / ${document.cell}`, `* Empyrean-compatible CDL exchange generated by Analog Studio`]
      : [`* ${project} / ${document.cell}`, `* CDL exchange generated by Analog Studio`];
    const lines = [...header];
    const nonGroundGlobals = globals.filter((name) => name !== "0");
    if (nonGroundGlobals.length) lines.push(`.GLOBAL ${nonGroundGlobals.join(" ")}`);
    lines.push(`.SUBCKT ${cell}${ports.length ? ` ${ports.join(" ")}` : ""}`);
    for (const node of instances) {
      const instance = formatCdlInstance(document, node, connectivity);
      if (instance) lines.push(instance);
    }
    lines.push(`.ENDS ${cell}`, "");
    return lines.join("\n");
  }

  const lines = [`* ${project} / ${document.cell}`];
  const nonGroundGlobals = globals.filter((name) => name !== "0");
  if (nonGroundGlobals.length) lines.push(`.global ${nonGroundGlobals.join(" ")}`);
  lines.push(`.subckt ${cell}${ports.length ? ` ${ports.join(" ")}` : ""}`);
  for (const node of instances) {
    const instance = formatSpiceInstance(document, node, connectivity);
    if (instance) lines.push(instance);
  }
  lines.push(`.ends ${cell}`, "");
  return lines.join("\n");
}

export function compileNetlist(document: SchematicDocument, dialect: NetlistDialect): CompileResult {
  const connectivity = extractConnectivity(document);
  return {
    text: renderNetlist(document, dialect, connectivity),
    issues: collectERC(
      document,
      connectivity.logicalNets,
      connectivity.terminalConnectionCount,
      connectivity.issues,
    ),
    nets: connectivity.logicalNets.map((net) => ({
      id: net.id,
      name: net.name,
      terminals: net.terminals,
      wireIds: net.wireIds,
      global: net.global,
    })),
  };
}

function childNetlistFragment(text: string, dialect: NetlistDialect): string {
  const lines = text.trim().split(/\r?\n/);
  return lines.filter((line, index) => {
    if (index === 0 && (/^\/\//.test(line) || /^\*/.test(line))) return false;
    if (dialect === "spectre" && /^simulator\s+lang=/i.test(line)) return false;
    return true;
  }).join("\n");
}

export function compileHierarchicalNetlist(document: SchematicDocument, dialect: NetlistDialect): CompileResult {
  const root = compileNetlist(document, dialect);
  if (dialect === "oa_exchange" || dialect === "cadence_skill") return root;
  const children = Object.values(hierarchyCellViews(document))
    .sort((left, right) => compareText(left.cell, right.cell))
    .map((child) => compileNetlist(child, dialect));
  if (!children.length) return root;
  return {
    text: [root.text.trim(), ...children.map((child) => childNetlistFragment(child.text, dialect)), ""].join("\n\n"),
    issues: [...root.issues, ...children.flatMap((child) => child.issues)],
    nets: root.nets,
  };
}
