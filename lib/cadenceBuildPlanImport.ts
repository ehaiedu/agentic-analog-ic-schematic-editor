import {
  createDeviceNode,
  createEmptyDocument,
  getDeviceDefinition,
  getPinWorldPosition,
  orthogonalWireVertices,
  snapToElectricalGrid,
  type DeviceKind,
  type EdgeTerminal,
  type NetLabel,
  type Point,
  type Rotation,
  type SchematicDocument,
  type SchematicEdge,
  type SchematicNote,
  type SchematicNode,
  type WireEndpoint,
} from "./schematic";
import { wireSegments } from "./schematicGeometry";
import { rootCellKey, withHierarchyCellView } from "./hierarchy";
import { parseSchematicDocument } from "./schematicValidation";

type CadenceOperation = Record<string, unknown>;

interface CellOps {
  name: string;
  createCellview?: CadenceOperation;
  pins: CadenceOperation[];
  instances: CadenceOperation[];
  labels: CadenceOperation[];
  routes: CadenceOperation[];
}

export interface CadenceBuildPlanImportOptions {
  project?: string;
  library?: string;
  topCell?: string;
  coordinateScale?: number;
  invertY?: boolean;
  sourceRun?: string;
  payloadSha256?: string;
  includeAllCadenceLabels?: boolean;
  preferSemanticLayouts?: boolean;
}

export interface CadenceBuildPlanImportSummary {
  library: string;
  topCell: string;
  cellCount: number;
  instanceCount: number;
  routeNetCount: number;
  routeSegmentCount: number;
  adapterWireCount: number;
}

export interface CadenceBuildPlanImportResult {
  document: SchematicDocument;
  summary: CadenceBuildPlanImportSummary;
}

const SUBCKT_PINS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"] as const;
const DEFAULT_CADENCE_COORDINATE_SCALE = 0.5;
const DEFAULT_CADENCE_PRIMITIVE_CELL_COORDINATE_SCALE = 0.4;
const CADENCE_MOS_VISUAL_WIDTH = 64;
const CADENCE_MOS_VISUAL_HEIGHT = 92;

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : null;
}

function readPoint(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const x = readNumber(value[0]);
  const y = readNumber(value[1]);
  return x === null || y === null ? null : [x, y];
}

function cleanIdentifier(value: string, fallback: string, maxLength = 80): string {
  const replaced = value.trim().replace(/[^A-Za-z0-9_.$!:-]/g, "_");
  const candidate = (/^[A-Za-z_]/.test(replaced) ? replaced : `_${replaced}`).slice(0, maxLength);
  return candidate || fallback;
}

function cleanDocumentName(value: string, fallback: string): string {
  return cleanIdentifier(value, fallback, 80).replace(/[.$!:]/g, "_");
}

function transformPoint(raw: [number, number], scale: number, invertY: boolean): Point {
  return {
    x: snapToElectricalGrid(raw[0] * scale),
    y: snapToElectricalGrid((invertY ? -raw[1] : raw[1]) * scale),
  };
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en", { numeric: true, sensitivity: "base" });
}

function sourcePrimitiveKind(op: CadenceOperation): string {
  return readString(op.effective_primitive_type)
    || readString(op.source_primitive_type)
    || readString(op.source_declared_primitive_type)
    || readString(readRecord(op.master).cell);
}

function sourceDeviceKind(primitive: string): "vsource" | "isource" | null {
  const normalized = primitive.trim().toLowerCase();
  if (/^(isource|idc|iac)$/.test(normalized)) return "isource";
  if (/^(vsource|vdc|vac)$/.test(normalized)) return "vsource";
  return null;
}

function sourceSubcktDeviceKind(masterName: string): DeviceKind | null {
  const normalized = masterName.trim().toLowerCase();
  if (normalized === "sample_hold_tgate_mos") return "sampling_switch";
  if (normalized === "cdac_split_10b_from_code") return "cdac_array";
  if (normalized === "strongarm_comparator_offset_repaired" || /strongarm|comparator|cmp/.test(normalized)) return "dynamic_comparator";
  if (normalized === "sar_logic_register_dac_ctrl") return "sar_logic";
  return null;
}

function deviceKindForInstance(op: CadenceOperation): DeviceKind {
  const sourceKind = readString(op.source_kind);
  const primitive = sourcePrimitiveKind(op).toLowerCase();
  const masterCell = readString(op.source_subckt) || readString(readRecord(op.master).cell);
  if (sourceKind === "subckt") {
    return sourceSubcktDeviceKind(masterCell) ?? chooseSubcktKind(readStringArray(op.logical_pin_order).length);
  }
  const sourceKindOverride = sourceDeviceKind(primitive);
  if (sourceKindOverride) return sourceKindOverride;
  if (/pmos|pfet|pch|p18/.test(primitive)) return "pmos4";
  if (/nmos|nfet|nch|n18/.test(primitive)) return "nmos4";
  if (/cap|capacitor/.test(primitive)) return "capacitor";
  if (/res|resistor/.test(primitive)) return "resistor";
  if (/ind|inductor/.test(primitive)) return "inductor";
  if (/diode|dio/.test(primitive)) return "diode";
  if (/pnp/.test(primitive)) return "pnp3";
  if (/npn|bjt/.test(primitive)) return "npn3";
  return chooseSubcktKind(readStringArray(op.logical_pin_order).length || Object.keys(readRecord(op.connections)).length);
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

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => readString(item)).filter(Boolean) : [];
}

function rotationForOrient(orient: string): { rotation: Rotation; mirrored: boolean } {
  const normalized = orient.trim().toUpperCase();
  if (normalized === "R90") return { rotation: 90, mirrored: false };
  if (normalized === "R180") return { rotation: 180, mirrored: false };
  if (normalized === "R270") return { rotation: 270, mirrored: false };
  if (normalized === "MX") return { rotation: 180, mirrored: true };
  if (normalized === "MY") return { rotation: 0, mirrored: true };
  if (normalized === "MXR90") return { rotation: 270, mirrored: true };
  if (normalized === "MYR90") return { rotation: 90, mirrored: true };
  return { rotation: 0, mirrored: false };
}

function primitiveProperties(op: CadenceOperation, kind: DeviceKind): Record<string, string> {
  const params = { ...readRecord(op.logical_params), ...readRecord(op.params) };
  const textParam = (keys: string[], fallback = "") => {
    for (const key of keys) {
      const exact = params[key];
      if (exact !== undefined && String(exact).trim()) return String(exact);
      const match = Object.entries(params).find(([candidate]) => candidate.toLowerCase() === key.toLowerCase());
      if (match?.[1] !== undefined && String(match[1]).trim()) return String(match[1]);
    }
    return fallback;
  };
  const master = readRecord(op.master);
  const model = readString(op.source_model) || readString(master.cell);
  if (kind === "nmos4" || kind === "pmos4") {
    return {
      model: model || (kind === "pmos4" ? "pmos" : "nmos"),
      W: textParam(["w", "W"], kind === "pmos4" ? "20u" : "10u"),
      L: textParam(["l", "L"], "180n"),
      M: textParam(["m", "M"], "1"),
      NF: textParam(["nf", "NF", "fingers"], "1"),
    };
  }
  if (kind === "capacitor") return { value: textParam(["c", "C", "value"], "1f") };
  if (kind === "resistor") return { value: textParam(["r", "R", "value"], "1k") };
  if (kind === "inductor") return { value: textParam(["l", "L", "value"], "1n") };
  if (kind === "isource") {
    return {
      dc: textParam(["dc", "idc", "i", "value"], "10u"),
      ac: textParam(["ac", "iac", "acmag"], "0"),
    };
  }
  if (kind === "vsource") {
    return {
      dc: textParam(["dc", "vdc", "v", "value"], "1.8"),
      ac: textParam(["ac", "vac", "acmag"], "0"),
    };
  }
  if (kind === "diode" || kind === "npn3" || kind === "pnp3") {
    return {
      model: model || kind,
      area: textParam(["area", "AREA"], "1"),
      M: textParam(["m", "M"], "1"),
    };
  }
  return {};
}

function instancePortOrder(op: CadenceOperation, kind: DeviceKind): string[] {
  const logical = readStringArray(op.logical_pin_order);
  if (logical.length) return logical;
  if (kind === "nmos4" || kind === "pmos4") return ["D", "G", "S", "B"];
  if (kind === "capacitor" || kind === "resistor" || kind === "inductor") return ["PLUS", "MINUS"];
  return Object.keys(readRecord(op.connections)).sort(compareText);
}

function localPinForCadencePin(pin: string, kind: DeviceKind, portOrder: readonly string[]): string | null {
  if (kind === "nmos4" || kind === "pmos4") {
    const upper = pin.toUpperCase();
    return upper === "D" || upper === "G" || upper === "S" || upper === "B" ? upper : null;
  }
  if (kind === "capacitor" || kind === "resistor" || kind === "inductor" || kind === "vsource" || kind === "isource") {
    const upper = pin.toUpperCase();
    if (upper === "PLUS" || upper === "P" || upper === "POS") return "P";
      if (upper === "MINUS" || upper === "N" || upper === "NEG") return "N";
  }
  const exact = getDeviceDefinition(kind).pins.find((candidate) => candidate.id.toUpperCase() === pin.toUpperCase());
  if (exact && !kind.startsWith("subckt")) return exact.id;
  if (kind === "sampling_switch") {
    const upper = pin.toUpperCase();
    if (upper === "VIN" || upper === "IN") return "IN";
    if (upper === "SAMPLED" || upper === "OUT") return "OUT";
  }
  if (kind === "cdac_array") {
    const upper = pin.toUpperCase();
    if (upper === "BIDIR_TOP" || upper === "TOP") return "TOP";
    if (upper === "BIDIR_BOT" || upper === "BOT") return "BOT";
  }
  const index = portOrder.findIndex((candidate) => candidate === pin);
  return index >= 0 ? SUBCKT_PINS[index] ?? null : null;
}

function preferredCadencePin(portOrder: readonly string[], candidates: readonly string[], fallback: string): string {
  const wanted = candidates.map((candidate) => candidate.toUpperCase());
  return portOrder.find((candidate) => wanted.includes(candidate.toUpperCase())) ?? fallback;
}

function sourcePinForSemanticLocalPin(kind: DeviceKind, localPin: string, portOrder: readonly string[]): string {
  if (kind.startsWith("subckt")) {
    const index = SUBCKT_PINS.findIndex((candidate) => candidate === localPin);
    return index >= 0 ? portOrder[index] ?? "" : "";
  }
  if (kind === "sampling_switch") {
    if (localPin === "IN") return preferredCadencePin(portOrder, ["VIN", "IN"], "VIN");
    if (localPin === "OUT") return preferredCadencePin(portOrder, ["SAMPLED", "OUT"], "SAMPLED");
  }
  if (kind === "cdac_array") {
    if (localPin === "TOP") return preferredCadencePin(portOrder, ["BIDIR_TOP", "TOP"], "BIDIR_TOP");
    if (localPin === "BOT") return preferredCadencePin(portOrder, ["BIDIR_BOT", "BOT"], "BIDIR_BOT");
  }
  return preferredCadencePin(portOrder, [localPin], localPin);
}

