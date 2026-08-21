import {
  getDeviceDefinition,
  getPinWorldPosition,
  isEdgeTerminal,
  type MarkerSeverity,
  type Point,
  type SchematicDocument,
  type SchematicNode,
} from "./schematic";
import {
  isPointOnSegment,
  orthogonalIntersection,
  pointKey,
  samePoint,
  wirePathPoints,
  wireSegments,
  type WireSegment,
} from "./schematicGeometry";
import { VSE_CORE_PROFILE } from "./compatibilityProfile";

export interface TerminalRef {
  nodeId: string;
  portId: string;
}

export interface ConnectivityIssue {
  severity: MarkerSeverity;
  code: string;
  message: string;
  objectRefs: string[];
  point?: Point;
  nodeId?: string;
  portId?: string;
  edgeId?: string;
}

export interface PhysicalNetComponent {
  id: string;
  wireIds: string[];
  terminalRefs: TerminalRef[];
  labelIds: string[];
  topologyNodes: Point[];
  explicitNames: string[];
}

export interface LogicalNet {
  id: string;
  name: string;
  canonicalName?: string;
  aliases: string[];
  physicalComponentIds: string[];
  wireIds: string[];
  terminals: TerminalRef[];
  labelIds: string[];
  global: boolean;
  issues: ConnectivityIssue[];
}

export interface ConnectivityResult {
  physicalComponents: PhysicalNetComponent[];
  logicalNets: LogicalNet[];
  terminalToNet: Map<string, string>;
  terminalConnectionCount: Map<string, number>;
  wireToNet: Map<string, string>;
  issues: ConnectivityIssue[];
  revision: number;
}

class UnionFind {
  private readonly parent = new Map<string, string>();

  add(value: string) {
    if (!this.parent.has(value)) this.parent.set(value, value);
  }

  find(value: string): string {
    this.add(value);
    const parent = this.parent.get(value)!;
    if (parent === value) return value;
    const root = this.find(parent);
    this.parent.set(value, root);
    return root;
  }

  union(left: string, right: string) {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot === rightRoot) return;
    this.parent.set(compareText(leftRoot, rightRoot) <= 0 ? rightRoot : leftRoot,
      compareText(leftRoot, rightRoot) <= 0 ? leftRoot : rightRoot);
  }
}

interface NameCandidate {
  value: string;
  priority: number;
  sourceId: string;
}

const terminalKey = (nodeId: string, portId: string) => `T:${nodeId}\u0000${portId}`;
const wireKey = (wireId: string) => `W:${wireId}`;

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en", { numeric: true, sensitivity: "base" });
}

function issueSort(left: ConnectivityIssue, right: ConnectivityIssue): number {
  const severityRank = { error: 0, warning: 1, info: 2 } as const;
  return severityRank[left.severity] - severityRank[right.severity]
    || compareText(left.code, right.code)
    || compareText(left.objectRefs.join("\u0000"), right.objectRefs.join("\u0000"));
}

function property(node: SchematicNode, key: string): string {
  const exact = node.properties[key];
  if (exact !== undefined) return exact;
  const match = Object.entries(node.properties)
    .find(([candidate]) => candidate.toLowerCase() === key.toLowerCase());
  return match?.[1] ?? "";
}

function namedNode(node: SchematicNode): NameCandidate | null {
  if (node.kind === "gnd") return { value: property(node, "netName") || "0", priority: 0, sourceId: node.id };
  if (node.kind === "vdd") return { value: property(node, "netName") || "VDD", priority: 1, sourceId: node.id };
  if (node.kind === "input" || node.kind === "output" || node.kind === "bidir") {
    return { value: property(node, "netName") || node.instanceName, priority: 0, sourceId: node.id };
  }
  // Kept only as a legacy fallback. Canonical v3 files store NetLabel objects.
  if (node.kind === "netlabel") {
    return { value: property(node, "netName") || node.instanceName, priority: 2, sourceId: node.id };
  }
  return null;
}

function nameKey(value: string): string {
  return VSE_CORE_PROFILE.naming.netNameCaseSensitive ? value : value.toLocaleLowerCase("en");
}

function componentSignature(
  wireIds: readonly string[],
  terminals: readonly TerminalRef[],
): string {
  const members = [
    ...wireIds.map((id) => `W:${id}`),
    ...terminals.map((terminal) => `T:${terminal.nodeId}:${terminal.portId}`),
  ].sort(compareText);
  return members.join("|");
}

function wireEndpoints(document: SchematicDocument, wireId: string): Point[] {
  const wire = document.edges.find((candidate) => candidate.id === wireId);
  if (!wire) return [];
  const points = wirePathPoints(document, wire);
  return points.length >= 2 ? [points[0], points[points.length - 1]] : [];
}

