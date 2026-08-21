import { extractConnectivity, type ConnectivityIssue } from "./connectivity";
import { compileNetlist, type ERCIssue } from "./netlist";
import {
  ELECTRICAL_GRID_SIZE,
  getDeviceDefinition,
  isEdgeTerminal,
  withCheckedRevision,
  type MarkerSeverity,
  type Point,
  type SchematicDocument,
  type SchematicMarker,
} from "./schematic";
import { isPointOnSegment, wirePathPoints, wireSegments } from "./schematicGeometry";

export interface RuleConfiguration {
  enabled: boolean;
  severity: MarkerSeverity;
  parameters: Record<string, number | string | boolean>;
  messageTemplate?: string;
}

export type RuleConfigurationMap = Record<string, RuleConfiguration>;

export interface CheckResult {
  document: SchematicDocument;
  markers: SchematicMarker[];
  errorCount: number;
  warningCount: number;
}

export const DEFAULT_RULES: RuleConfigurationMap = {
  UNBOUND_MASTER: { enabled: true, severity: "error", parameters: {} },
  DUPLICATE_INSTANCE_NAME: { enabled: true, severity: "error", parameters: {} },
  ILLEGAL_INSTANCE_NAME: { enabled: true, severity: "error", parameters: {} },
  ZERO_LENGTH_WIRE: { enabled: true, severity: "error", parameters: {} },
  INVALID_WIRE_GEOMETRY: { enabled: true, severity: "error", parameters: {} },
  MULTIPLE_EXPLICIT_NET_NAMES: { enabled: true, severity: "error", parameters: {} },
  SHORTED_NAMED_NETS: { enabled: true, severity: "error", parameters: {} },
  LABEL_NOT_ON_WIRE: { enabled: true, severity: "error", parameters: {} },
  NO_CONNECT_AND_WIRE: { enabled: true, severity: "error", parameters: {} },
  DUPLICATE_PIN_NAME: { enabled: true, severity: "error", parameters: {} },
  CORRUPTED_OBJECT_REFERENCE: { enabled: true, severity: "error", parameters: {} },
  UNCONNECTED_REQUIRED_TERMINAL: {
    enabled: true,
    severity: "warning",
    parameters: { checkFloatingTerminals: true },
  },
  DANGLING_WIRE: { enabled: true, severity: "warning", parameters: {} },
  OFF_GRID_ENDPOINT: {
    enabled: true,
    severity: "warning",
    parameters: { tolerance: 0 },
  },
  SOLDER_DOT_ON_CROSSOVER: {
    enabled: true,
    severity: "warning",
    parameters: { warn: true },
  },
  OVERLAPPING_INSTANCE: {
    enabled: true,
    severity: "warning",
    parameters: { overlapRatio: 0.5 },
  },
  FLIGHT_CONNECTION: { enabled: true, severity: "warning", parameters: {} },
  UNNAMED_TOP_LEVEL_NET: { enabled: true, severity: "warning", parameters: {} },
  OBSOLETE_MARKER: { enabled: true, severity: "warning", parameters: {} },
};

interface RawIssue {
  ruleId: string;
  severity: MarkerSeverity;
  message: string;
  objectRefs: string[];
  point?: Point;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en", { numeric: true, sensitivity: "base" });
}

function normalizeRefs(refs: readonly string[]): string[] {
  return [...new Set(refs.filter(Boolean))].sort(compareText);
}