function instancePortProperties(kind: DeviceKind, portOrder: readonly string[]): Record<string, string> {
  const entries = SUBCKT_PINS.map((pin, index) => [`port_${pin}`, portOrder[index] ?? ""]);
  for (const pin of getDeviceDefinition(kind).pins) {
    entries.push([`port_${pin.id}`, sourcePinForSemanticLocalPin(kind, pin.id, portOrder)]);
  }
  return Object.fromEntries(entries);
}

function terminalNetMap(op: CadenceOperation, kind: DeviceKind): Array<{ portId: string; cadencePin: string; net: string }> {
  const connections = readRecord(op.connections);
  const portOrder = instancePortOrder(op, kind);
  return portOrder.flatMap((cadencePin) => {
    const net = readString(connections[cadencePin]);
    const portId = localPinForCadencePin(cadencePin, kind, portOrder);
    return net && portId ? [{ portId, cadencePin, net }] : [];
  });
}

function portKindForPin(op: CadenceOperation): DeviceKind {
  const direction = readString(op.direction).toLowerCase();
  if (direction === "output") return "output";
  if (direction === "inputoutput" || direction === "inout" || direction === "bidir") return "bidir";
  return "input";
}

function isCadencePrimitiveOnlyCell(cell: CellOps): boolean {
  return cell.instances.length > 0
    && cell.instances.every((op) => readString(op.source_kind) !== "subckt")
    && cell.instances.some((op) => {
      const kind = deviceKindForInstance(op);
      return kind === "nmos4" || kind === "pmos4";
    });
}

function effectiveCoordinateScaleForCell(cell: CellOps, scale: number, explicit: boolean): number {
  if (explicit) return scale;
  return isCadencePrimitiveOnlyCell(cell)
    ? Math.min(scale, DEFAULT_CADENCE_PRIMITIVE_CELL_COORDINATE_SCALE)
    : scale;
}

function withCadencePrimitiveVisualSize(node: SchematicNode): SchematicNode {
  if (node.kind !== "nmos4" && node.kind !== "pmos4") return node;
  return {
    ...node,
    width: CADENCE_MOS_VISUAL_WIDTH,
    height: CADENCE_MOS_VISUAL_HEIGHT,
    properties: {
      ...node.properties,
      cadenceVisualScale: "mos_readable",
    },
  };
}

function portNodeAt(
  pin: string,
  kind: DeviceKind,
  point: Point,
  existingNodes: readonly SchematicNode[],
  mirrored = false,
): SchematicNode {
  const seed = { ...createDeviceNode(kind, point.x, point.y, existingNodes), mirrored };
  const portPoint = getPinWorldPosition(seed, "P");
  const dx = portPoint ? point.x - portPoint.x : 0;
  const dy = portPoint ? point.y - portPoint.y : 0;
  return {
    ...seed,
    id: cleanIdentifier(`pin_${pin}`, `pin_${existingNodes.length + 1}`, 96),
    x: snapToElectricalGrid(seed.x + dx),
    y: snapToElectricalGrid(seed.y + dy),
    instanceName: cleanIdentifier(pin, seed.instanceName, 96),
    properties: {
      ...seed.properties,
      netName: pin,
      cadencePinName: pin,
      cadenceDirection: kind,
    },
  };
}

function instanceNode(
  op: CadenceOperation,
  scale: number,
  invertY: boolean,
  existingNodes: readonly SchematicNode[],
  applyCadenceVisualSize = true,
): SchematicNode | null {
  const rawPoint = readPoint(op.xy);
  if (!rawPoint) return null;
  const kind = deviceKindForInstance(op);
  const point = transformPoint(rawPoint, scale, invertY);
  const baseSeed = createDeviceNode(kind, point.x, point.y, existingNodes);
  const seed = applyCadenceVisualSize ? withCadencePrimitiveVisualSize(baseSeed) : baseSeed;
  const orient = rotationForOrient(readString(op.orient, "R0"));
  const master = readRecord(op.master);
  const sourceSubckt = readString(op.source_subckt) || readString(master.cell) || readString(op.instance, "subckt");
  const portOrder = instancePortOrder(op, kind);
  const isSubckt = readString(op.source_kind) === "subckt" || kind.startsWith("subckt");
  const portProperties = instancePortProperties(kind, portOrder);
  const baseProperties = isSubckt
    ? {
      ...seed.properties,
      master: sourceSubckt,
      portOrder: portOrder.join(","),
      ...portProperties,
    }
    : {
      ...seed.properties,
      ...primitiveProperties(op, kind),
    };
  const width = seed.width;
  const height = seed.height;
  const centered = isSubckt || kind === "capacitor" || kind === "resistor" || kind === "inductor" || kind === "vsource" || kind === "isource";
  return {
    ...seed,
    id: cleanIdentifier(`inst_${readString(op.instance, seed.instanceName)}`, seed.id, 96),
    x: snapToElectricalGrid(centered ? point.x - width / 2 : point.x),
    y: snapToElectricalGrid(centered ? point.y - height / 2 : point.y),
    rotation: orient.rotation,
    mirrored: orient.mirrored,
    instanceName: cleanIdentifier(readString(op.instance, seed.instanceName), seed.instanceName, 96),
    properties: {
      ...baseProperties,
      cadenceCell: readString(op.cell),
      cadenceMasterLib: readString(master.lib),
      cadenceMasterCell: readString(master.cell),
      cadenceMasterView: readString(master.view),
      cadenceSourceKind: readString(op.source_kind),
      cadenceRole: readString(op.role),
    },
  };
}

function routeSegments(op: CadenceOperation, scale: number, invertY: boolean): Array<{ source: Point; target: Point }> {
  if (!Array.isArray(op.segments)) return [];
  return op.segments.flatMap((segment) => {
    if (!Array.isArray(segment) || segment.length < 2) return [];
    const start = readPoint(segment[0]);
    const end = readPoint(segment[1]);
    if (!start || !end) return [];
    const source = transformPoint(start, scale, invertY);
    const target = transformPoint(end, scale, invertY);
    if (source.x === target.x && source.y === target.y) return [];
    return [{ source, target }];
  });
}

function distanceSquared(left: Point, right: Point): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
}

function closestPointOnSegment(point: Point, source: Point, target: Point): Point {
  if (source.x === target.x) {
    const minY = Math.min(source.y, target.y);
    const maxY = Math.max(source.y, target.y);
    return { x: source.x, y: Math.max(minY, Math.min(maxY, point.y)) };
  }
  if (source.y === target.y) {
    const minX = Math.min(source.x, target.x);
    const maxX = Math.max(source.x, target.x);
    return { x: Math.max(minX, Math.min(maxX, point.x)), y: source.y };
  }
  return source;
}

function nearestRouteProjection(point: Point, routeEdges: readonly SchematicEdge[]): { edge: SchematicEdge; point: Point; distance: number } | null {
  let best: { edge: SchematicEdge; point: Point; distance: number } | null = null;
  for (const edge of routeEdges) {
    if ("nodeId" in edge.source || "nodeId" in edge.target) continue;
    const candidate = closestPointOnSegment(point, edge.source, edge.target);
    const distance = distanceSquared(point, candidate);
    if (!best || distance < best.distance) best = { edge, point: candidate, distance };
  }
  return best;
}

function nearestRoutePoint(point: Point, routeEdges: readonly SchematicEdge[]): Point | null {
  return nearestRouteProjection(point, routeEdges)?.point ?? null;
}

function terminalEscapePoint(nodes: readonly SchematicNode[], terminal: EdgeTerminal, sequence: number): Point | null {
  const node = nodes.find((candidate) => candidate.id === terminal.nodeId);
  const point = node ? getPinWorldPosition(node, terminal.portId) : null;
  if (!node || !point) return null;
  const pin = getDeviceDefinition(node.kind).pins.find((candidate) => candidate.id === terminal.portId);
  const distance = 35 + (sequence % 3) * 10;
  const pinPositions = getDeviceDefinition(node.kind).pins
    .map((candidate) => getPinWorldPosition(node, candidate.id))
    .filter((candidate): candidate is Point => Boolean(candidate));
  if (pinPositions.length > 1) {
    const centre = {
      x: pinPositions.reduce((sum, candidate) => sum + candidate.x, 0) / pinPositions.length,
      y: pinPositions.reduce((sum, candidate) => sum + candidate.y, 0) / pinPositions.length,
    };
    const dx = point.x - centre.x;
    const dy = point.y - centre.y;
    if (Math.abs(dx) >= Math.abs(dy) && Math.abs(dx) > 0.5) {
      return { x: snapToElectricalGrid(point.x + Math.sign(dx) * distance), y: point.y };
    }
    if (Math.abs(dy) > 0.5) {
      return { x: point.x, y: snapToElectricalGrid(point.y + Math.sign(dy) * distance) };
    }
  }
  if (pin?.side === "left") return { x: snapToElectricalGrid(point.x - distance), y: point.y };
  if (pin?.side === "right") return { x: snapToElectricalGrid(point.x + distance), y: point.y };
  if (pin?.side === "top") return { x: point.x, y: snapToElectricalGrid(point.y - distance) };
  if (pin?.side === "bottom") return { x: point.x, y: snapToElectricalGrid(point.y + distance) };
  return { x: snapToElectricalGrid(point.x + distance), y: point.y };
}

function midpoint(source: Point, target: Point): Point {
  return {
    x: snapToElectricalGrid((source.x + target.x) / 2),
    y: snapToElectricalGrid((source.y + target.y) / 2),
  };
}

function labelledTerminalStub(
  nodes: readonly SchematicNode[],
  cellName: string,
  net: string,
  terminal: EdgeTerminal,
  sequence: number,
  creationOrder: number,
  edgePrefix: string,
  style: SchematicEdge["style"] = "REFERENCE",
): { edge: SchematicEdge; label: NetLabel | null } | null {
  const routePoint = terminalEscapePoint(nodes, terminal, sequence);
  if (!routePoint) return null;
  const edge: SchematicEdge = {
    ...semanticWire(
      nodes,
      cleanIdentifier(`${edgePrefix}_${cellName}_${net}_${sequence + 1}`, `${edgePrefix}_${sequence + 1}`, 120),
      terminal,
      routePoint,
      creationOrder,
    ),
    style,
  };
  const label = semanticWireLabel(
    nodes,
    net,
    edge,
    cleanIdentifier(`label_${cellName}_${net}_${sequence + 1}`, `label_${sequence + 1}`, 120),
    routePoint,
    "start",
  );
  return { edge, label };
}