function segmentContainsAny(segment: WireSegment, points: readonly Point[]): boolean {
  return points.some((point) => isPointOnSegment(point, segment.start, segment.end));
}

function wiresConnect(
  document: SchematicDocument,
  firstId: string,
  secondId: string,
  segmentsByWire: ReadonlyMap<string, WireSegment[]>,
  explicitJunctionKeys: ReadonlySet<string>,
): boolean {
  const firstSegments = segmentsByWire.get(firstId) ?? [];
  const secondSegments = segmentsByWire.get(secondId) ?? [];
  const firstEndpoints = wireEndpoints(document, firstId);
  const secondEndpoints = wireEndpoints(document, secondId);

  if (firstSegments.some((segment) => segmentContainsAny(segment, secondEndpoints))) return true;
  if (secondSegments.some((segment) => segmentContainsAny(segment, firstEndpoints))) return true;

  for (const first of firstSegments) {
    for (const second of secondSegments) {
      const intersection = orthogonalIntersection(first.start, first.end, second.start, second.end);
      if (intersection.kind === "overlap") return true;
      if (intersection.kind === "point" && explicitJunctionKeys.has(pointKey(intersection.point))) return true;
    }
  }
  return false;
}

function endpointIsConnected(
  document: SchematicDocument,
  wireId: string,
  point: Point,
  segmentsByWire: ReadonlyMap<string, WireSegment[]>,
  terminalPositions: ReadonlyMap<string, Point>,
  explicitJunctionKeys: ReadonlySet<string>,
): boolean {
  if ([...terminalPositions.values()].some((candidate) => samePoint(candidate, point))) return true;
  if (explicitJunctionKeys.has(pointKey(point))) return true;
  for (const [otherId, segments] of segmentsByWire) {
    if (otherId === wireId) continue;
    if (segments.some((segment) => isPointOnSegment(point, segment.start, segment.end))) return true;
  }
  return false;
}

