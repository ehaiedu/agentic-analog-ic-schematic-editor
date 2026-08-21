import { z } from "zod";
import {
  canvasPositionToDocumentOrigin,
  createEmptyDocument,
  getDeviceDefinition,
  getPinWorldPosition,
  isEdgeTerminal,
  normalizeSchematicGeometry,
  orthogonalWireVertices,
  snapToElectricalGrid,
  type SchematicDocument,
  type SchematicEdge,
  type SchematicNode,
  type WireEndpoint,
} from "./schematic";
import { endpointPoint, isPointOnSegment, wireSegments } from "./schematicGeometry";

const deviceKindSchema = z.enum([
  "nmos4",
  "pmos4",
  "resistor",
  "capacitor",
  "inductor",
  "vsource",
  "isource",
  "vdd",
  "gnd",
  "input",
  "output",
  "bidir",
  "junction",
  "netlabel",
]);

const identifierSchema = z.string().min(1).max(128);
const legacyCoordinateSchema = z.number().finite().min(-10_000_000).max(10_000_000);
const dbuCoordinateSchema = legacyCoordinateSchema.int();
const terminalSchema = z.object({
  nodeId: identifierSchema,
  portId: z.string().min(1).max(32),
}).passthrough();
const pointSchema = z.object({ x: legacyCoordinateSchema, y: legacyCoordinateSchema }).passthrough();
const dbuPointSchema = z.object({ x: dbuCoordinateSchema, y: dbuCoordinateSchema }).passthrough();
const propertiesSchema = z.record(z.string().min(1).max(64), z.string().max(512)).refine(
  (properties) => Object.keys(properties).length <= 64,
  "单个对象的属性数量不能超过 64 个",
);
const nodeSchema = z.object({
  id: identifierSchema,
  kind: deviceKindSchema,
  x: legacyCoordinateSchema,
  y: legacyCoordinateSchema,
  width: z.number().positive().max(10_000),
  height: z.number().positive().max(10_000),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  mirrored: z.boolean(),
  instanceName: z.string().max(128),
  properties: propertiesSchema,
}).passthrough();

const edgeSchema = z.object({
  id: identifierSchema,
  source: z.union([terminalSchema, pointSchema]),
  target: z.union([terminalSchema, pointSchema]),
  vertices: z.array(pointSchema).max(1_024).optional(),
  style: z.enum(["NORMAL", "FLIGHT"]).optional(),
  width: z.number().int().positive().max(1_000).optional(),
  creationOrder: z.number().int().nonnegative().optional(),
}).passthrough();

const commonLegacyShape = {
  project: z.string().min(1).max(80),
  cell: z.string().min(1).max(80),
  view: z.literal("schematic"),
  nodes: z.array(nodeSchema).max(5_000),
};

function validateNodeAndEdgeReferences(
  document: {
    nodes: z.infer<typeof nodeSchema>[];
    edges: z.infer<typeof edgeSchema>[];
  },
  context: z.RefinementCtx,
) {
  const nodeById = new Map<string, (typeof document.nodes)[number]>();
  document.nodes.forEach((node, index) => {
    if (nodeById.has(node.id)) {
      context.addIssue({
        code: "custom",
        path: ["nodes", index, "id"],
        message: `器件 ID 重复：${node.id}`,
      });
    }
    nodeById.set(node.id, node);
  });

  const edgeIds = new Set<string>();
  document.edges.forEach((edge, index) => {
    if (edgeIds.has(edge.id)) {
      context.addIssue({
        code: "custom",
        path: ["edges", index, "id"],
        message: `连线 ID 重复：${edge.id}`,
      });
    }
    edgeIds.add(edge.id);

    const terminals = [
      ...(isEdgeTerminal(edge.source) ? [["source", edge.source] as const] : []),
      ...(isEdgeTerminal(edge.target) ? [["target", edge.target] as const] : []),
    ] as const;
    terminals.forEach(([side, terminal]) => {
      const node = nodeById.get(terminal.nodeId);
      if (!node) {
        context.addIssue({
          code: "custom",
          path: ["edges", index, side, "nodeId"],
          message: `连线引用了不存在的器件：${terminal.nodeId}`,
        });
        return;
      }
      if (!getDeviceDefinition(node.kind).pins.some((pin) => pin.id === terminal.portId)) {
        context.addIssue({
          code: "custom",
          path: ["edges", index, side, "portId"],
          message: `端口 ${terminal.portId} 不属于器件 ${terminal.nodeId}`,
        });
      }
    });
  });
}