function labelledRouteTerminalAdapter(
  nodes: readonly SchematicNode[],
  cellName: string,
  net: string,
  terminal: EdgeTerminal,
  routeEdges: readonly SchematicEdge[],
  sequence: number,
  creationOrder: number,
  edgePrefix: string,
  style: SchematicEdge["style"] = "REFERENCE",
): { edge: SchematicEdge; label: NetLabel | null } | null {
  const node = nodes.find((candidate) => candidate.id === terminal.nodeId);
  const pinPoint = node ? getPinWorldPosition(node, terminal.portId) : null;
  if (!pinPoint) return null;

  const projection = nearestRouteProjection(pinPoint, routeEdges);
  if (!projection) {
    return labelledTerminalStub(nodes, cellName, net, terminal, sequence, creationOrder, edgePrefix, style);
  }

  const edge: SchematicEdge = {
    ...semanticWire(
      nodes,
      cleanIdentifier(`${edgePrefix}_${cellName}_${net}_${sequence + 1}`, `${edgePrefix}_${sequence + 1}`, 120),
      terminal,
      projection.point,
      creationOrder,
    ),
    style,
  };
  const labelId = cleanIdentifier(`label_${cellName}_${net}_${sequence + 1}`, `label_${sequence + 1}`, 120);
  const label = semanticWireLabel(nodes, net, edge, labelId, projection.point, "start")
    ?? labelOnEdge(labelId, net, projection.edge, projection.point);
  return { edge, label };
}

function sourcePinForLocalPort(node: SchematicNode, portId: string): string {
  if (portId === "P" && (node.kind === "input" || node.kind === "output" || node.kind === "bidir")) {
    return node.properties.cadencePinName || node.properties.netName || node.instanceName;
  }
  return node.properties[`port_${portId}`] || portId;
}

function terminalNetMapForNode(op: CadenceOperation, node: SchematicNode): Array<{ portId: string; cadencePin: string; net: string }> {
  const connections = readRecord(op.connections);
  const mapped = getDeviceDefinition(node.kind).pins.flatMap((pin) => {
    const cadencePin = sourcePinForLocalPort(node, pin.id);
    const net = readString(connections[cadencePin]);
    return net ? [{ portId: pin.id, cadencePin, net }] : [];
  });
  return mapped.length ? mapped : terminalNetMap(op, node.kind);
}