export function extractConnectivity(document: SchematicDocument): ConnectivityResult {
  const unionFind = new UnionFind();
  const issues: ConnectivityIssue[] = [];
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]));
  const terminalPositions = new Map<string, Point>();
  const terminalRefs = new Map<string, TerminalRef>();
  const terminalConnectionCount = new Map<string, number>();

  for (const node of [...document.nodes].sort((a, b) => compareText(a.id, b.id))) {
    for (const pin of getDeviceDefinition(node.kind).pins) {
      const key = terminalKey(node.id, pin.id);
      const position = getPinWorldPosition(node, pin.id);
      unionFind.add(key);
      terminalRefs.set(key, { nodeId: node.id, portId: pin.id });
      terminalConnectionCount.set(key, 0);
      if (position) terminalPositions.set(key, position);
    }
  }

  const segmentsByWire = new Map<string, WireSegment[]>();
  for (const wire of [...document.edges].sort((a, b) => compareText(a.id, b.id))) {
    const key = wireKey(wire.id);
    unionFind.add(key);
    const points = wirePathPoints(document, wire);
    const segments = wireSegments(document, wire);
    segmentsByWire.set(wire.id, segments);
    if (points.length < 2 || segments.length === 0) {
      issues.push({
        severity: "error",
        code: "ZERO_LENGTH_WIRE",
        message: `Wire “${wire.id}” 没有有效长度。`,
        objectRefs: [wire.id],
        edgeId: wire.id,
      });
      continue;
    }
    if (segments.length !== points.length - 1) {
      issues.push({
        severity: "error",
        code: "INVALID_WIRE_GEOMETRY",
        message: `Wire “${wire.id}” 包含零长度或非法线段。`,
        objectRefs: [wire.id],
        edgeId: wire.id,
      });
    }
    if (segments.some((segment) => segment.start.x !== segment.end.x && segment.start.y !== segment.end.y)) {
      issues.push({
        severity: "error",
        code: "INVALID_WIRE_GEOMETRY",
        message: `Wire “${wire.id}” 不是正交点列。`,
        objectRefs: [wire.id],
        edgeId: wire.id,
      });
    }

    for (const endpoint of [wire.source, wire.target]) {
      if (!isEdgeTerminal(endpoint)) continue;
      const terminal = terminalKey(endpoint.nodeId, endpoint.portId);
      if (!terminalRefs.has(terminal)) {
        issues.push({
          severity: "error",
          code: "CORRUPTED_OBJECT_REFERENCE",
          message: `Wire “${wire.id}” 引用了不存在的端口 ${endpoint.nodeId}.${endpoint.portId}。`,
          objectRefs: [wire.id, endpoint.nodeId],
          edgeId: wire.id,
        });
        continue;
      }
      unionFind.union(key, terminal);
      terminalConnectionCount.set(terminal, (terminalConnectionCount.get(terminal) ?? 0) + 1);
    }
  }

  // A terminal exactly on any persisted segment is electrically connected,
  // regardless of whether the X6 view used a terminal endpoint or a point.
  for (const [terminal, position] of terminalPositions) {
    for (const [wireId, segments] of segmentsByWire) {
      if (!segments.some((segment) => isPointOnSegment(position, segment.start, segment.end))) continue;
      unionFind.union(terminal, wireKey(wireId));
      terminalConnectionCount.set(terminal, (terminalConnectionCount.get(terminal) ?? 0) + 1);
    }
  }

  const explicitJunctionKeys = new Set(document.explicitJunctions.map((junction) => pointKey(junction.point)));
  const wireIds = [...segmentsByWire.keys()].sort(compareText);
  for (let firstIndex = 0; firstIndex < wireIds.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < wireIds.length; secondIndex += 1) {
      const firstId = wireIds[firstIndex];
      const secondId = wireIds[secondIndex];
      if (wiresConnect(document, firstId, secondId, segmentsByWire, explicitJunctionKeys)) {
        unionFind.union(wireKey(firstId), wireKey(secondId));
      }
    }
  }

  for (const junction of document.explicitJunctions) {
    const touching = wireIds.filter((wireId) => (segmentsByWire.get(wireId) ?? [])
      .some((segment) => isPointOnSegment(junction.point, segment.start, segment.end)));
    for (let index = 1; index < touching.length; index += 1) {
      unionFind.union(wireKey(touching[0]), wireKey(touching[index]));
    }
    if (touching.length >= 2) {
      issues.push({
        severity: "warning",
        code: "SOLDER_DOT_ON_CROSSOVER",
        message: `显式 Junction “${junction.id}” 连接了 ${touching.length} 条 Wire。`,
        objectRefs: [junction.id, ...touching],
        point: junction.point,
      });
    }
  }

  for (const wire of document.edges) {
    const points = wirePathPoints(document, wire);
    if (points.length < 2) continue;
    const endpoints = [points[0], points[points.length - 1]];
    const dangling = endpoints.filter((point) => !endpointIsConnected(
      document,
      wire.id,
      point,
      segmentsByWire,
      terminalPositions,
      explicitJunctionKeys,
    ));
    if (dangling.length) {
      issues.push({
        severity: "warning",
        code: "DANGLING_WIRE",
        message: dangling.length === 2
          ? `Wire “${wire.id}” 的两端均悬空。`
          : `Wire “${wire.id}” 存在悬空端点。`,
        objectRefs: [wire.id],
        edgeId: wire.id,
        point: dangling[0],
      });
    }
  }

  const membersByRoot = new Map<string, { wires: string[]; terminals: TerminalRef[] }>();
  for (const wireId of wireIds) {
    const root = unionFind.find(wireKey(wireId));
    const members = membersByRoot.get(root) ?? { wires: [], terminals: [] };
    members.wires.push(wireId);
    membersByRoot.set(root, members);
  }
  for (const [key, terminal] of terminalRefs) {
    const root = unionFind.find(key);
    const members = membersByRoot.get(root) ?? { wires: [], terminals: [] };
    members.terminals.push(terminal);
    membersByRoot.set(root, members);
  }

  const labelsByRoot = new Map<string, typeof document.netLabels>();
  for (const label of document.netLabels) {
    if (!segmentsByWire.has(label.wireId)) continue;
    const root = unionFind.find(wireKey(label.wireId));
    const labels = labelsByRoot.get(root) ?? [];
    labels.push(label);
    labelsByRoot.set(root, labels);
  }

  const physicalComponents = [...membersByRoot.entries()].map(([root, members]) => {
    const wires = members.wires.sort(compareText);
    const terminals = members.terminals.sort((left, right) =>
      compareText(`${left.nodeId}:${left.portId}`, `${right.nodeId}:${right.portId}`));
    const labels = (labelsByRoot.get(root) ?? []).sort((a, b) => compareText(a.id, b.id));
    const candidates: NameCandidate[] = labels.map((label) => ({
      value: label.text.trim(),
      priority: 1,
      sourceId: label.id,
    })).filter((candidate) => candidate.value.length > 0);
    for (const terminal of terminals) {
      const node = nodeById.get(terminal.nodeId);
      const candidate = node && namedNode(node);
      if (candidate) candidates.push(candidate);
    }
    candidates.sort((left, right) => left.priority - right.priority
      || compareText(left.value, right.value)
      || compareText(left.sourceId, right.sourceId));
    const distinctNames = [...new Map(candidates.map((candidate) => [nameKey(candidate.value), candidate.value])).values()];
    const signature = componentSignature(wires, terminals);
    const topologyKeys = new Set<string>();
    for (const wireId of wires) {
      const wire = document.edges.find((candidate) => candidate.id === wireId);
      if (!wire) continue;
      wirePathPoints(document, wire).forEach((point) => topologyKeys.add(pointKey(point)));
    }
    const component: PhysicalNetComponent = {
      id: `physical:${signature || root}`,
      wireIds: wires,
      terminalRefs: terminals,
      labelIds: labels.map((label) => label.id),
      topologyNodes: [...topologyKeys].sort(compareText).map((key) => {
        const [x, y] = key.split(",").map(Number);
        return { x, y };
      }),
      explicitNames: distinctNames,
    };
    if (distinctNames.length > 1) {
      issues.push({
        severity: "error",
        code: "MULTIPLE_EXPLICIT_NET_NAMES",
        message: `同一物理网络存在多个名称：${distinctNames.join("、")}。`,
        objectRefs: [...wires, ...component.labelIds, ...terminals.map((terminal) => terminal.nodeId)],
      });
    }
    return component;
  }).sort((left, right) => compareText(left.id, right.id));

  const namedGroups = new Map<string, PhysicalNetComponent[]>();
  const anonymous: PhysicalNetComponent[] = [];
  for (const component of physicalComponents) {
    const name = component.explicitNames[0];
    if (!name) {
      anonymous.push(component);
      continue;
    }
    const key = nameKey(name);
    const group = namedGroups.get(key) ?? [];
    group.push(component);
    namedGroups.set(key, group);
  }

  const logicalNets: LogicalNet[] = [];
  for (const components of [...namedGroups.values()].sort((a, b) =>
    compareText(a[0].explicitNames[0], b[0].explicitNames[0]))) {
    const aliases = [...new Set(components.flatMap((component) => component.explicitNames))].sort(compareText);
    const name = aliases[0];
    const componentIds = components.map((component) => component.id).sort(compareText);
    logicalNets.push({
      id: `logical:name:${nameKey(name)}`,
      name,
      canonicalName: name,
      aliases,
      physicalComponentIds: componentIds,
      wireIds: components.flatMap((component) => component.wireIds).sort(compareText),
      terminals: components.flatMap((component) => component.terminalRefs)
        .sort((left, right) => compareText(`${left.nodeId}:${left.portId}`, `${right.nodeId}:${right.portId}`)),
      labelIds: components.flatMap((component) => component.labelIds).sort(compareText),
      global: name.endsWith(VSE_CORE_PROFILE.naming.globalNetSuffix),
      issues: [],
    });
  }

  anonymous.sort((left, right) => compareText(left.id, right.id)).forEach((component, index) => {
    logicalNets.push({
      id: `logical:${component.id}`,
      name: `net${index + 1}`,
      aliases: [],
      physicalComponentIds: [component.id],
      wireIds: [...component.wireIds],
      terminals: [...component.terminalRefs],
      labelIds: [...component.labelIds],
      global: false,
      issues: [],
    });
  });
  logicalNets.sort((left, right) => compareText(left.name, right.name) || compareText(left.id, right.id));

  const terminalToNet = new Map<string, string>();
  const wireToNet = new Map<string, string>();
  for (const net of logicalNets) {
    net.terminals.forEach((terminal) => terminalToNet.set(terminalKey(terminal.nodeId, terminal.portId), net.name));
    net.wireIds.forEach((wireId) => wireToNet.set(wireId, net.name));
  }

  for (const noConnect of document.noConnects) {
    const key = terminalKey(noConnect.nodeId, noConnect.portId);
    if ((terminalConnectionCount.get(key) ?? 0) > 0) {
      issues.push({
        severity: "error",
        code: "NO_CONNECT_AND_WIRE",
        message: `${noConnect.nodeId}.${noConnect.portId} 同时存在 No Connect 和 Wire。`,
        objectRefs: [noConnect.id, noConnect.nodeId],
        nodeId: noConnect.nodeId,
        portId: noConnect.portId,
        point: noConnect.position,
      });
    }
  }

  return {
    physicalComponents,
    logicalNets,
    terminalToNet,
    terminalConnectionCount,
    wireToNet,
    issues: issues.sort(issueSort),
    revision: document.revisions.designRevision,
  };
}

export function terminalNetName(
  connectivity: ConnectivityResult,
  nodeId: string,
  portId: string,
): string | undefined {
  return connectivity.terminalToNet.get(terminalKey(nodeId, portId));
}