const version1DocumentSchema = z.object({
  version: z.literal(1),
  ...commonLegacyShape,
  edges: z.array(z.object({
    id: identifierSchema,
    source: terminalSchema,
    target: terminalSchema,
    vertices: z.array(pointSchema).max(1_024).optional(),
  }).passthrough()).max(20_000),
}).passthrough().superRefine(validateNodeAndEdgeReferences);

const version2DocumentSchema = z.object({
  version: z.literal(2),
  ...commonLegacyShape,
  edges: z.array(edgeSchema).max(20_000),
}).passthrough().superRefine(validateNodeAndEdgeReferences);

const explicitJunctionSchema = z.object({
  id: identifierSchema,
  point: dbuPointSchema,
}).passthrough();
const netLabelSchema = z.object({
  id: identifierSchema,
  text: z.string().min(1).max(256),
  wireId: identifierSchema,
  segmentIndex: z.number().int().nonnegative(),
  anchorPoint: dbuPointSchema,
  orientation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  textAlignment: z.enum(["start", "middle", "end"]),
}).passthrough();
const noConnectSchema = z.object({
  id: identifierSchema,
  nodeId: identifierSchema,
  portId: z.string().min(1).max(32),
  position: dbuPointSchema,
}).passthrough();
const noteSchema = z.object({
  id: identifierSchema,
  text: z.string().max(4_096),
  anchorPoint: dbuPointSchema,
  orientation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
}).passthrough();
const markerSchema = z.object({
  id: identifierSchema,
  ruleId: identifierSchema,
  severity: z.enum(["error", "warning", "info"]),
  message: z.string().max(1_024),
  objectRefs: z.array(identifierSchema).max(64),
  boundingBox: z.object({
    x: dbuCoordinateSchema,
    y: dbuCoordinateSchema,
    width: z.number().int().nonnegative(),
    height: z.number().int().nonnegative(),
  }).passthrough(),
  revision: z.number().int().nonnegative(),
  status: z.enum(["active", "waived", "obsolete"]),
}).passthrough();

