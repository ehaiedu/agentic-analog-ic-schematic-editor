import {
  extractConnectivity,
  terminalNetName,
  type ConnectivityIssue,
  type LogicalNet,
  type TerminalRef,
} from "./connectivity";
import {
  getDeviceDefinition,
  type DeviceKind,
  type SchematicDocument,
  type SchematicNode,
} from "./schematic";

export type NetlistDialect = "spectre" | "spice";

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

function formatSpectreInstance(
  document: SchematicDocument,
  node: SchematicNode,
  connectivity: ReturnType<typeof extractConnectivity>,
): string | null {
  const pins = getDeviceDefinition(node.kind).pins.map((pin) => netFor(document, connectivity, node, pin.id));
  if (node.kind === "nmos4" || node.kind === "pmos4") {
    return `${node.instanceName} (${pins.join(" ")}) ${property(node, "model") || "model_missing"} w=${property(node, "W") || "?"} l=${property(node, "L") || "?"} m=${property(node, "M") || "?"} nf=${property(node, "NF") || "?"}`;
  }
  if (node.kind === "resistor") return `${node.instanceName} (${pins.join(" ")}) resistor r=${property(node, "value") || "?"}`;
  if (node.kind === "capacitor") return `${node.instanceName} (${pins.join(" ")}) capacitor c=${property(node, "value") || "?"}`;
  if (node.kind === "inductor") return `${node.instanceName} (${pins.join(" ")}) inductor l=${property(node, "value") || "?"}`;
  if (node.kind === "vsource" || node.kind === "isource") {
    const primitive = node.kind === "vsource" ? "vsource" : "isource";
    const ac = property(node, "ac");
    return `${node.instanceName} (${pins.join(" ")}) ${primitive} dc=${property(node, "dc") || "?"}${ac ? ` acmag=${ac}` : ""}`;
  }
  return null;
}

function formatSpiceInstance(
  document: SchematicDocument,
  node: SchematicNode,
  connectivity: ReturnType<typeof extractConnectivity>,
): string | null {
  const pins = getDeviceDefinition(node.kind).pins.map((pin) => netFor(document, connectivity, node, pin.id));
  if (node.kind === "nmos4" || node.kind === "pmos4") {
    return `${node.instanceName} ${pins.join(" ")} ${property(node, "model") || "model_missing"} W=${property(node, "W") || "?"} L=${property(node, "L") || "?"} M=${property(node, "M") || "?"} NF=${property(node, "NF") || "?"}`;
  }
  if (node.kind === "resistor" || node.kind === "capacitor" || node.kind === "inductor") {
    return `${node.instanceName} ${pins.join(" ")} ${property(node, "value") || "?"}`;
  }
  if (node.kind === "vsource" || node.kind === "isource") {
    const ac = property(node, "ac");
    return `${node.instanceName} ${pins.join(" ")} DC ${property(node, "dc") || "?"}${ac ? ` AC ${ac}` : ""}`;
  }
  return null;
}

function collectPorts(
  document: SchematicDocument,
  connectivity: ReturnType<typeof extractConnectivity>,
): string[] {
  const portKinds = new Set<DeviceKind>(["input", "output", "bidir"]);
  return [...new Set(document.nodes
    .filter((node) => portKinds.has(node.kind))
    .map((node) => netFor(document, connectivity, node, "P"))
    .filter((name) => name !== "NC"))].sort(compareText);
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

function renderNetlist(
  document: SchematicDocument,
  dialect: NetlistDialect,
  connectivity: ReturnType<typeof extractConnectivity>,
): string {
  const cell = cleanIdentifier(document.cell, "untitled");
  const project = document.project.trim() || "analog-agent-studio";
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