function orderedWithoutDuplicates(values: readonly string[], allowed: ReadonlySet<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const clean = value.trim();
    if (!clean || !allowed.has(clean) || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

function sarVisualPinOrder(op: CadenceOperation): string[] | null {
  const original = instancePortOrder(op, deviceKindForInstance(op));
  if (!original.length) return null;
  const allowed = new Set(original);
  const master = (readString(op.source_subckt) || readString(readRecord(op.master).cell)).toLowerCase();
  const name = instanceName(op).toUpperCase();
  const bitCell = /^cdac_bit\d+_mos_switch_cell$/i.test(master);
  const desired = bitCell
    ? ["BP", "BPB", "BN", "BNB", "BIDIR_TOP", "BIDIR_BOT", "VREFP", "VREFN", "VCM", "VDD", "VSS"]
    : master === "sample_hold_tgate_mos"
      ? ["VIN", "CLK", "CLKB", "SAMPLED", "VDD", "VSS"]
      : master === "cdac_split_10b_from_code"
        ? ["BIDIR_TOP", "CTRL", "BIDIR_BOT", "VSS", "VREFP", "VREFN", "VCM", "VDD"]
        : master === "strongarm_comparator_offset_repaired"
          ? ["INP", "INN", "CLK", "VSS", "OUTP", "OUTN", "VDD"]
          : master === "sar_logic_register_dac_ctrl"
            ? ["CLK", "RST", "CMP", "VSS", "CTRL", "DOUT", "VDD"]
            : master === "sar_inv_only" || name === "XCLKINV"
              ? ["IN", "VDD", "OUT", "VSS"]
              : master === "sar_bit_ctrl_buffer"
                ? ["IN", "VDD", "VSS", "OUT", "OUTB"]
                : [];
  const ordered = orderedWithoutDuplicates([...desired, ...original], allowed);
  return ordered.length && ordered.some((pin, index) => pin !== original[index]) ? ordered : null;
}

function cadenceStyleStub(
  nodes: readonly SchematicNode[],
  cellName: string,
  net: string,
  terminal: EdgeTerminal,
  sequence: number,
  creationOrder: number,
  edgePrefix: string,
): { edge: SchematicEdge; label: NetLabel | null } | null {
  return labelledTerminalStub(nodes, cellName, net, terminal, sequence, creationOrder, edgePrefix, "REFERENCE");
}

function terminalDescriptor(nodes: readonly SchematicNode[], terminal: EdgeTerminal): string {
  const node = nodes.find((candidate) => candidate.id === terminal.nodeId);
  const sourcePin = node ? sourcePinForLocalPort(node, terminal.portId) : terminal.portId;
  return `${node?.instanceName ?? terminal.nodeId}:${sourcePin}`;
}

function findTerminal(
  nodes: readonly SchematicNode[],
  terminals: readonly EdgeTerminal[],
  instance: string,
  sourcePin: string,
): EdgeTerminal | null {
  const wantedInstance = instance.toUpperCase();
  const wantedPin = sourcePin.toUpperCase();
  return terminals.find((terminal) => {
    const node = nodes.find((candidate) => candidate.id === terminal.nodeId);
    return node?.instanceName.toUpperCase() === wantedInstance
      && sourcePinForLocalPort(node, terminal.portId).toUpperCase() === wantedPin;
  }) ?? null;
}

function directSarTopPairs(
  nodes: readonly SchematicNode[],
  net: string,
  terminals: readonly EdgeTerminal[],
): Array<[EdgeTerminal, EdgeTerminal]> {
  const pair = (fromInstance: string, fromPin: string, toInstance: string, toPin: string): [EdgeTerminal, EdgeTerminal] | null => {
    const from = findTerminal(nodes, terminals, fromInstance, fromPin);
    const to = findTerminal(nodes, terminals, toInstance, toPin);
    return from && to ? [from, to] : null;
  };
  const specs: Record<string, Array<[string, string, string, string]>> = {
    VIN: [["VIN", "VIN", "XSH0", "VIN"]],
    SAMPLED: [["XSH0", "SAMPLED", "XCDAC0", "BIDIR_TOP"], ["XCDAC0", "BIDIR_TOP", "XCMP0", "INP"]],
    VREFP: [["VREFP", "VREFP", "XCDAC0", "VREFP"]],
    VREFN: [["VREFN", "VREFN", "XCDAC0", "VREFN"]],
    VCM: [["VCM", "VCM", "XCDAC0", "VCM"], ["XCDAC0", "BIDIR_BOT", "XCMP0", "INN"]],
    CLKB: [["XCLKINV", "OUT", "XSH0", "CLKB"]],
    DAC_CTRL: [["XSAR0", "CTRL", "XCDAC0", "CTRL"]],
    OUTP: [["XCMP0", "OUTP", "XSAR0", "CMP"], ["XCMP0", "OUTP", "OUTP", "OUTP"]],
    OUTN: [["XCMP0", "OUTN", "OUTN", "OUTN"]],
    DOUT: [["XSAR0", "DOUT", "DOUT", "DOUT"]],
  };
  return (specs[net.toUpperCase()] ?? []).flatMap(([fromInstance, fromPin, toInstance, toPin]) => {
    const direct = pair(fromInstance, fromPin, toInstance, toPin);
    return direct ? [direct] : [];
  });
}

function sarTopNetPrefersLabelledStubs(net: string): boolean {
  return /^(CLK|RST|VDD|VSS|0|GND)$/i.test(net);
}

function semanticDoglegWire(
  nodes: readonly SchematicNode[],
  id: string,
  source: EdgeTerminal,
  target: EdgeTerminal,
  creationOrder: number,
  sequence: number,
): SchematicEdge {
  const sourcePoint = terminalPoint(nodes, source);
  const targetPoint = terminalPoint(nodes, target);
  const sourceEscape = terminalEscapePoint(nodes, source, sequence) ?? sourcePoint;
  const targetEscape = terminalEscapePoint(nodes, target, sequence + 1) ?? targetPoint;
  const vertices = sourceEscape && targetEscape
    ? externalDoglegVertices(nodes, source, target, sourceEscape, targetEscape, sequence)
    : [];
  return semanticWire(nodes, id, source, target, creationOrder, vertices);
}

function pointOnOrthogonalSegment(point: Point, start: Point, end: Point): boolean {
  if (start.x === end.x) {
    return point.x === start.x && point.y >= Math.min(start.y, end.y) && point.y <= Math.max(start.y, end.y);
  }
  if (start.y === end.y) {
    return point.y === start.y && point.x >= Math.min(start.x, end.x) && point.x <= Math.max(start.x, end.x);
  }
  return false;
}

function routeTouchesForeignTerminal(
  nodes: readonly SchematicNode[],
  source: EdgeTerminal,
  target: EdgeTerminal,
  points: readonly Point[],
): boolean {
  const excluded = new Set([endpointKey(source), endpointKey(target)]);
  const terminalPositions = nodes.flatMap((node) =>
    getDeviceDefinition(node.kind).pins.flatMap((pin) => {
      const point = getPinWorldPosition(node, pin.id);
      return point ? [{ key: `${node.id}:${pin.id}`, point }] : [];
    }));
  for (const terminal of terminalPositions) {
    if (excluded.has(terminal.key)) continue;
    for (let index = 1; index < points.length; index += 1) {
      if (pointOnOrthogonalSegment(terminal.point, points[index - 1], points[index])) return true;
    }
  }
  return false;
}

function cleanRoutePoints(points: readonly Point[]): Point[] {
  return points.filter((point, index) =>
    index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
}

function externalDoglegVertices(
  nodes: readonly SchematicNode[],
  source: EdgeTerminal,
  target: EdgeTerminal,
  sourceEscape: Point,
  targetEscape: Point,
  sequence: number,
): Point[] {
  const horizontal = Math.abs(targetEscape.x - sourceEscape.x) >= Math.abs(targetEscape.y - sourceEscape.y);
  const minX = Math.min(sourceEscape.x, targetEscape.x);
  const maxX = Math.max(sourceEscape.x, targetEscape.x);
  const minY = Math.min(sourceEscape.y, targetEscape.y);
  const maxY = Math.max(sourceEscape.y, targetEscape.y);
  const lane = sequence % 5;
  if (horizontal) {
    const yCandidates = [
      minY - 45 - lane * 15,
      maxY + 45 + lane * 15,
      sourceEscape.y - 55 - lane * 10,
      targetEscape.y + 55 + lane * 10,
      (sourceEscape.y + targetEscape.y) / 2 - 70,
      (sourceEscape.y + targetEscape.y) / 2 + 70,
    ].map(snapToElectricalGrid);
    for (const y of yCandidates) {
      const points = cleanRoutePoints([
        sourceEscape,
        { x: sourceEscape.x, y },
        { x: targetEscape.x, y },
        targetEscape,
      ]);
      if (!routeTouchesForeignTerminal(nodes, source, target, points)) return points;
    }
    return cleanRoutePoints([
      sourceEscape,
      { x: sourceEscape.x, y: snapToElectricalGrid(maxY + 120 + lane * 20) },
      { x: targetEscape.x, y: snapToElectricalGrid(maxY + 120 + lane * 20) },
      targetEscape,
    ]);
  }

  const xCandidates = [
    minX - 45 - lane * 15,
    maxX + 45 + lane * 15,
    sourceEscape.x - 55 - lane * 10,
    targetEscape.x + 55 + lane * 10,
    (sourceEscape.x + targetEscape.x) / 2 - 70,
    (sourceEscape.x + targetEscape.x) / 2 + 70,
  ].map(snapToElectricalGrid);
  for (const x of xCandidates) {
    const points = cleanRoutePoints([
      sourceEscape,
      { x, y: sourceEscape.y },
      { x, y: targetEscape.y },
      targetEscape,
    ]);
    if (!routeTouchesForeignTerminal(nodes, source, target, points)) return points;
  }
  return cleanRoutePoints([
    sourceEscape,
    { x: snapToElectricalGrid(maxX + 120 + lane * 20), y: sourceEscape.y },
    { x: snapToElectricalGrid(maxX + 120 + lane * 20), y: targetEscape.y },
    targetEscape,
  ]);
}

function cadenceStyleNetWires(
  nodes: readonly SchematicNode[],
  cellName: string,
  net: string,
  terminals: readonly EdgeTerminal[],
  netIndex: number,
  creationOrder: number,
  edgePrefix: string,
): { edges: SchematicEdge[]; labels: NetLabel[] } {
  const edges: SchematicEdge[] = [];
  const labels: NetLabel[] = [];
  const used = new Set<string>();
  const directPairs = cellName === "sar_adc_10b_split_cdac_top"
    ? directSarTopPairs(nodes, net, terminals)
    : [];

  for (const [left, right] of directPairs) {
    const id = cleanIdentifier(`${edgePrefix}_${cellName}_${net}_${terminalDescriptor(nodes, left)}_${terminalDescriptor(nodes, right)}`, `${edgePrefix}_${netIndex + 1}_${edges.length + 1}`, 120);
    edges.push(semanticDoglegWire(nodes, id, left, right, creationOrder + edges.length, netIndex * 100 + edges.length));
    used.add(endpointKey(left));
    used.add(endpointKey(right));
  }
  if (directPairs.length && edges.length) {
    const label = semanticWireLabel(
      nodes,
      net,
      edges[0],
      cleanIdentifier(`label_${cellName}_${net}_direct`, `label_${netIndex + 1}`, 120),
    );
    if (label) labels.push(label);
  }

  const remaining = terminals.filter((terminal) => !used.has(endpointKey(terminal)));
  if (cellName === "sar_adc_10b_split_cdac_top" && sarTopNetPrefersLabelledStubs(net)) {
    remaining.forEach((terminal, index) => {
      const stub = cadenceStyleStub(
        nodes,
        cellName,
        net,
        terminal,
        netIndex * 100 + index,
        creationOrder + edges.length,
        edgePrefix,
      );
      if (!stub) return;
      edges.push(stub.edge);
      if (stub.label) labels.push(stub.label);
    });
    return { edges, labels };
  }
  if (!directPairs.length && terminals.length >= 2) {
    return visibleConnectedNetWires(nodes, cellName, net, terminals, netIndex, creationOrder, edgePrefix);
  }
  if (remaining.length >= 2) {
    const connected = visibleConnectedNetWires(
      nodes,
      cellName,
      net,
      remaining,
      netIndex,
      creationOrder + edges.length,
      edgePrefix,
    );
    edges.push(...connected.edges);
    labels.push(...connected.labels);
    return { edges, labels };
  }

  remaining.forEach((terminal, index) => {
    if (used.has(endpointKey(terminal))) return;
    const stub = cadenceStyleStub(
      nodes,
      cellName,
      net,
      terminal,
      netIndex * 100 + index,
      creationOrder + edges.length,
      edgePrefix,
    );
    if (!stub) return;
    edges.push(stub.edge);
    if (stub.label) labels.push(stub.label);
  });

  if (!edges.length && terminals.length === 1) {
    const stub = cadenceStyleStub(nodes, cellName, net, terminals[0], netIndex, creationOrder, edgePrefix);
    if (stub) {
      edges.push(stub.edge);
      if (stub.label) labels.push(stub.label);
    }
  }
  return { edges, labels };
}

function netIsLowerRail(net: string): boolean {
  return /^(0|GND|VSS|AVSS|DVSS)$/i.test(net);
}

function netIsUpperOrReferenceRail(net: string): boolean {
  return /^(VDD|AVDD|DVDD|VCC|VREF|VREFP|VREFN|VCM)$/i.test(net);
}

function visibleConnectedNetWires(
  nodes: readonly SchematicNode[],
  cellName: string,
  net: string,
  terminals: readonly EdgeTerminal[],
  netIndex: number,
  creationOrder: number,
  edgePrefix: string,
): { edges: SchematicEdge[]; labels: NetLabel[] } {
  const points = terminals.flatMap((terminal) => {
    const point = terminalPoint(nodes, terminal);
    return point ? [{ terminal, point }] : [];
  });
  if (points.length < 2) {
    const stub = points[0]
      ? labelledTerminalStub(nodes, cellName, net, points[0].terminal, netIndex, creationOrder, edgePrefix)
      : null;
    return {
      edges: stub ? [stub.edge] : [],
      labels: stub?.label ? [stub.label] : [],
    };
  }

  const prefix = cleanIdentifier(`${edgePrefix}_${cellName}_${net}`, `${edgePrefix}_${netIndex + 1}`, 112);
  const minX = Math.min(...points.map((item) => item.point.x));
  const maxX = Math.max(...points.map((item) => item.point.x));
  const minY = Math.min(...points.map((item) => item.point.y));
  const maxY = Math.max(...points.map((item) => item.point.y));
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const horizontal = netIsUpperOrReferenceRail(net) || netIsLowerRail(net) || spanX >= spanY;
  const lane = netIndex % 7;
  const busOffset = 38 + lane * 14;
  const edges: SchematicEdge[] = [];

  if (points.length === 2) {
    edges.push({
      ...semanticWire(nodes, `${prefix}_wire`, points[0].terminal, points[1].terminal, creationOrder),
      style: "REFERENCE",
    });
  } else if (horizontal) {
    const busY = snapToElectricalGrid(
      netIsLowerRail(net)
        ? maxY + busOffset
        : netIsUpperOrReferenceRail(net)
          ? minY - busOffset
          : (minY + maxY) / 2 + (lane - 3) * 12,
    );
    const trunkSource = { x: snapToElectricalGrid(minX - 28), y: busY };
    const trunkTarget = { x: snapToElectricalGrid(maxX + 28), y: busY };
    edges.push({
      id: `${prefix}_trunk`,
      source: trunkSource,
      target: trunkTarget,
      style: "REFERENCE",
      width: 1,
      creationOrder,
    });
    points.forEach(({ terminal, point }, index) => {
      const tap = { x: point.x, y: busY };
      if (tap.x === point.x && tap.y === point.y) return;
      edges.push({
        ...semanticWire(nodes, `${prefix}_tap_${index + 1}`, terminal, tap, creationOrder + edges.length),
        style: "REFERENCE",
      });
    });
  } else {
    const busX = snapToElectricalGrid((minX + maxX) / 2 + (lane - 3) * 16);
    const trunkSource = { x: busX, y: snapToElectricalGrid(minY - 28) };
    const trunkTarget = { x: busX, y: snapToElectricalGrid(maxY + 28) };
    edges.push({
      id: `${prefix}_trunk`,
      source: trunkSource,
      target: trunkTarget,
      style: "REFERENCE",
      width: 1,
      creationOrder,
    });
    points.forEach(({ terminal, point }, index) => {
      const tap = { x: busX, y: point.y };
      if (tap.x === point.x && tap.y === point.y) return;
      edges.push({
        ...semanticWire(nodes, `${prefix}_tap_${index + 1}`, terminal, tap, creationOrder + edges.length),
        style: "REFERENCE",
      });
    });
  }

  const labels: NetLabel[] = [];
  const labelledEdge = edges[0];
  const label = labelledEdge
    ? semanticWireLabel(
      nodes,
      net,
      labelledEdge,
      cleanIdentifier(`label_${cellName}_${net}`, `label_${netIndex + 1}`, 120),
    )
    : null;
  if (label) labels.push(label);
  return { edges, labels };
}

function labelOnEdge(id: string, text: string, edge: SchematicEdge, anchorPoint?: Point): NetLabel | null {
  if ("nodeId" in edge.source || "nodeId" in edge.target) return null;
  const anchor = anchorPoint ?? midpoint(edge.source, edge.target);
  const snapped = closestPointOnSegment(anchor, edge.source, edge.target);
  return {
    id,
    text,
    wireId: edge.id,
    segmentIndex: 0,
    anchorPoint: snapped,
    orientation: 0,
    textAlignment: "middle",
  };
}

function groupOperations(buildPlan: unknown): Map<string, CellOps> {
  const root = readRecord(buildPlan);
  const operations = Array.isArray(root.operations) ? root.operations.map(readRecord) : [];
  const cells = new Map<string, CellOps>();
  const ensure = (cell: string): CellOps => {
    const name = cleanDocumentName(cell, "cell");
    const existing = cells.get(name);
    if (existing) return existing;
    const created = { name, pins: [], instances: [], labels: [], routes: [] };
    cells.set(name, created);
    return created;
  };
  for (const op of operations) {
    const kind = readString(op.op);
    const cell = readString(op.cell);
    if (kind === "create_cellview" && cell) {
      ensure(cell).createCellview = op;
    } else if (kind === "create_pin" && cell) {
      ensure(cell).pins.push(op);
    } else if (kind === "place_instance" && cell) {
      ensure(cell).instances.push(op);
    } else if (kind === "place_net_label" && cell) {
      ensure(cell).labels.push(op);
    } else if (kind === "route_net" && cell) {
      ensure(cell).routes.push(op);
    }
  }
  return cells;
}

function instanceName(op: CadenceOperation): string {
  return readString(op.instance);
}

function instanceRole(op: CadenceOperation): string {
  return readString(op.role).toLowerCase();
}

function connectionNet(op: CadenceOperation, pin: string): string {
  return readString(readRecord(op.connections)[pin]);
}

function opByRoleOrName(cell: CellOps, rolePattern: RegExp, namePattern: RegExp): CadenceOperation | undefined {
  return cell.instances.find((op) => rolePattern.test(instanceRole(op)))
    ?? cell.instances.find((op) => namePattern.test(instanceName(op)));
}

function opByRoleNameAndKind(cell: CellOps, rolePattern: RegExp, namePattern: RegExp, kind: DeviceKind): CadenceOperation | undefined {
  return cell.instances.find((op) => deviceKindForInstance(op) === kind && rolePattern.test(instanceRole(op)))
    ?? cell.instances.find((op) => deviceKindForInstance(op) === kind && namePattern.test(instanceName(op)));
}

function semanticInstanceNode(
  op: CadenceOperation,
  point: Point,
  existingNodes: readonly SchematicNode[],
): SchematicNode {
  const rawPoint: [number, number] = [point.x, -point.y];
  const node = instanceNode({ ...op, xy: rawPoint, orient: "R0" }, 1, true, existingNodes, false);
  if (!node) throw new Error(`Unable to create semantic node for ${instanceName(op) || "instance"}.`);
  return node;
}

function endpointKey(endpoint: WireEndpoint): string {
  return "nodeId" in endpoint ? `${endpoint.nodeId}:${endpoint.portId}` : `${endpoint.x},${endpoint.y}`;
}

function semanticWire(
  nodes: readonly SchematicNode[],
  id: string,
  source: WireEndpoint,
  target: WireEndpoint,
  creationOrder: number,
  vertices?: Point[],
): SchematicEdge {
  const sourcePoint = "nodeId" in source ? getPinWorldPosition(nodes.find((node) => node.id === source.nodeId)!, source.portId) : source;
  const targetPoint = "nodeId" in target ? getPinWorldPosition(nodes.find((node) => node.id === target.nodeId)!, target.portId) : target;
  const routed = vertices ?? (sourcePoint && targetPoint ? orthogonalWireVertices(sourcePoint, targetPoint) : []);
  return {
    id,
    source,
    target,
    ...(routed.length ? { vertices: routed } : {}),
    style: "NORMAL",
    width: 1,
    creationOrder,
  };
}

function semanticWireLabel(
  nodes: readonly SchematicNode[],
  text: string,
  edge: SchematicEdge,
  id: string,
  anchorPoint?: Point,
  textAlignment: NetLabel["textAlignment"] = "middle",
): NetLabel | null {
  const segments = wireSegments({ nodes: [...nodes] }, edge);
  const segment = anchorPoint
    ? segments.find((candidate) => {
      const snapped = closestPointOnSegment(anchorPoint, candidate.start, candidate.end);
      return snapped.x === anchorPoint.x && snapped.y === anchorPoint.y;
    }) ?? segments[Math.min(1, segments.length - 1)]
    : segments[Math.min(1, segments.length - 1)];
  if (!segment) return null;
  const anchor = anchorPoint
    ? closestPointOnSegment(anchorPoint, segment.start, segment.end)
    : midpoint(segment.start, segment.end);
  return {
    id,
    text,
    wireId: edge.id,
    segmentIndex: segment.segmentIndex,
    anchorPoint: anchor,
    orientation: 0,
    textAlignment,
  };
}

function orderedComparatorPins(cell: CellOps): string[] {
  const ordered = [...cell.pins]
    .sort((left, right) => (readNumber(left.order) ?? 0) - (readNumber(right.order) ?? 0))
    .map((op) => readString(op.pin))
    .filter(Boolean);
  return ordered.length ? ordered : ["vdd", "vinm", "vinp", "vout", "vss"];
}

function tryBuildBasicComparatorDocument(
  cell: CellOps,
  options: Required<Pick<CadenceBuildPlanImportOptions, "coordinateScale" | "invertY" | "includeAllCadenceLabels">>
    & Pick<CadenceBuildPlanImportOptions, "project" | "sourceRun" | "payloadSha256">,
  library: string,
): { document: SchematicDocument; routeSegmentCount: number; adapterWireCount: number } | null {
  const normalizedCell = cell.name.toLowerCase();
  if (!/comparator|cmp/.test(normalizedCell)) return null;

  const m1 = opByRoleOrName(cell, /diff_pair_left/, /^M1$/i);
  const m2 = opByRoleOrName(cell, /diff_pair_right/, /^M2$/i);
  const m3 = opByRoleOrName(cell, /current_mirror_reference/, /^M3$/i);
  const m4 = opByRoleOrName(cell, /current_mirror_output/, /^M4$/i);
  const m5 = opByRoleNameAndKind(cell, /output_stage/, /^M5$/i, "pmos4");
  const m6 = opByRoleNameAndKind(cell, /output_stage/, /^M6$/i, "nmos4");
  const tail = opByRoleOrName(cell, /tail_source/, /^I/i);
  if (!m1 || !m2 || !m3 || !m4 || !m5 || !m6 || !tail) return null;
  if (![m1, m2, m6].every((op) => deviceKindForInstance(op) === "nmos4")) return null;
  if (![m3, m4, m5].every((op) => deviceKindForInstance(op) === "pmos4")) return null;
  if (deviceKindForInstance(tail) !== "isource") return null;

  const project = cleanDocumentName(options.project ?? library, library);
  const base = createEmptyDocument(project, cell.name);
  const nodes: SchematicNode[] = [];
  const edges: SchematicEdge[] = [];
  const netLabels: NetLabel[] = [];
  const nodeByInstance = new Map<CadenceOperation, SchematicNode>();

  const addNode = (node: SchematicNode) => {
    nodes.push(node);
    return node;
  };
  const addPin = (pin: string, kind: DeviceKind, point: Point) =>
    addNode(portNodeAt(pin, kind, point, nodes));
  const addInstance = (op: CadenceOperation, point: Point) => {
    const node = addNode(semanticInstanceNode(op, point, nodes));
    nodeByInstance.set(op, node);
    return node;
  };

  const pins = new Set(orderedComparatorPins(cell).map((pin) => pin.toLowerCase()));
  const pinNodes = new Map<string, SchematicNode>();
  if (pins.has("vdd")) pinNodes.set("vdd", addPin("vdd", "bidir", { x: 300, y: 15 }));
  if (pins.has("vinp")) pinNodes.set("vinp", addPin("vinp", "input", { x: 20, y: 250 }));
  if (pins.has("vinm")) pinNodes.set("vinm", addPin("vinm", "input", { x: 505, y: 250 }));
  if (pins.has("vout")) pinNodes.set("vout", addPin("vout", "output", { x: 750, y: 250 }));
  if (pins.has("vss")) pinNodes.set("vss", addPin("vss", "bidir", { x: 300, y: 510 }));

  const nM1 = addInstance(m1, { x: 150, y: 250 });
  const nM2 = addInstance(m2, { x: 350, y: 250 });
  const nM3 = addInstance(m3, { x: 150, y: 105 });
  const nM4 = addInstance(m4, { x: 350, y: 105 });
  const nM5 = addInstance(m5, { x: 600, y: 170 });
  const nM6 = addInstance(m6, { x: 600, y: 300 });
  const nTail = addInstance(tail, { x: 300, y: 405 });

  const terminal = (node: SchematicNode, portId: string): EdgeTerminal => ({ nodeId: node.id, portId });
  let order = 1;
  const labelCounts = new Map<string, number>();
  const externalPins = new Set([...pinNodes.keys()]);
  const addWire = (
    id: string,
    source: WireEndpoint,
    target: WireEndpoint,
    net?: string,
    vertices?: Point[],
  ) => {
    const edge = semanticWire(nodes, id, source, target, order, vertices);
    edges.push(edge);
    order += 1;
    if (net && !externalPins.has(net.toLowerCase())) {
      const count = (labelCounts.get(net) ?? 0) + 1;
      labelCounts.set(net, count);
      if (count === 1) {
        const label = semanticWireLabel(nodes, net, edge, cleanIdentifier(`label_${cell.name}_${net}`, `label_${netLabels.length + 1}`, 120));
        if (label) netLabels.push(label);
      }
    }
    return edge;
  };

  const net1 = connectionNet(m1, "D") || "net1";
  const net2 = connectionNet(m2, "D") || "net2";
  const vtail = connectionNet(m1, "S") || "vtail";
  const vdd = connectionNet(m3, "S") || "vdd";
  const vss = connectionNet(tail, "MINUS") || connectionNet(tail, "N") || "vss";
  const vinp = connectionNet(m1, "G") || "vinp";
  const vinm = connectionNet(m2, "G") || "vinm";
  const vout = connectionNet(m5, "D") || "vout";

  const pin = (name: string) => pinNodes.get(name.toLowerCase());
  if (pin("vinp")) addWire("wire_vinp_to_m1_gate", terminal(pin("vinp")!, "P"), terminal(nM1, "G"), vinp, [{ x: 20, y: 225 }, { x: 150, y: 225 }]);
  if (pin("vinm")) addWire("wire_vinm_to_m2_gate", terminal(pin("vinm")!, "P"), terminal(nM2, "G"), vinm, [{ x: 505, y: 225 }, { x: 350, y: 225 }]);
  if (pin("vout")) addWire("wire_vout_pin", terminal(nM6, "D"), terminal(pin("vout")!, "P"), vout, [{ x: 640, y: 250 }]);

  addWire("wire_net1_m1_m3", terminal(nM1, "D"), terminal(nM3, "D"), net1);
  addWire("wire_net1_diode", terminal(nM3, "D"), terminal(nM3, "G"), net1, [{ x: 190, y: 145 }, { x: 150, y: 145 }]);
  addWire("wire_net1_mirror_gate", terminal(nM3, "G"), terminal(nM4, "G"), net1, [{ x: 150, y: 80 }, { x: 350, y: 80 }]);

  addWire("wire_net2_m2_m4", terminal(nM2, "D"), terminal(nM4, "D"), net2);
  addWire("wire_net2_to_pgate", terminal(nM4, "D"), terminal(nM5, "G"), net2, [{ x: 390, y: 155 }, { x: 600, y: 155 }]);
  addWire("wire_net2_inverter_gates", terminal(nM5, "G"), terminal(nM6, "G"), net2);

  addWire("wire_vtail_left", terminal(nM1, "S"), terminal(nTail, "P"), vtail, [{ x: 190, y: 360 }]);
  addWire("wire_vtail_right", terminal(nM2, "S"), terminal(nTail, "P"), vtail, [{ x: 390, y: 360 }]);

  addWire("wire_vout_stack", terminal(nM5, "D"), terminal(nM6, "D"), vout);
  addWire("wire_vdd_m3_m4", terminal(nM3, "S"), terminal(nM4, "S"), vdd, [{ x: 190, y: 60 }, { x: 390, y: 60 }]);
  addWire("wire_vdd_m4_m5", terminal(nM4, "S"), terminal(nM5, "S"), vdd, [{ x: 390, y: 60 }, { x: 640, y: 60 }]);
  if (pin("vdd")) addWire("wire_vdd_pin", terminal(pin("vdd")!, "P"), terminal(nM3, "S"), vdd, [{ x: 300, y: 60 }, { x: 190, y: 60 }]);
  addWire("wire_m3_bulk", terminal(nM3, "B"), terminal(nM3, "S"), vdd);
  addWire("wire_m4_bulk", terminal(nM4, "B"), terminal(nM4, "S"), vdd);
  addWire("wire_m5_bulk", terminal(nM5, "B"), terminal(nM5, "S"), vdd);

  addWire("wire_vss_tail_pin", terminal(nTail, "N"), pin("vss") ? terminal(pin("vss")!, "P") : terminal(nM6, "S"), vss);
  addWire("wire_vss_m6_tail", terminal(nM6, "S"), terminal(nTail, "N"), vss, [{ x: 640, y: 450 }]);
  addWire("wire_m1_bulk", terminal(nM1, "B"), terminal(nTail, "N"), vss, [{ x: 245, y: 250 }, { x: 245, y: 450 }]);
  addWire("wire_m2_bulk", terminal(nM2, "B"), terminal(nTail, "N"), vss, [{ x: 445, y: 250 }, { x: 445, y: 450 }]);
  addWire("wire_m6_bulk", terminal(nM6, "B"), terminal(nM6, "S"), vss);

  const sourceRouteSegmentCount = cell.routes.reduce(
    (sum, op) => sum + routeSegments(op, options.coordinateScale, options.invertY).length,
    0,
  );
  const document: SchematicDocument = {
    ...base,
    library,
    nodes: nodes.sort((left, right) => compareText(left.id, right.id)),
    edges,
    netLabels,
    properties: {
      generatedBy: "cadence_schematic_convertor_backend",
      routedBy: "analog_studio_semantic_schematic_layout",
      routingStatus: "semantic_layout_from_build_plan",
      sourceFlow: "cadence_build_plan_semantic_layout",
      sourceServer: "configured_cadence_backend",
      sourceRun: options.sourceRun ?? "",
      payloadSha256: options.payloadSha256 ?? "",
      cadenceLibrary: library,
      cadenceCell: cell.name,
      cadenceRouteNetCount: String(cell.routes.length),
      cadenceRouteSegmentCount: "0",
      cadenceSourceRouteSegmentCount: String(sourceRouteSegmentCount),
      cadenceAdapterWireCount: "0",
      semanticLayout: "basic_cmos_comparator",
    },
    revisions: {
      designRevision: 1,
      savedRevision: 0,
      connectivityRevision: 0,
      checkRevision: 0,
    },
    extensions: {
      cadenceBuildPlanImport: {
        schema: "analog_studio.cadence_build_plan_import.v1",
        cell: cell.name,
        coordinateScale: options.coordinateScale,
        invertY: options.invertY,
        pinCount: cell.pins.length,
        instanceCount: cell.instances.length,
        routeNetCount: cell.routes.length,
        routeSegmentCount: 0,
        sourceRouteSegmentCount,
        adapterWireCount: 0,
        labelCount: netLabels.length,
        cadencePlaceNetLabelCount: cell.labels.length,
        semanticLayout: "basic_cmos_comparator",
      },
    },
  };
  return { document: parseSchematicDocument(document), routeSegmentCount: 0, adapterWireCount: 0 };
}

function orderedCellPins(cell: CellOps): CadenceOperation[] {
  return [...cell.pins].sort((left, right) => (readNumber(left.order) ?? 0) - (readNumber(right.order) ?? 0));
}

function isPowerNet(net: string): boolean {
  return /^(VDD|AVDD|DVDD|VCC)$/i.test(net);
}

function isGroundNet(net: string): boolean {
  return /^(0|GND|VSS|AVSS|DVSS)$/i.test(net);
}

function localIndexInSet(pin: string, pins: readonly CadenceOperation[], predicate: (op: CadenceOperation) => boolean): number {
  const names = pins.filter(predicate).map((op) => readString(op.pin).toUpperCase());
  return Math.max(0, names.indexOf(pin.toUpperCase()));
}

function fallbackSemanticPinPoint(op: CadenceOperation, pins: readonly CadenceOperation[]): Point {
  const pin = readString(op.pin);
  const direction = readString(op.direction).toLowerCase();
  if (isPowerNet(pin)) {
    const index = localIndexInSet(pin, pins, (candidate) => isPowerNet(readString(candidate.pin)));
    return { x: 620 + index * 160, y: 40 };
  }
  if (isGroundNet(pin)) {
    const index = localIndexInSet(pin, pins, (candidate) => isGroundNet(readString(candidate.pin)));
    return { x: 620 + index * 160, y: 720 };
  }
  if (direction === "output") {
    const index = localIndexInSet(pin, pins, (candidate) =>
      readString(candidate.direction).toLowerCase() === "output"
      && !isPowerNet(readString(candidate.pin))
      && !isGroundNet(readString(candidate.pin)));
    return { x: 1320, y: 180 + index * 105 };
  }
  const index = localIndexInSet(pin, pins, (candidate) =>
    readString(candidate.direction).toLowerCase() !== "output"
    && !isPowerNet(readString(candidate.pin))
    && !isGroundNet(readString(candidate.pin)));
  return { x: 60, y: 180 + index * 95 };
}

function fixedPinPoint(cellName: string, pin: string): Point | null {
  const normalized = cellName.toLowerCase();
  const upper = pin.toUpperCase();
  const fixed: Record<string, Record<string, Point>> = {
    sar_adc_10b_split_cdac_top: {
      VIN: { x: 60, y: 260 },
      CLK: { x: 60, y: 470 },
      RST: { x: 60, y: 560 },
      VREFP: { x: 520, y: 55 },
      VREFN: { x: 700, y: 55 },
      VCM: { x: 980, y: 55 },
      VDD: { x: 760, y: 30 },
      VSS: { x: 760, y: 700 },
      OUTP: { x: 1460, y: 245 },
      OUTN: { x: 1460, y: 355 },
      DOUT: { x: 1460, y: 540 },
    },
    cdac_split_10b_from_code: {
      CTRL: { x: 60, y: 150 },
      BIDIR_TOP: { x: 60, y: 330 },
      BIDIR_BOT: { x: 60, y: 445 },
      VREFP: { x: 2240, y: 220 },
      VREFN: { x: 2240, y: 330 },
      VCM: { x: 2240, y: 440 },
      VDD: { x: 1150, y: 40 },
      VSS: { x: 1150, y: 800 },
    },
    sar_logic_register_dac_ctrl: {
      CMP: { x: 60, y: 220 },
      CLK: { x: 60, y: 360 },
      RST: { x: 60, y: 480 },
      CTRL: { x: 930, y: 250 },
      DOUT: { x: 930, y: 430 },
      VDD: { x: 500, y: 40 },
      VSS: { x: 500, y: 650 },
    },
    sample_hold_tgate_mos: {
      VIN: { x: 60, y: 290 },
      CLK: { x: 60, y: 455 },
      CLKB: { x: 60, y: 545 },
      SAMPLED: { x: 780, y: 290 },
      VDD: { x: 420, y: 40 },
      VSS: { x: 420, y: 620 },
    },
    sar_bit_ctrl_buffer: {
      IN: { x: 60, y: 275 },
      OUTB: { x: 820, y: 210 },
      OUT: { x: 820, y: 375 },
      VDD: { x: 440, y: 40 },
      VSS: { x: 440, y: 620 },
    },
    sar_inv_only: {
      IN: { x: 60, y: 275 },
      OUT: { x: 660, y: 275 },
      VDD: { x: 360, y: 40 },
      VSS: { x: 360, y: 560 },
    },
    strongarm_comparator_offset_repaired: {
      INP: { x: 60, y: 345 },
      INN: { x: 60, y: 455 },
      CLK: { x: 60, y: 600 },
      OUTP: { x: 1180, y: 320 },
      OUTN: { x: 1180, y: 430 },
      VDD: { x: 620, y: 40 },
      VSS: { x: 620, y: 780 },
    },
  };
  if (/^cdac_bit\d+_mos_switch_cell$/i.test(cellName)) {
    const bitFixed: Record<string, Point> = {
      BIDIR_TOP: { x: 600, y: 70 },
      BIDIR_BOT: { x: 600, y: 670 },
      BP: { x: 60, y: 205 },
      BPB: { x: 60, y: 305 },
      BN: { x: 60, y: 405 },
      BNB: { x: 60, y: 505 },
      VREFP: { x: 930, y: 235 },
      VREFN: { x: 575, y: 390 },
      VCM: { x: 1110, y: 545 },
      VDD: { x: 600, y: 40 },
      VSS: { x: 600, y: 760 },
    };
    return bitFixed[upper] ?? null;
  }
  return fixed[normalized]?.[upper] ?? null;
}

function sarSemanticPinPoint(cell: CellOps, op: CadenceOperation, pins: readonly CadenceOperation[]): Point {
  const pin = readString(op.pin);
  return fixedPinPoint(cell.name, pin) ?? fallbackSemanticPinPoint(op, pins);
}

function sarPortMirrored(cellName: string, pin: string, kind: DeviceKind): boolean {
  if (kind === "output") return false;
  const normalized = cellName.toLowerCase();
  const upper = pin.toUpperCase();
  if (/^cdac_bit\d+_mos_switch_cell$/i.test(cellName) && /^(VREFP|VREFN|VCM)$/.test(upper)) return true;
  if (normalized === "cdac_split_10b_from_code" && /^(VREFP|VREFN|VCM)$/.test(upper)) return true;
  if (normalized === "sample_hold_tgate_mos" && upper === "SAMPLED") return true;
  if (normalized === "sar_logic_register_dac_ctrl" && upper === "CTRL") return true;
  return false;
}

function indexedInstancePoint(name: string, prefix: RegExp, startX: number, y: number, step = 190): Point | null {
  const match = name.match(prefix);
  if (!match) return null;
  return { x: startX + Number(match[1]) * step, y };
}

function sarSemanticInstancePoint(cell: CellOps, op: CadenceOperation, index: number): Point | null {
  const cellName = cell.name.toLowerCase();
  const name = instanceName(op).toUpperCase();
  if (cellName === "sar_adc_10b_split_cdac_top") {
    const points: Record<string, Point> = {
      XSH0: { x: 300, y: 300 },
      XCDAC0: { x: 610, y: 310 },
      XCMP0: { x: 920, y: 300 },
      XSAR0: { x: 1220, y: 455 },
      XCLKINV: { x: 300, y: 545 },
    };
    return points[name] ?? null;
  }
  if (cellName === "cdac_split_10b_from_code") {
    return indexedInstancePoint(name, /^XBUF(\d+)$/, 300, 185, 185)
      ?? indexedInstancePoint(name, /^XCU(\d+)$/, 300, 450, 185)
      ?? indexedInstancePoint(name, /^CWEIGHT(\d+)_/, 300, 680, 185)
      ?? (name === "CBRIDGE" ? { x: 155, y: 680 } : null);
  }
  if (cellName === "sar_logic_register_dac_ctrl") {
    const points: Record<string, Point> = {
      XCTRL: { x: 340, y: 260 },
      XDOUT: { x: 650, y: 430 },
      CCLK_LOAD: { x: 300, y: 520 },
      MN_RST: { x: 520, y: 455 },
      MP_KEEP: { x: 520, y: 130 },
    };
    return points[name] ?? null;
  }
  if (cellName === "sample_hold_tgate_mos") {
    const points: Record<string, Point> = {
      MSHP: { x: 335, y: 170 },
      MSHN: { x: 335, y: 390 },
      CHOLD: { x: 615, y: 430 },
    };
    return points[name] ?? null;
  }
  if (cellName === "sar_bit_ctrl_buffer") {
    const points: Record<string, Point> = {
      MP_INV0: { x: 250, y: 120 },
      MN_INV0: { x: 250, y: 360 },
      MP_INV1: { x: 560, y: 120 },
      MN_INV1: { x: 560, y: 360 },
    };
    return points[name] ?? null;
  }
  if (cellName === "sar_inv_only") {
    const points: Record<string, Point> = {
      MP_INV: { x: 300, y: 120 },
      MN_INV: { x: 300, y: 350 },
    };
    return points[name] ?? null;
  }
  if (cellName === "strongarm_comparator_offset_repaired") {
    const points: Record<string, Point> = {
      MXCMP_PRE_N: { x: 410, y: 95 },
      MXCMP_PRE_P: { x: 760, y: 95 },
      MXCMP_PLAT_N: { x: 410, y: 230 },
      MXCMP_PLAT_P: { x: 760, y: 230 },
      MXCMP_INP: { x: 410, y: 455 },
      MXCMP_INN: { x: 760, y: 455 },
      MXCMP_NLAT_N: { x: 410, y: 595 },
      MXCMP_NLAT_P: { x: 760, y: 595 },
      MXCMP_TAIL: { x: 590, y: 650 },
    };
    return points[name] ?? null;
  }
  if (/^cdac_bit\d+_mos_switch_cell$/i.test(cell.name)) {
    const points: Record<string, Point> = {
      CUNIT0: { x: 600, y: 180 },
      MREFP0P: { x: 785, y: 210 },
      MREFP0N: { x: 785, y: 335 },
      MREFN0P: { x: 430, y: 210 },
      MREFN0N: { x: 430, y: 335 },
      MVCM0P: { x: 960, y: 430 },
      MVCM0N: { x: 960, y: 555 },
    };
    const normalized = name.replace(/\d+/g, "0");
    return points[normalized] ?? null;
  }
  return { x: 220 + (index % 6) * 190, y: 180 + Math.floor(index / 6) * 170 };
}

function isSarHierarchyCell(cellName: string): boolean {
  return /^(sar_adc_10b_split_cdac_top|cdac_split_10b_from_code|sar_logic_register_dac_ctrl|sample_hold_tgate_mos|sar_bit_ctrl_buffer|sar_inv_only|strongarm_comparator_offset_repaired)$/i.test(cellName)
    || /^cdac_bit\d+_mos_switch_cell$/i.test(cellName);
}

function withHierarchyProperties(
  node: SchematicNode,
  op: CadenceOperation,
  library: string,
  childKeys: ReadonlyMap<string, string>,
): SchematicNode {
  const childCell = readString(op.source_subckt) || readString(readRecord(op.master).cell);
  const childKey = childKeys.get(childCell);
  if (!childKey) return node;
  return {
    ...node,
    properties: {
      ...node.properties,
      hierarchyChildKey: childKey,
      hierarchyCell: childCell,
      hierarchyLibrary: library,
      hierarchyView: "schematic",
      hierarchyEditable: "true",
    },
  };
}

function semanticNodeAt(
  op: CadenceOperation,
  point: Point,
  existingNodes: readonly SchematicNode[],
  library: string,
  childKeys: ReadonlyMap<string, string>,
): SchematicNode {
  const orient = readString(op.orient, "R0");
  const originalOrder = instancePortOrder(op, deviceKindForInstance(op));
  const visualOrder = sarVisualPinOrder(op);
  const visualOp = visualOrder ? { ...op, logical_pin_order: visualOrder } : op;
  const node = withCadencePrimitiveVisualSize(
    semanticInstanceNode({ ...visualOp, xy: [point.x, -point.y], orient }, point, existingNodes),
  );
  return withHierarchyProperties({
    ...node,
    properties: {
      ...node.properties,
      ...(originalOrder.length ? { portOrderFull: originalOrder.join(",") } : {}),
      ...(visualOrder ? { cadenceVisualPinOrder: visualOrder.join(",") } : {}),
    },
  }, op, library, childKeys);
}

function terminalPoint(nodes: readonly SchematicNode[], terminal: EdgeTerminal): Point | null {
  const node = nodes.find((candidate) => candidate.id === terminal.nodeId);
  return node ? getPinWorldPosition(node, terminal.portId) : null;
}

function sarSemanticNotes(cellName: string): SchematicNote[] {
  void cellName;
  return [];
}

function buildSarHierarchySemanticDocument(
  cell: CellOps,
  options: Required<Pick<CadenceBuildPlanImportOptions, "coordinateScale" | "invertY" | "includeAllCadenceLabels">>
    & Pick<CadenceBuildPlanImportOptions, "project" | "sourceRun" | "payloadSha256">,
  library: string,
  childKeys: ReadonlyMap<string, string>,
): { document: SchematicDocument; routeSegmentCount: number; adapterWireCount: number } | null {
  if (!isSarHierarchyCell(cell.name)) return null;

  const project = cleanDocumentName(options.project ?? library, library);
  const base = createEmptyDocument(project, cell.name);
  const nodes: SchematicNode[] = [];
  const edges: SchematicEdge[] = [];
  const netLabels: NetLabel[] = [];
  const pins = orderedCellPins(cell);
  const addNode = (node: SchematicNode) => {
    let candidate = node;
    let suffix = 2;
    const used = new Set(nodes.map((existing) => existing.id));
    while (used.has(candidate.id)) {
      candidate = { ...candidate, id: `${node.id}_${suffix}`.slice(0, 128) };
      suffix += 1;
    }
    nodes.push(candidate);
    return candidate;
  };

  const nodeByInstance = new Map<string, SchematicNode>();
  for (const op of pins) {
    const pin = readString(op.pin);
    if (!pin) continue;
    const kind = portKindForPin(op);
    addNode(portNodeAt(pin, kind, sarSemanticPinPoint(cell, op, pins), nodes, sarPortMirrored(cell.name, pin, kind)));
  }
  for (const [index, op] of cell.instances.entries()) {
    const point = sarSemanticInstancePoint(cell, op, index);
    if (!point) continue;
    const node = addNode(semanticNodeAt(op, point, nodes, library, childKeys));
    nodeByInstance.set(readString(op.instance), node);
  }

  const terminalsByNet = new Map<string, EdgeTerminal[]>();
  const addTerminal = (net: string, terminal: EdgeTerminal) => {
    if (!net) return;
    const list = terminalsByNet.get(net) ?? [];
    if (!list.some((candidate) => endpointKey(candidate) === endpointKey(terminal))) list.push(terminal);
    terminalsByNet.set(net, list);
  };
  for (const node of nodes.filter((candidate) =>
    candidate.kind === "input" || candidate.kind === "output" || candidate.kind === "bidir")) {
    addTerminal(node.properties.netName || node.instanceName, { nodeId: node.id, portId: "P" });
  }
  for (const op of cell.instances) {
    const node = nodeByInstance.get(readString(op.instance));
    if (!node) continue;
    for (const terminal of terminalNetMapForNode(op, node)) {
      addTerminal(terminal.net, { nodeId: node.id, portId: terminal.portId });
    }
  }

  let order = 1;
  let adapterWireCount = 0;
  const sortedNets = [...terminalsByNet.entries()].sort(([left], [right]) => compareText(left, right));
  for (const [netIndex, [net, terminals]] of sortedNets.entries()) {
    const visibleNet = cadenceStyleNetWires(
      nodes,
      cell.name,
      net,
      terminals,
      netIndex,
      order,
      "sar_semantic",
    );
    edges.push(...visibleNet.edges);
    netLabels.push(...visibleNet.labels);
    order += visibleNet.edges.length;
    adapterWireCount += visibleNet.edges.length;
  }

  const sourceRouteSegmentCount = cell.routes.reduce(
    (sum, op) => sum + routeSegments(op, options.coordinateScale, options.invertY).length,
    0,
  );
  const routeSegmentCount = edges.length;
  const terminalNetEntries = sortedNets.flatMap(([net, terminals]) =>
    terminals.map((terminal) => ({
      nodeId: terminal.nodeId,
      portId: terminal.portId,
      net,
      sourceId: cleanIdentifier(`sar_semantic_${cell.name}_${net}`, "sar_semantic_net", 120),
    })),
  );
  const document: SchematicDocument = {
    ...base,
    library,
    nodes: nodes.sort((left, right) => compareText(left.id, right.id)),
    edges,
    netLabels,
    notes: sarSemanticNotes(cell.name),
    properties: {
      generatedBy: "cadence_schematic_convertor_backend",
      routedBy: "analog_studio_sar_hierarchy_semantic_import",
      routingStatus: "hierarchical_semantic_from_build_plan",
      sourceFlow: "cadence_build_plan_sar_hierarchical_semantic_layout",
      sourceServer: "configured_cadence_backend",
      sourceRun: options.sourceRun ?? "",
      payloadSha256: options.payloadSha256 ?? "",
      cadenceLibrary: library,
      cadenceCell: cell.name,
      cadenceRouteNetCount: String(cell.routes.length),
      cadenceRouteSegmentCount: String(routeSegmentCount),
      cadenceSourceRouteSegmentCount: String(sourceRouteSegmentCount),
      cadenceAdapterWireCount: String(adapterWireCount),
      semanticLayout: "sar_adc_hierarchy",
    },
    revisions: {
      designRevision: 1,
      savedRevision: 0,
      connectivityRevision: 0,
      checkRevision: 0,
    },
    extensions: {
      cadenceBuildPlanImport: {
        schema: "analog_studio.cadence_build_plan_import.v1",
        cell: cell.name,
        coordinateScale: options.coordinateScale,
        invertY: options.invertY,
        pinCount: cell.pins.length,
        instanceCount: cell.instances.length,
        routeNetCount: cell.routes.length,
        routeSegmentCount,
        sourceRouteSegmentCount,
        adapterWireCount,
        labelCount: netLabels.length,
        cadencePlaceNetLabelCount: cell.labels.length,
        semanticLayout: "sar_adc_hierarchy",
      },
      cadenceTerminalNets: {
        schema: "analog_studio.cadence_terminal_nets.v1",
        source: "cadence_build_plan_connections",
        entries: terminalNetEntries,
      },
    },
  };
  return { document: parseSchematicDocument(document), routeSegmentCount, adapterWireCount };
}

export function isCadenceBuildPlan(input: unknown): boolean {
  const root = readRecord(input);
  if (!Array.isArray(root.operations)) return false;
  return root.operations.some((operation) => {
    const op = readString(readRecord(operation).op);
    return op === "create_cellview" || op === "route_net" || op === "place_instance";
  });
}

function inferLibrary(buildPlan: unknown, options: CadenceBuildPlanImportOptions): string {
  if (options.library) return cleanDocumentName(options.library, "work");
  const root = readRecord(buildPlan);
  const operations = Array.isArray(root.operations) ? root.operations.map(readRecord) : [];
  const createLibrary = operations.find((op) => readString(op.op) === "create_library");
  return cleanDocumentName(readString(createLibrary?.lib, "work"), "work");
}

function inferTopCell(cells: Map<string, CellOps>, options: CadenceBuildPlanImportOptions): string {
  if (options.topCell) return cleanDocumentName(options.topCell, "top");
  const referenced = new Set<string>();
  for (const cell of cells.values()) {
    for (const op of cell.instances) {
      const master = readRecord(op.master);
      const sourceSubckt = readString(op.source_subckt) || readString(master.cell);
      if (readString(op.source_kind) === "subckt" && sourceSubckt) {
        referenced.add(cleanDocumentName(sourceSubckt, sourceSubckt));
      }
    }
  }
  const unreferenced = [...cells.keys()].filter((cell) => !referenced.has(cell));
  return [...unreferenced, ...cells.keys()].at(-1) ?? "top";
}

function buildCellDocument(
  cell: CellOps,
  options: Required<Pick<CadenceBuildPlanImportOptions, "coordinateScale" | "invertY" | "includeAllCadenceLabels" | "preferSemanticLayouts">>
    & { coordinateScaleExplicit: boolean }
    & Pick<CadenceBuildPlanImportOptions, "project" | "sourceRun" | "payloadSha256">,
  library: string,
  childKeys: ReadonlyMap<string, string>,
): { document: SchematicDocument; routeSegmentCount: number; adapterWireCount: number } {
  if (options.preferSemanticLayouts) {
    const sarHierarchySemantic = buildSarHierarchySemanticDocument(cell, options, library, childKeys);
    if (sarHierarchySemantic) return sarHierarchySemantic;

    const semanticComparator = tryBuildBasicComparatorDocument(cell, options, library);
    if (semanticComparator) return semanticComparator;
  }

  const project = cleanDocumentName(options.project ?? library, library);
  const cellCoordinateScale = effectiveCoordinateScaleForCell(cell, options.coordinateScale, options.coordinateScaleExplicit);
  const base = createEmptyDocument(project, cell.name);
  const nodes: SchematicNode[] = [];
  const edges: SchematicEdge[] = [];
  const netLabels: NetLabel[] = [];
  const routeEdgesByNet = new Map<string, SchematicEdge[]>();

  const addNode = (node: SchematicNode) => {
    let candidate = node;
    let suffix = 2;
    const used = new Set(nodes.map((existing) => existing.id));
    while (used.has(candidate.id)) {
      candidate = { ...candidate, id: `${node.id}_${suffix}`.slice(0, 128) };
      suffix += 1;
    }
    nodes.push(candidate);
    return candidate;
  };

  for (const op of [...cell.pins].sort((left, right) => (readNumber(left.order) ?? 0) - (readNumber(right.order) ?? 0))) {
    const pin = readString(op.pin);
    const rawPoint = readPoint(op.xy);
    if (!pin || !rawPoint) continue;
    addNode(portNodeAt(pin, portKindForPin(op), transformPoint(rawPoint, cellCoordinateScale, options.invertY), nodes));
  }

  const nodeByInstance = new Map<string, SchematicNode>();
  for (const op of cell.instances) {
    const node = instanceNode(op, cellCoordinateScale, options.invertY, nodes);
    if (!node) continue;
    const childKey = childKeys.get(readString(op.source_subckt) || readString(readRecord(op.master).cell));
    const next = childKey
      ? {
        ...node,
        properties: {
          ...node.properties,
          hierarchyChildKey: childKey,
          hierarchyCell: readString(op.source_subckt) || readString(readRecord(op.master).cell),
          hierarchyLibrary: library,
          hierarchyView: "schematic",
          hierarchyEditable: "true",
        },
      }
      : node;
    nodeByInstance.set(readString(op.instance), addNode(next));
  }

  for (const op of cell.routes) {
    const net = readString(op.net, "NET");
    const segments = routeSegments(op, cellCoordinateScale, options.invertY);
    for (const [index, segment] of segments.entries()) {
      const edge: SchematicEdge = {
        id: cleanIdentifier(`cad_route_${cell.name}_${net}_${index + 1}`, `cad_route_${edges.length + 1}`, 120),
        source: segment.source,
        target: segment.target,
        style: "REFERENCE",
        width: 1,
        creationOrder: edges.length + 1,
      };
      edges.push(edge);
      const list = routeEdgesByNet.get(net) ?? [];
      list.push(edge);
      routeEdgesByNet.set(net, list);
    }
  }

  let adapterWireCount = 0;
  const adapterTerminalsByNet = new Map<string, EdgeTerminal[]>();
  const addTerminalAdapter = (terminal: EdgeTerminal, net: string) => {
    const node = nodes.find((candidate) => candidate.id === terminal.nodeId);
    const pinPoint = node ? getPinWorldPosition(node, terminal.portId) : null;
    if (!pinPoint) return;
    const list = adapterTerminalsByNet.get(net) ?? [];
    if (!list.some((candidate) => endpointKey(candidate) === endpointKey(terminal))) {
      list.push(terminal);
    }
    adapterTerminalsByNet.set(net, list);
  };

  for (const node of nodes.filter((candidate) =>
    candidate.kind === "input" || candidate.kind === "output" || candidate.kind === "bidir")) {
    addTerminalAdapter({ nodeId: node.id, portId: "P" }, node.properties.netName || node.instanceName);
  }

  for (const op of cell.instances) {
    const node = nodeByInstance.get(readString(op.instance));
    if (!node) continue;
    for (const terminal of terminalNetMapForNode(op, node)) {
      addTerminalAdapter({ nodeId: node.id, portId: terminal.portId }, terminal.net);
    }
  }

  const terminalNetEntries = [...adapterTerminalsByNet.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .flatMap(([net, terminals]) =>
      terminals
        .slice()
        .sort((left, right) => compareText(endpointKey(left), endpointKey(right)))
        .map((terminal, index) => ({
          nodeId: terminal.nodeId,
          portId: terminal.portId,
          net,
          sourceId: cleanIdentifier(
            `cadence_connection_${cell.name}_${net}_${terminalDescriptor(nodes, terminal)}_${index + 1}`,
            `cadence_connection_${index + 1}`,
            160,
          ),
        })));

  for (const [net, terminals] of [...adapterTerminalsByNet.entries()].sort(([left], [right]) => compareText(left, right))) {
    const routeEdges = routeEdgesByNet.get(net) ?? [];
    for (const terminal of terminals) {
      const stub = routeEdges.length
        ? labelledRouteTerminalAdapter(nodes, cell.name, net, terminal, routeEdges, adapterWireCount, edges.length + 1, "cad_adapter")
        : labelledTerminalStub(nodes, cell.name, net, terminal, adapterWireCount, edges.length + 1, "cad_adapter");
      if (!stub) continue;
      edges.push(stub.edge);
      if (stub.label) netLabels.push(stub.label);
      adapterWireCount += 1;
    }
  }

  const addLabel = (net: string, edge: SchematicEdge, anchorPoint?: Point) => {
    const id = cleanIdentifier(`label_${cell.name}_${net}_${netLabels.length + 1}`, `label_${netLabels.length + 1}`, 120);
    const label = labelOnEdge(id, net, edge, anchorPoint);
    if (label) netLabels.push(label);
  };

  if (options.includeAllCadenceLabels) {
    for (const op of cell.labels) {
      const net = readString(op.net);
      const rawPoint = readPoint(op.xy);
      const routeEdge = (routeEdgesByNet.get(net) ?? [])[0];
      if (!net || !rawPoint || !routeEdge) continue;
      addLabel(net, routeEdge, transformPoint(rawPoint, cellCoordinateScale, options.invertY));
    }
  }

  const routeSegmentCount = [...routeEdgesByNet.values()].reduce((sum, list) => sum + list.length, 0);
  const document: SchematicDocument = {
    ...base,
    library,
    nodes: nodes.sort((left, right) => compareText(left.id, right.id)),
    edges,
    netLabels,
    properties: {
      generatedBy: "cadence_schematic_convertor_backend",
      routedBy: "cadence_schematic_convertor_backend",
      routingStatus: "routed",
      sourceFlow: "cadence_build_plan_import",
      sourceServer: "configured_cadence_backend",
      sourceRun: options.sourceRun ?? "",
      payloadSha256: options.payloadSha256 ?? "",
      cadenceLibrary: library,
      cadenceCell: cell.name,
      cadenceRouteNetCount: String(cell.routes.length),
      cadenceRouteSegmentCount: String(routeSegmentCount),
      cadenceAdapterWireCount: String(adapterWireCount),
      cadenceRouteAdapterMode: "nearest_route_point",
      cadenceCoordinateScale: String(cellCoordinateScale),
    },
    revisions: {
      designRevision: 1,
      savedRevision: 0,
      connectivityRevision: 0,
      checkRevision: 0,
    },
    extensions: {
      cadenceBuildPlanImport: {
        schema: "analog_studio.cadence_build_plan_import.v1",
        cell: cell.name,
        coordinateScale: options.coordinateScale,
        invertY: options.invertY,
        pinCount: cell.pins.length,
        instanceCount: cell.instances.length,
        routeNetCount: cell.routes.length,
        routeSegmentCount,
        adapterWireCount,
        routeAdapterMode: "nearest_route_point",
        cellCoordinateScale,
        labelCount: netLabels.length,
        cadencePlaceNetLabelCount: cell.labels.length,
      },
      cadenceTerminalNets: {
        schema: "analog_studio.cadence_terminal_nets.v1",
        source: "cadence_build_plan_connections",
        entries: terminalNetEntries,
      },
    },
  };
  return { document: parseSchematicDocument(document), routeSegmentCount, adapterWireCount };
}

export function importCadenceBuildPlanAsSchematic(
  buildPlan: unknown,
  options: CadenceBuildPlanImportOptions = {},
): CadenceBuildPlanImportResult {
  const library = inferLibrary(buildPlan, options);
  const cells = groupOperations(buildPlan);
  if (!cells.size) throw new Error("Cadence build_plan contains no cell operations.");
  const topCell = inferTopCell(cells, options);
  const childKeys = new Map([...cells.keys()].map((cell) => [cell, `cellview:${cleanDocumentName(options.project ?? library, library)}:${cell}:schematic`]));
  const required = {
    coordinateScale: options.coordinateScale ?? DEFAULT_CADENCE_COORDINATE_SCALE,
    coordinateScaleExplicit: options.coordinateScale !== undefined,
    invertY: options.invertY ?? true,
    includeAllCadenceLabels: options.includeAllCadenceLabels ?? false,
    preferSemanticLayouts: options.preferSemanticLayouts ?? false,
  };
  const built = new Map<string, SchematicDocument>();
  let routeSegmentCount = 0;
  let adapterWireCount = 0;
  for (const cell of cells.values()) {
    const result = buildCellDocument(cell, { ...required, ...options }, library, childKeys);
    built.set(cell.name, result.document);
    routeSegmentCount += result.routeSegmentCount;
    adapterWireCount += result.adapterWireCount;
  }
  let root = built.get(topCell) ?? [...built.values()].at(-1);
  if (!root) throw new Error("Unable to build Cadence schematic document.");
  for (const [cell, child] of [...built.entries()].sort(([left], [right]) => compareText(left, right))) {
    if (cell === root.cell) continue;
    root = withHierarchyCellView(root, child, false);
  }
  root = {
    ...root,
    properties: {
      ...root.properties,
      cadenceTopCell: root.cell,
      cadenceImportedCellCount: String(built.size),
      cadenceImportedRouteSegmentCount: String(routeSegmentCount),
      cadenceImportedAdapterWireCount: String(adapterWireCount),
    },
  };
  return {
    document: parseSchematicDocument(root),
    summary: {
      library,
      topCell: root.cell,
      cellCount: built.size,
      instanceCount: [...cells.values()].reduce((sum, cell) => sum + cell.instances.length, 0),
      routeNetCount: [...cells.values()].reduce((sum, cell) => sum + cell.routes.length, 0),
      routeSegmentCount,
      adapterWireCount,
    },
  };
}