export const schematicDocumentSchema = z.object({
  version: z.literal(3),
  formatVersion: z.literal(1),
  editorProfile: z.literal("VSE-Core-1"),
  id: identifierSchema,
  library: z.string().min(1).max(80),
  project: z.string().min(1).max(80),
  cell: z.string().min(1).max(80),
  view: z.literal("schematic"),
  sheetId: identifierSchema,
  units: z.object({
    userUnit: z.literal("um"),
    dbuPerUserUnit: z.number().int().positive().max(1_000_000_000),
  }).passthrough(),
  snapGrid: z.number().int().positive().max(1_000_000),
  displayGrid: z.number().int().positive().max(1_000_000),
  nodes: z.array(nodeSchema.extend({ x: dbuCoordinateSchema, y: dbuCoordinateSchema })).max(5_000),
  edges: z.array(edgeSchema).max(20_000),
  explicitJunctions: z.array(explicitJunctionSchema).max(20_000),
  netLabels: z.array(netLabelSchema).max(5_000),
  noConnects: z.array(noConnectSchema).max(20_000),
  notes: z.array(noteSchema).max(5_000),
  markers: z.array(markerSchema).max(20_000),
  properties: propertiesSchema,
  revisions: z.object({
    designRevision: z.number().int().nonnegative(),
    savedRevision: z.number().int().nonnegative(),
    connectivityRevision: z.number().int().nonnegative(),
    checkRevision: z.number().int().nonnegative(),
  }).passthrough(),
  extensions: z.record(z.string(), z.unknown()).optional(),
}).passthrough().superRefine((document, context) => {
  validateNodeAndEdgeReferences(document, context);
  document.nodes.forEach((node, index) => {
    if (node.kind === "junction" || node.kind === "netlabel") {
      context.addIssue({
        code: "custom",
        path: ["nodes", index, "kind"],
        message: `${node.kind} 必须使用 v3 独立正式对象表示，不能继续作为器件节点保存`,
      });
    }
  });
  const allIds = new Set(document.nodes.map((node) => node.id));
  const registerId = (id: string, path: (string | number)[]) => {
    if (allIds.has(id)) {
      context.addIssue({ code: "custom", path, message: `正式对象 ID 重复：${id}` });
    }
    allIds.add(id);
  };
  document.edges.forEach((edge, index) => registerId(edge.id, ["edges", index, "id"]));
  document.explicitJunctions.forEach((item, index) => registerId(item.id, ["explicitJunctions", index, "id"]));
  document.netLabels.forEach((item, index) => registerId(item.id, ["netLabels", index, "id"]));
  document.noConnects.forEach((item, index) => registerId(item.id, ["noConnects", index, "id"]));
  document.notes.forEach((item, index) => registerId(item.id, ["notes", index, "id"]));

  const wireById = new Map(document.edges.map((wire) => [wire.id, wire]));
  for (const [index, label] of document.netLabels.entries()) {
    const wire = wireById.get(label.wireId);
    if (!wire) {
      context.addIssue({
        code: "custom",
        path: ["netLabels", index, "wireId"],
        message: `网络标签引用了不存在的 Wire：${label.wireId}`,
      });
      continue;
    }
    const segments = wireSegments(document as SchematicDocument, wire);
    const segment = segments[label.segmentIndex];
    if (!segment || !isPointOnSegment(label.anchorPoint, segment.start, segment.end)) {
      context.addIssue({
        code: "custom",
        path: ["netLabels", index, "anchorPoint"],
        message: `网络标签 ${label.id} 未附着在有效 Wire segment 上`,
      });
    }
  }

  const nodeById = new Map(document.nodes.map((node) => [node.id, node]));
  for (const [index, noConnect] of document.noConnects.entries()) {
    const node = nodeById.get(noConnect.nodeId);
    const pin = node && getDeviceDefinition(node.kind).pins.find((candidate) => candidate.id === noConnect.portId);
    if (!node || !pin || node.kind === "input" || node.kind === "output" || node.kind === "bidir") {
      context.addIssue({
        code: "custom",
        path: ["noConnects", index],
        message: `No Connect ${noConnect.id} 未引用有效 Instance Terminal`,
      });
    }
  }
});

const supportedDocumentSchema = z.union([
  version1DocumentSchema,
  version2DocumentSchema,
  schematicDocumentSchema,
]);

function migrateLegacyNodeOrigins(
  nodes: z.infer<typeof nodeSchema>[],
  positionsAreTopLeft: boolean,
): SchematicNode[] {
  return nodes.map((legacyNode) => {
    const definition = getDeviceDefinition(legacyNode.kind);
    const canonicalNode: SchematicNode = {
      ...legacyNode,
      width: definition.width,
      height: definition.height,
      x: snapToElectricalGrid(legacyNode.x),
      y: snapToElectricalGrid(legacyNode.y),
    };
    if (!positionsAreTopLeft) return canonicalNode;
    const origin = canvasPositionToDocumentOrigin(canonicalNode, {
      x: snapToElectricalGrid(legacyNode.x),
      y: snapToElectricalGrid(legacyNode.y),
    });
    return {
      ...canonicalNode,
      x: snapToElectricalGrid(origin.x),
      y: snapToElectricalGrid(origin.y),
    };
  });
}