function markerId(ruleId: string, objectRefs: readonly string[], point?: Point): string {
  const seed = `${ruleId}:${normalizeRefs(objectRefs).join(":")}:${point ? `${point.x},${point.y}` : ""}`;
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `marker_${ruleId.toLowerCase()}_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function objectBox(
  document: SchematicDocument,
  objectRefs: readonly string[],
  point?: Point,
): SchematicMarker["boundingBox"] {
  const boxes: SchematicMarker["boundingBox"][] = [];
  for (const id of objectRefs) {
    const node = document.nodes.find((candidate) => candidate.id === id);
    if (node) boxes.push({ x: node.x, y: node.y, width: node.width, height: node.height });
    const wire = document.edges.find((candidate) => candidate.id === id);
    if (wire) {
      const points = wirePathPoints(document, wire);
      if (points.length) {
        const xs = points.map((candidate) => candidate.x);
        const ys = points.map((candidate) => candidate.y);
        boxes.push({
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
        });
      }
    }
    const junction = document.explicitJunctions.find((candidate) => candidate.id === id);
    if (junction) boxes.push({ x: junction.point.x - 5, y: junction.point.y - 5, width: 10, height: 10 });
    const label = document.netLabels.find((candidate) => candidate.id === id);
    if (label) boxes.push({ x: label.anchorPoint.x, y: label.anchorPoint.y - 14, width: 80, height: 18 });
  }
  if (!boxes.length && point) return { x: point.x - 5, y: point.y - 5, width: 10, height: 10 };
  if (!boxes.length) return { x: 0, y: 0, width: 0, height: 0 };
  const minimumX = Math.min(...boxes.map((box) => box.x));
  const minimumY = Math.min(...boxes.map((box) => box.y));
  const maximumX = Math.max(...boxes.map((box) => box.x + box.width));
  const maximumY = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: minimumX, y: minimumY, width: maximumX - minimumX, height: maximumY - minimumY };
}

function fromIssue(issue: ERCIssue | ConnectivityIssue): RawIssue {
  return {
    ruleId: issue.code,
    severity: issue.severity,
    message: issue.message,
    objectRefs: "objectRefs" in issue && issue.objectRefs?.length
      ? issue.objectRefs
      : [issue.nodeId ?? issue.edgeId ?? ""].filter(Boolean),
    point: "point" in issue ? issue.point : undefined,
  };
}

function overlapArea(
  first: { x: number; y: number; width: number; height: number },
  second: { x: number; y: number; width: number; height: number },
): number {
  const width = Math.max(0, Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x));
  const height = Math.max(0, Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y));
  return width * height;
}

function collectAdditionalIssues(
  document: SchematicDocument,
  rules: RuleConfigurationMap,
): RawIssue[] {
  const issues: RawIssue[] = [];
  const connectivity = extractConnectivity(document);

  for (const label of document.netLabels) {
    const wire = document.edges.find((candidate) => candidate.id === label.wireId);
    const segment = wire && wireSegments(document, wire)[label.segmentIndex];
    if (!segment || !isPointOnSegment(label.anchorPoint, segment.start, segment.end)) {
      issues.push({
        ruleId: "LABEL_NOT_ON_WIRE",
        severity: "error",
        message: `Net Label “${label.text}” 未附着到有效 Wire segment。`,
        objectRefs: [label.id, label.wireId],
        point: label.anchorPoint,
      });
    }
  }

  const tolerance = Number(rules.OFF_GRID_ENDPOINT?.parameters.tolerance ?? 0);
  for (const wire of document.edges) {
    for (const endpoint of [wire.source, wire.target]) {
      if (isEdgeTerminal(endpoint)) continue;
      const dx = Math.abs(endpoint.x % ELECTRICAL_GRID_SIZE);
      const dy = Math.abs(endpoint.y % ELECTRICAL_GRID_SIZE);
      if (Math.min(dx, ELECTRICAL_GRID_SIZE - dx) <= tolerance
        && Math.min(dy, ELECTRICAL_GRID_SIZE - dy) <= tolerance) continue;
      issues.push({
        ruleId: "OFF_GRID_ENDPOINT",
        severity: "warning",
        message: `Wire “${wire.id}” 的 endpoint 不在 Snap Grid 上。`,
        objectRefs: [wire.id],
        point: endpoint,
      });
    }
    if (wire.style === "FLIGHT") {
      issues.push({
        ruleId: "FLIGHT_CONNECTION",
        severity: "warning",
        message: `Wire “${wire.id}” 使用 Flight 表示，尚未完成正常 Route。`,
        objectRefs: [wire.id],
      });
    }
  }

  const instances = document.nodes.filter((node) => getDeviceDefinition(node.kind).netlistable);
  const threshold = Number(rules.OVERLAPPING_INSTANCE?.parameters.overlapRatio ?? 0.5);
  for (let firstIndex = 0; firstIndex < instances.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < instances.length; secondIndex += 1) {
      const first = instances[firstIndex];
      const second = instances[secondIndex];
      const overlap = overlapArea(first, second);
      const smaller = Math.min(first.width * first.height, second.width * second.height);
      if (!smaller || overlap / smaller < threshold) continue;
      issues.push({
        ruleId: "OVERLAPPING_INSTANCE",
        severity: "warning",
        message: `${first.instanceName} 与 ${second.instanceName} 的 selection box 大面积重叠。`,
        objectRefs: [first.id, second.id],
      });
    }
  }

  for (const node of document.nodes.filter((candidate) =>
    candidate.kind === "input" || candidate.kind === "output" || candidate.kind === "bidir")) {
    const net = connectivity.logicalNets.find((candidate) =>
      candidate.terminals.some((terminal) => terminal.nodeId === node.id && terminal.portId === "P"));
    if (net?.canonicalName) continue;
    issues.push({
      ruleId: "UNNAMED_TOP_LEVEL_NET",
      severity: "warning",
      message: `顶层 Pin “${node.instanceName}” 所在网络没有显式名称。`,
      objectRefs: [node.id],
    });
  }

  return issues;
}

export function runSchematicCheck(
  document: SchematicDocument,
  overrides: Partial<RuleConfigurationMap> = {},
): CheckResult {
  const rules = Object.fromEntries(Object.entries(DEFAULT_RULES).map(([ruleId, defaults]) => [
    ruleId,
    { ...defaults, ...(overrides[ruleId] ?? {}), parameters: {
      ...defaults.parameters,
      ...(overrides[ruleId]?.parameters ?? {}),
    } },
  ])) as RuleConfigurationMap;
  const compiled = compileNetlist(document, "spectre");
  const raw = [
    ...compiled.issues.map(fromIssue),
    ...collectAdditionalIssues(document, rules),
  ];
  const unique = new Map<string, RawIssue>();
  for (const issue of raw) {
    const configuration = rules[issue.ruleId];
    if (configuration && !configuration.enabled) continue;
    const severity = configuration?.severity ?? issue.severity;
    const refs = normalizeRefs(issue.objectRefs);
    const id = markerId(issue.ruleId, refs, issue.point);
    unique.set(id, { ...issue, severity, objectRefs: refs });
  }
  const markers = [...unique.entries()].map(([id, issue]): SchematicMarker => ({
    id,
    ruleId: issue.ruleId,
    severity: issue.severity,
    message: issue.message,
    objectRefs: issue.objectRefs,
    boundingBox: objectBox(document, issue.objectRefs, issue.point),
    revision: document.revisions.designRevision,
    status: "active",
  })).sort((left, right) => {
    const severity = { error: 0, warning: 1, info: 2 } as const;
    return severity[left.severity] - severity[right.severity]
      || compareText(left.ruleId, right.ruleId)
      || compareText(left.id, right.id);
  });
  const checked = withCheckedRevision({ ...document, markers });
  return {
    document: checked,
    markers,
    errorCount: markers.filter((marker) => marker.severity === "error").length,
    warningCount: markers.filter((marker) => marker.severity === "warning").length,
  };
}