function migrateLegacy(
  document: z.infer<typeof version1DocumentSchema> | z.infer<typeof version2DocumentSchema>,
): SchematicDocument {
  const base = createEmptyDocument(document.project, document.cell);
  const migratedNodes = migrateLegacyNodeOrigins(document.nodes, document.version === 1);
  const utilityNodes = new Map(migratedNodes
    .filter((node) => node.kind === "junction" || node.kind === "netlabel")
    .map((node) => [node.id, node]));
  const formalNodes = migratedNodes.filter((node) => node.kind !== "junction" && node.kind !== "netlabel");
  const utilityPoint = (nodeId: string, portId: string) => {
    const node = utilityNodes.get(nodeId);
    return node ? getPinWorldPosition(node, portId) : null;
  };
  const convertEndpoint = (endpoint: z.infer<typeof terminalSchema> | z.infer<typeof pointSchema>): WireEndpoint => {
    if (!isEdgeTerminal(endpoint)) return endpoint;
    return utilityPoint(endpoint.nodeId, endpoint.portId) ?? endpoint;
  };
  const unknownFields = Object.fromEntries(Object.entries(document).filter(([key]) => ![
    "version", "project", "cell", "view", "nodes", "edges",
  ].includes(key)));
  const edges = document.edges.map((edge, index): SchematicEdge => {
    const optional = edge as typeof edge & {
      style?: unknown;
      width?: unknown;
      creationOrder?: unknown;
    };
    const source = convertEndpoint(edge.source);
    const target = convertEndpoint(edge.target);
    const sourcePoint = endpointPoint({ nodes: formalNodes }, source);
    const targetPoint = endpointPoint({ nodes: formalNodes }, target);
    const vertices = edge.vertices?.length
      ? edge.vertices
      : sourcePoint && targetPoint
        ? orthogonalWireVertices(sourcePoint, targetPoint)
        : [];
    return {
      id: edge.id,
      source,
      target,
      ...(vertices.length ? { vertices } : {}),
      style: optional.style === "FLIGHT" ? "FLIGHT" : "NORMAL",
      width: typeof optional.width === "number" && Number.isInteger(optional.width)
        ? optional.width
        : 1,
      creationOrder: typeof optional.creationOrder === "number"
        && Number.isInteger(optional.creationOrder)
        ? optional.creationOrder
        : index,
    };
  });
  const migrated = normalizeSchematicGeometry({
    ...base,
    nodes: formalNodes,
    edges,
    explicitJunctions: [...utilityNodes.values()]
      .filter((node) => node.kind === "junction")
      .map((node) => ({
        id: node.id,
        point: getPinWorldPosition(node, "P") ?? { x: node.x, y: node.y },
      })),
    extensions: Object.keys(unknownFields).length ? { legacy: unknownFields } : undefined,
  });

  const netLabels = [...utilityNodes.values()]
    .filter((node) => node.kind === "netlabel")
    .flatMap((node) => {
      const originalEdgeIndex = document.edges.findIndex((edge) =>
        (isEdgeTerminal(edge.source) && edge.source.nodeId === node.id)
        || (isEdgeTerminal(edge.target) && edge.target.nodeId === node.id));
      if (originalEdgeIndex < 0) return [];
      const wire = migrated.edges[originalEdgeIndex];
      const anchorPoint = getPinWorldPosition(node, "P") ?? { x: node.x, y: node.y };
      const segments = wireSegments(migrated, wire);
      const segmentIndex = Math.max(0, segments.findIndex((segment) =>
        isPointOnSegment(anchorPoint, segment.start, segment.end)));
      return [{
        id: node.id,
        text: node.properties.netName || node.instanceName || "NET",
        wireId: wire.id,
        segmentIndex,
        anchorPoint,
        orientation: node.rotation,
        textAlignment: "start" as const,
      }];
    });
  return { ...migrated, netLabels };
}

export function parseSchematicDocument(input: unknown): SchematicDocument {
  const parsed = supportedDocumentSchema.parse(input);
  if (parsed.version === 1 || parsed.version === 2) return migrateLegacy(parsed);
  return normalizeSchematicGeometry(parsed as SchematicDocument);
}
