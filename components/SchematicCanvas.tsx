"use client";

import {
  Clipboard,
  Dom,
  Graph,
  History,
  Keyboard,
  Selection,
  Snapline,
  type Cell,
  type Edge,
  type Node,
} from "@antv/x6";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type DragEvent,
} from "react";
import {
  canvasPositionToDocumentOrigin,
  createDeviceNode,
  createEmptyDocument,
  ELECTRICAL_GRID_SIZE,
  getDeviceDefinition,
  getPinWorldPosition,
  isEdgeTerminal,
  normalizeSchematicGeometry,
  snapToElectricalGrid,
  VISUAL_GRID_SIZE,
  withDesignRevision,
  type DeviceKind,
  type ExplicitJunction,
  type NetLabel,
  type Rotation,
  type Point,
  type SchematicDocument,
  type SchematicEdge,
  type SchematicNode,
  type WireEndpoint,
} from "../lib/schematic";
import { createX6NodeMetadata, getNodeVisualAttrs } from "./x6Symbols";
import {
  closestPointOnOrthogonalSegment,
  isPointOnSegment,
  normalizePointList,
  routeOrthogonal,
  squaredDistance,
} from "../lib/schematicGeometry";
import type { WireDrawMode } from "../lib/compatibilityProfile";
import { extractConnectivity } from "../lib/connectivity";

export interface SchematicCanvasHandle {
  addDevice: (kind: DeviceKind, position?: { x: number; y: number }) => void;
  addDeviceAtClient: (kind: DeviceKind, clientX: number, clientY: number) => void;
  rotateSelected: () => void;
  mirrorSelected: () => void;
  deleteSelected: () => void;
  copySelected: () => void;
  undo: () => void;
  redo: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  setGridMode: (mode: GridMode) => void;
  clear: () => void;
  loadDocument: (document: SchematicDocument) => void;
  setDocumentMetadata: (document: SchematicDocument) => void;
  focusMarker: (markerId: string) => void;
  getDocument: () => SchematicDocument;
  updateSelectedProperties: (patch: Record<string, string>) => void;
  setToolMode: (mode: ToolMode) => void;
  setWireDrawMode: (mode: WireDrawMode) => void;
}

export type GridMode = "dot" | "mesh" | "off";
export type ToolMode = "select" | "wire" | "no-connect";

export interface CanvasCommandState {
  command: "select" | "create-wire" | "add-no-connect";
  phase: "IDLE" | "COMMAND_ARMED" | "DYNAMIC_PREVIEW";
  prompt: string;
  fixedPointCount: number;
  snapCandidate: "pin" | "wire-endpoint" | "junction" | "wire-segment" | "grid" | null;
  partialSelection: boolean;
}

export interface CanvasViewport {
  /** Canvas pixel position occupied by document coordinate (0, 0). */
  originX: number;
  originY: number;
  scale: number;
  width: number;
  height: number;
}

interface SchematicCanvasProps {
  initialDocument: SchematicDocument;
  toolMode?: ToolMode;
  onDocumentChange?: (document: SchematicDocument) => void;
  onSelectionChange?: (node: SchematicNode | null) => void;
  onNodeDoubleClick?: (node: SchematicNode) => void;
  onToolModeChange?: (mode: ToolMode) => void;
  onViewportChange?: (viewport: CanvasViewport) => void;
  onCursorPositionChange?: (position: Point | null) => void;
  wireDrawMode?: WireDrawMode;
  onWireDrawModeChange?: (mode: WireDrawMode) => void;
  onCommandStateChange?: (state: CanvasCommandState) => void;
  onCommandOptionsRequest?: () => void;
}

interface ActiveWireDraft {
  edge: Edge;
  marker: Node;
  targetMarker: Node;
  source: WireEndpoint;
  sourceCandidate: SnapCandidate;
  fixedPoints: Point[];
  fixedPointHistory: Point[][];
  cursorPoint: Point;
  snapCandidate: CanvasCommandState["snapCandidate"];
  activeCandidate: SnapCandidate;
  previewSuppressed: boolean;
}

interface SnapCandidate {
  point: Point;
  kind: NonNullable<CanvasCommandState["snapCandidate"]>;
  endpoint?: WireEndpoint;
  edge?: Edge;
}

let analogWireRegistered = false;
let analogGridRegistered = false;

const VISUAL_GRID_FACTOR = VISUAL_GRID_SIZE / ELECTRICAL_GRID_SIZE;
const WIRE_ROUTER_ARGS = {
  padding: 10,
  step: ELECTRICAL_GRID_SIZE,
  snapToGrid: false,
};

const SELECTABLE_WIRE_ATTRS = {
  wrap: {
    cursor: "pointer",
    pointerEvents: "stroke",
  },
} as const;

function registerGridShapes() {
  if (analogGridRegistered) return;
  Graph.registerGrid(
    "analog-major-dot",
    {
      color: "#a8adb3",
      thickness: 1.55,
      markup: "rect",
      update(elem, options) {
        options.width *= VISUAL_GRID_FACTOR;
        options.height *= VISUAL_GRID_FACTOR;
        const size = options.sx <= 1 ? options.thickness * options.sx : options.thickness;
        Dom.attr(elem, {
          width: size,
          height: size,
          rx: size,
          ry: size,
          fill: options.color,
        });
      },
    },
    true,
  );
  Graph.registerGrid(
    "analog-major-mesh",
    {
      color: "#d7d7d7",
      thickness: 1,
      markup: "path",
      update(elem, options) {
        options.width *= VISUAL_GRID_FACTOR;
        options.height *= VISUAL_GRID_FACTOR;
        const { width, height, thickness } = options;
        const d = width - thickness >= 0 && height - thickness >= 0
          ? ["M", width, 0, "H0 M0 0 V0", height].join(" ")
          : "M 0 0 0 0";
        Dom.attr(elem, {
          d,
          stroke: options.color,
          "stroke-width": thickness,
        });
      },
    },
    true,
  );
  analogGridRegistered = true;
}

function registerWireShape() {
  if (analogWireRegistered) return;
  Graph.registerEdge(
    "analog-wire",
    {
      inherit: "edge",
      connector: { name: "normal" },
      markup: [
        {
          tagName: "path",
          selector: "wrap",
          groupSelector: "lines",
          className: "analog-wire-hit",
          attrs: {
            fill: "none",
            cursor: "pointer",
            stroke: "transparent",
            strokeLinecap: "round",
            pointerEvents: "stroke",
          },
        },
        {
          tagName: "path",
          selector: "selectionHalo",
          groupSelector: "lines",
          className: "analog-wire-selection-halo",
          attrs: { fill: "none", pointerEvents: "none" },
        },
        {
          tagName: "path",
          selector: "line",
          groupSelector: "lines",
          className: "analog-wire-line",
          attrs: { fill: "none", pointerEvents: "none" },
        },
      ],
      attrs: {
        lines: {
          connection: true,
          strokeLinejoin: "miter",
        },
        // Keep an 8 px screen-space hit radius even after zooming out. The
        // visible wire remains thin; only this transparent path receives input.
        wrap: {
          stroke: "transparent",
          strokeWidth: 16,
          vectorEffect: "non-scaling-stroke",
        },
        selectionHalo: {
          stroke: "#5b9bd5",
          strokeWidth: 4.5,
          strokeDasharray: "5 3",
          strokeLinecap: "butt",
          opacity: 0,
          vectorEffect: "non-scaling-stroke",
        },
        line: {
          stroke: "#484644",
          strokeWidth: 1.45,
          sourceMarker: null,
          targetMarker: null,
          strokeLinecap: "square",
          strokeLinejoin: "miter",
          vectorEffect: "non-scaling-stroke",
        },
      },
      zIndex: 0,
    },
    true,
  );
  analogWireRegistered = true;
}

function terminalCellId(cell: unknown): string | null {
  if (typeof cell === "string") return cell;
  if (cell && typeof cell === "object" && "id" in cell) return String((cell as { id: unknown }).id);
  return null;
}

function normalizeRotation(angle: number): Rotation {
  const normalized = ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
  return normalized as Rotation;
}

function nodeSnapshot(node: Node): SchematicNode {
  const data = node.getData<SchematicNode>();
  const position = node.getPosition();
  const size = node.getSize();
  const visualNode: SchematicNode = {
    ...data,
    // X6 assigns a new cell id when cloning. The cell id is authoritative for
    // the rendered projection, otherwise clipboard paste would persist the
    // original data.id and create duplicate formal object identities.
    id: node.id,
    width: Math.round(size.width),
    height: Math.round(size.height),
    rotation: normalizeRotation(node.getAngle()),
  };
  const origin = canvasPositionToDocumentOrigin(visualNode, position);
  return {
    ...visualNode,
    x: snapToElectricalGrid(origin.x),
    y: snapToElectricalGrid(origin.y),
  };
}

function junctionCanvasNode(junction: ExplicitJunction): SchematicNode {
  return {
    ...createDeviceNode("junction", junction.point.x - 10, junction.point.y - 10),
    id: junction.id,
    instanceName: junction.id,
    properties: { objectType: "explicit-junction" },
  };
}

function netLabelCanvasNode(label: NetLabel): SchematicNode {
  return {
    ...createDeviceNode("netlabel", label.anchorPoint.x, label.anchorPoint.y - 15),
    id: label.id,
    rotation: label.orientation,
    instanceName: label.text,
    properties: {
      netName: label.text,
      wireId: label.wireId,
      segmentIndex: String(label.segmentIndex),
      textAlignment: label.textAlignment,
      objectType: "net-label",
    },
  };
}

function utilityEndpointPoint(node: SchematicNode, portId: string): Point | null {
  if (node.kind !== "junction" && node.kind !== "netlabel") return null;
  return getPinWorldPosition(node, portId);
}

function x6Endpoint(endpoint: WireEndpoint) {
  return isEdgeTerminal(endpoint)
    ? { cell: endpoint.nodeId, port: endpoint.portId }
    : endpoint;
}

function persistedEndpoint(endpoint: ReturnType<Edge["getSource"]>): WireEndpoint | null {
  if ("cell" in endpoint && "port" in endpoint) {
    const nodeId = terminalCellId(endpoint.cell);
    if (!nodeId || !endpoint.port) return null;
    return { nodeId, portId: String(endpoint.port) };
  }
  if ("x" in endpoint && "y" in endpoint) {
    return {
      x: snapToElectricalGrid(Number(endpoint.x)),
      y: snapToElectricalGrid(Number(endpoint.y)),
    };
  }
  return null;
}

function endpointWorldPoint(graph: Graph, endpoint: WireEndpoint): Point | null {
  if (!isEdgeTerminal(endpoint)) {
    return {
      x: snapToElectricalGrid(endpoint.x),
      y: snapToElectricalGrid(endpoint.y),
    };
  }
  const cell = graph.getCellById(endpoint.nodeId);
  if (!cell?.isNode()) return null;
  return getPinWorldPosition(nodeSnapshot(cell as Node), endpoint.portId);
}

function graphDocument(graph: Graph, base: SchematicDocument): SchematicDocument {
  const snapshots = graph.getNodes()
    .filter((node) => !node.getData<{ wireDraft?: boolean }>()?.wireDraft)
    .map(nodeSnapshot);
  const utilityById = new Map(snapshots
    .filter((node) => node.kind === "junction" || node.kind === "netlabel")
    .map((node) => [node.id, node]));
  const nodes = snapshots
    .filter((node) => node.kind !== "junction" && node.kind !== "netlabel")
    .sort((left, right) => left.id.localeCompare(right.id, "en", { numeric: true }));
  const explicitJunctions = snapshots
    .filter((node) => node.kind === "junction")
    .map((node) => ({
      id: node.id,
      point: getPinWorldPosition(node, "P") ?? { x: node.x + node.width / 2, y: node.y + node.height / 2 },
    }))
    .sort((left, right) => left.id.localeCompare(right.id, "en", { numeric: true }));
  const netLabels: NetLabel[] = snapshots
    .filter((node) => node.kind === "netlabel" && node.properties.wireId)
    .map((node): NetLabel => ({
      id: node.id,
      text: node.properties.netName || node.instanceName,
      wireId: node.properties.wireId,
      segmentIndex: Math.max(0, Number.parseInt(node.properties.segmentIndex || "0", 10) || 0),
      anchorPoint: getPinWorldPosition(node, "P") ?? { x: node.x, y: node.y },
      orientation: node.rotation,
      textAlignment: node.properties.textAlignment === "middle" || node.properties.textAlignment === "end"
        ? node.properties.textAlignment
        : "start",
    }))
    .sort((left, right) => left.id.localeCompare(right.id, "en", { numeric: true }));
  const edges: SchematicEdge[] = [];
  for (const edge of graph.getEdges()) {
    if (edge.getData<{ wireDraft?: boolean }>()?.wireDraft) continue;
    const source = edge.getSource();
    const target = edge.getTarget();
    let persistedSource = persistedEndpoint(source);
    let persistedTarget = persistedEndpoint(target);
    if (!persistedSource || !persistedTarget) continue;
    if (isEdgeTerminal(persistedSource)) {
      const utility = utilityById.get(persistedSource.nodeId);
      persistedSource = utility
        ? utilityEndpointPoint(utility, persistedSource.portId) ?? persistedSource
        : persistedSource;
    }
    if (isEdgeTerminal(persistedTarget)) {
      const utility = utilityById.get(persistedTarget.nodeId);
      persistedTarget = utility
        ? utilityEndpointPoint(utility, persistedTarget.portId) ?? persistedTarget
        : persistedTarget;
    }
    const vertices = edge.getVertices().map((point) => ({
      x: snapToElectricalGrid(point.x),
      y: snapToElectricalGrid(point.y),
    }));
    edges.push({
      id: edge.id,
      source: persistedSource,
      target: persistedTarget,
      ...(vertices.length ? { vertices } : {}),
    });
  }
  edges.sort((left, right) => left.id.localeCompare(right.id, "en", { numeric: true }));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const noConnects = base.noConnects
    .filter((marker) => nodeById.has(marker.nodeId))
    .flatMap((marker) => {
      const node = nodeById.get(marker.nodeId)!;
      const position = getPinWorldPosition(node, marker.portId);
      return position ? [{ ...marker, position }] : [];
    })
    .sort((left, right) => left.id.localeCompare(right.id, "en", { numeric: true }));
  return { ...base, nodes, edges, explicitJunctions, netLabels, noConnects };
}

function edgeConfig(edge: SchematicEdge) {
  return {
    id: edge.id,
    shape: "analog-wire",
    source: x6Endpoint(edge.source),
    target: x6Endpoint(edge.target),
    vertices: edge.vertices,
    attrs: SELECTABLE_WIRE_ATTRS,
  };
}

export const SchematicCanvas = forwardRef<SchematicCanvasHandle, SchematicCanvasProps>(function SchematicCanvas(
  {
    initialDocument,
    toolMode = "select",
    onDocumentChange,
    onSelectionChange,
    onNodeDoubleClick,
    onToolModeChange,
    onViewportChange,
    onCursorPositionChange,
    wireDrawMode = "route",
    onWireDrawModeChange,
    onCommandStateChange,
    onCommandOptionsRequest,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);
  const historyRef = useRef<History | null>(null);
  const selectionRef = useRef<Selection | null>(null);
  const clipboardRef = useRef<Clipboard | null>(null);
  const baseDocumentRef = useRef(initialDocument);
  const loadingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const viewportRafRef = useRef<number | null>(null);
  const onDocumentChangeRef = useRef(onDocumentChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onNodeDoubleClickRef = useRef(onNodeDoubleClick);
  const onToolModeChangeRef = useRef(onToolModeChange);
  const onViewportChangeRef = useRef(onViewportChange);
  const onCursorPositionChangeRef = useRef(onCursorPositionChange);
  const onWireDrawModeChangeRef = useRef(onWireDrawModeChange);
  const onCommandStateChangeRef = useRef(onCommandStateChange);
  const onCommandOptionsRequestRef = useRef(onCommandOptionsRequest);
  const toolModeRef = useRef<ToolMode>(toolMode);
  const wireDrawModeRef = useRef<WireDrawMode>(wireDrawMode);
  const partialSelectionRef = useRef(false);
  const activeWireDraftRef = useRef<ActiveWireDraft | null>(null);

  onDocumentChangeRef.current = onDocumentChange;
  onSelectionChangeRef.current = onSelectionChange;
  onNodeDoubleClickRef.current = onNodeDoubleClick;
  onToolModeChangeRef.current = onToolModeChange;
  onViewportChangeRef.current = onViewportChange;
  onCursorPositionChangeRef.current = onCursorPositionChange;
  onWireDrawModeChangeRef.current = onWireDrawModeChange;
  onCommandStateChangeRef.current = onCommandStateChange;
  onCommandOptionsRequestRef.current = onCommandOptionsRequest;

  const emitDocument = () => {
    const graph = graphRef.current;
    if (!graph || loadingRef.current) return;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (!graphRef.current || loadingRef.current) return;
      const projected = graphDocument(graphRef.current, baseDocumentRef.current);
      const comparable = (document: SchematicDocument) => JSON.stringify({
        nodes: document.nodes,
        edges: document.edges,
        explicitJunctions: document.explicitJunctions,
        netLabels: document.netLabels,
        noConnects: document.noConnects,
        notes: document.notes,
      });
      const next = comparable(projected) === comparable(baseDocumentRef.current)
        ? projected
        : withDesignRevision(projected, true);
      baseDocumentRef.current = next;
      onDocumentChangeRef.current?.(next);
    });
  };

  const emitViewport = () => {
    if (viewportRafRef.current !== null) cancelAnimationFrame(viewportRafRef.current);
    viewportRafRef.current = requestAnimationFrame(() => {
      viewportRafRef.current = null;
      const graph = graphRef.current;
      const container = containerRef.current;
      if (!graph || !container) return;
      const rect = container.getBoundingClientRect();
      const origin = graph.localToClient(0, 0);
      onViewportChangeRef.current?.({
        originX: origin.x - rect.left,
        originY: origin.y - rect.top,
        scale: graph.scale().sx,
        width: rect.width,
        height: rect.height,
      });
    });
  };

  const selectedCells = () => selectionRef.current?.getSelectedCells() ?? [];
  const selectedNodes = () => selectedCells().filter((cell): cell is Node => cell.isNode());

  const emitCommandState = () => {
    const draft = activeWireDraftRef.current;
    const wireMode = toolModeRef.current === "wire";
    const noConnectMode = toolModeRef.current === "no-connect";
    onCommandStateChangeRef.current?.({
      command: wireMode ? "create-wire" : noConnectMode ? "add-no-connect" : "select",
      phase: wireMode ? (draft ? "DYNAMIC_PREVIEW" : "COMMAND_ARMED") : noConnectMode ? "COMMAND_ARMED" : "IDLE",
      prompt: noConnectMode
        ? "No Connect：单击器件端子添加或移除不连接标记"
        : wireMode
        ? draft
          ? "Create Wire: 单击空白固定拐点；单击端子/线段完成；Enter 或双击悬空结束"
          : "Create Wire: 选择端子、已有 Wire 或空白网格作为起点"
        : "Select: 单击、Shift 多选或拖动框选对象",
      fixedPointCount: draft?.fixedPoints.length ?? 0,
      snapCandidate: draft?.snapCandidate ?? null,
      partialSelection: partialSelectionRef.current,
    });
  };

  const runGraphBatch = (name: string, operation: () => void) => {
    const graph = graphRef.current;
    if (!graph) return;
    graph.startBatch(name);
    try {
      operation();
    } finally {
      graph.stopBatch(name);
    }
  };

  const selectCell = (cell: Cell | null) => {
    const selection = selectionRef.current;
    if (!selection) return;
    if (cell) selection.reset(cell);
    else selection.clean();
  };

  const cancelWireDraft = useCallback(() => {
    const draft = activeWireDraftRef.current;
    activeWireDraftRef.current = null;
    containerRef.current?.classList.remove("wire-drawing");
    draft?.marker.remove();
    draft?.targetMarker.remove();
    draft?.edge.remove();
    emitCommandState();
  }, []);

  const findSnapCandidate = (point: Point): SnapCandidate => {
    const graph = graphRef.current;
    const gridPoint = {
      x: snapToElectricalGrid(point.x),
      y: snapToElectricalGrid(point.y),
    };
    if (!graph) return { point: gridPoint, kind: "grid" };
    const tolerance = 18 / Math.max(graph.scale().sx, 0.01);
    const toleranceSquared = tolerance * tolerance;
    const ranked: Array<SnapCandidate & { rank: number; distance: number; stableId: string }> = [];

    for (const cell of graph.getNodes()) {
      if (cell.getData<{ wireDraft?: boolean }>()?.wireDraft) continue;
      const node = nodeSnapshot(cell);
      if (node.kind === "netlabel") continue;
      for (const pin of getDeviceDefinition(node.kind).pins) {
        const pinPoint = getPinWorldPosition(node, pin.id);
        if (!pinPoint) continue;
        const distance = squaredDistance(point, pinPoint);
        if (distance > toleranceSquared) continue;
        const junction = node.kind === "junction";
        ranked.push({
          point: pinPoint,
          kind: junction ? "junction" : "pin",
          endpoint: junction ? pinPoint : { nodeId: node.id, portId: pin.id },
          rank: junction ? 2 : 0,
          distance,
          stableId: `${node.id}:${pin.id}`,
        });
      }
    }

    for (const edge of graph.getEdges()) {
      if (edge.getData<{ wireDraft?: boolean }>()?.wireDraft) continue;
      const points = [edge.getSourcePoint(), ...edge.getVertices(), edge.getTargetPoint()]
        .map((candidate) => ({ x: candidate.x, y: candidate.y }));
      for (const [index, endpoint] of [points[0], points[points.length - 1]].entries()) {
        if (!endpoint) continue;
        const distance = squaredDistance(point, endpoint);
        if (distance > toleranceSquared) continue;
        ranked.push({
          point: endpoint,
          kind: "wire-endpoint",
          endpoint,
          edge,
          rank: 1,
          distance,
          stableId: `${edge.id}:endpoint:${index}`,
        });
      }
      for (let index = 0; index < points.length - 1; index += 1) {
        // The snap candidate must itself be a persisted DBU/grid coordinate.
        // Measuring against the raw pointer but projecting the snapped point
        // prevents a visually selected segment from producing fractional data.
        const closest = closestPointOnOrthogonalSegment(gridPoint, points[index], points[index + 1]);
        if (!closest) continue;
        const distance = squaredDistance(point, closest);
        if (distance > toleranceSquared) continue;
        ranked.push({
          point: closest,
          kind: "wire-segment",
          endpoint: closest,
          edge,
          rank: 3,
          distance,
          stableId: `${edge.id}:segment:${index}`,
        });
      }
    }

    ranked.push({
      point: gridPoint,
      kind: "grid",
      endpoint: gridPoint,
      rank: 5,
      distance: squaredDistance(point, gridPoint),
      stableId: `${gridPoint.x},${gridPoint.y}`,
    });
    ranked.sort((left, right) => left.rank - right.rank
      || left.distance - right.distance
      || left.stableId.localeCompare(right.stableId, "en", { numeric: true }));
    const { rank: _rank, distance: _distance, stableId: _stableId, ...candidate } = ranked[0];
    void _rank;
    void _distance;
    void _stableId;
    return candidate;
  };

  const insertWireVertex = (edge: Edge, point: Point) => {
    const points = [edge.getSourcePoint(), ...edge.getVertices(), edge.getTargetPoint()]
      .map((candidate) => ({ x: candidate.x, y: candidate.y }));
    if (points.some((candidate) => candidate.x === point.x && candidate.y === point.y)) return;
    for (let index = 0; index < points.length - 1; index += 1) {
      if (!isPointOnSegment(point, points[index], points[index + 1], false)) continue;
      const vertices = edge.getVertices().map((candidate) => ({ x: candidate.x, y: candidate.y }));
      vertices.splice(index, 0, point);
      edge.setVertices(vertices);
      return;
    }
  };

  const wireDegreeAt = (point: Point): number => {
    const graph = graphRef.current;
    if (!graph) return 0;
    let degree = 0;
    for (const edge of graph.getEdges()) {
      if (edge.getData<{ wireDraft?: boolean }>()?.wireDraft) continue;
      const points = [edge.getSourcePoint(), ...edge.getVertices(), edge.getTargetPoint()]
        .map((candidate) => ({ x: candidate.x, y: candidate.y }));
      for (let index = 0; index < points.length - 1; index += 1) {
        const start = points[index];
        const end = points[index + 1];
        if (!isPointOnSegment(point, start, end)) continue;
        const atStart = start.x === point.x && start.y === point.y;
        const atEnd = end.x === point.x && end.y === point.y;
        degree += atStart || atEnd ? 1 : 2;
      }
    }
    return degree;
  };

  const ensureExplicitJunctionAt = (point: Point) => {
    const graph = graphRef.current;
    if (!graph) return;
    const snappedPoint = {
      x: snapToElectricalGrid(point.x),
      y: snapToElectricalGrid(point.y),
    };
    const existing = graph.getNodes().some((node) => {
      if (node.getData<{ wireDraft?: boolean }>()?.wireDraft) return false;
      const snapshot = nodeSnapshot(node);
      if (snapshot.kind !== "junction") return false;
      const position = getPinWorldPosition(snapshot, "P");
      return position?.x === snappedPoint.x && position.y === snappedPoint.y;
    });

    // A formal junction protects the topology point. Materialise that point in
    // every touched WireFigure so the rendered and persisted point lists agree.
    for (const edge of graph.getEdges()) {
      if (!edge.getData<{ wireDraft?: boolean }>()?.wireDraft) insertWireVertex(edge, snappedPoint);
    }
    if (existing) return;

    const canvasNodes = graph.getNodes()
      .filter((node) => !node.getData<{ wireDraft?: boolean }>()?.wireDraft)
      .map(nodeSnapshot);
    const seed = createDeviceNode(
      "junction",
      snappedPoint.x - 10,
      snappedPoint.y - 10,
      canvasNodes,
    );
    graph.addNode(createX6NodeMetadata({
      ...seed,
      properties: { objectType: "explicit-junction" },
    }));
  };

  const materializeConnectionCandidate = (candidate: SnapCandidate) => {
    const degree = wireDegreeAt(candidate.point);
    const needsJunction = candidate.kind === "wire-segment"
      || candidate.kind === "junction"
      || (candidate.kind === "wire-endpoint" && degree >= 2)
      || (candidate.kind === "pin" && degree >= 1);
    if (needsJunction) ensureExplicitJunctionAt(candidate.point);
  };

  const routeFromLastFixedPoint = (draft: ActiveWireDraft, point: Point): Point[] => {
    const lastFixed = draft.fixedPoints[draft.fixedPoints.length - 1];
    const previous = draft.fixedPoints[draft.fixedPoints.length - 2];
    const previousDirection = previous
      ? previous.x === lastFixed.x ? "vertical" as const : "horizontal" as const
      : undefined;
    return routeOrthogonal(lastFixed, point, wireDrawModeRef.current, previousDirection);
  };

  const renderFixedWireDraft = (draft: ActiveWireDraft) => {
    const lastFixed = draft.fixedPoints[draft.fixedPoints.length - 1];
    draft.edge.setTarget(lastFixed);
    draft.edge.setVertices(draft.fixedPoints.slice(1, -1));
    draft.targetMarker.position(lastFixed.x - 5, lastFixed.y - 5);
    draft.targetMarker.attr({ body: { stroke: "#2b579a", fill: "#ffffff" } });
  };

  const updateWireDraft = (point: Point) => {
    const graph = graphRef.current;
    const draft = activeWireDraftRef.current;
    if (!graph || !draft) return;
    const candidate = findSnapCandidate(point);
    const route = routeFromLastFixedPoint(draft, candidate.point);
    const path = normalizePointList([...draft.fixedPoints, ...route.slice(1)]);
    draft.edge.setTarget(candidate.point);
    draft.edge.setVertices(path.slice(1, -1));
    draft.targetMarker.position(candidate.point.x - 5, candidate.point.y - 5);
    draft.targetMarker.attr({
      body: {
        stroke: candidate.kind === "grid" ? "#2b579a" : "#107c10",
        fill: candidate.kind === "grid" ? "#ffffff" : "#e8f5e9",
      },
    });
    draft.cursorPoint = candidate.point;
    draft.snapCandidate = candidate.kind;
    draft.activeCandidate = candidate;
    draft.previewSuppressed = false;
    emitCommandState();
  };

  const suppressWirePreview = (): boolean => {
    const draft = activeWireDraftRef.current;
    if (!draft || draft.previewSuppressed) return false;
    draft.previewSuppressed = true;
    draft.cursorPoint = draft.fixedPoints[draft.fixedPoints.length - 1];
    draft.snapCandidate = null;
    draft.activeCandidate = {
      point: draft.cursorPoint,
      endpoint: draft.cursorPoint,
      kind: "grid",
    };
    renderFixedWireDraft(draft);
    emitCommandState();
    return true;
  };

  const removeLastFixedWireStep = (): boolean => {
    const draft = activeWireDraftRef.current;
    if (!draft || draft.fixedPointHistory.length <= 1) return false;
    draft.fixedPointHistory.pop();
    const previous = draft.fixedPointHistory[draft.fixedPointHistory.length - 1];
    draft.fixedPoints = previous.map((point) => ({ ...point }));
    draft.cursorPoint = draft.fixedPoints[draft.fixedPoints.length - 1];
    draft.snapCandidate = null;
    draft.activeCandidate = {
      point: draft.cursorPoint,
      endpoint: draft.cursorPoint,
      kind: "grid",
    };
    draft.previewSuppressed = true;
    renderFixedWireDraft(draft);
    emitCommandState();
    return true;
  };

  const setWireDrawModeInternal = (mode: WireDrawMode, notify = false) => {
    wireDrawModeRef.current = mode;
    containerRef.current?.setAttribute("data-wire-draw-mode", mode);
    const draft = activeWireDraftRef.current;
    if (draft) {
      if (draft.previewSuppressed) renderFixedWireDraft(draft);
      else updateWireDraft(draft.cursorPoint);
    }
    emitCommandState();
    if (notify) onWireDrawModeChangeRef.current?.(mode);
  };

  const applyToolMode = useCallback((mode: ToolMode, notify = false) => {
    if (mode !== "wire") cancelWireDraft();
    toolModeRef.current = mode;
    const container = containerRef.current;
    const selection = selectionRef.current;
    container?.classList.toggle("wire-mode", mode === "wire");
    container?.classList.toggle("no-connect-mode", mode === "no-connect");
    container?.classList.toggle("select-mode", mode === "select");
    if (selection) {
      if (mode === "select") {
        selection.enable();
        selection.enableRubberband();
        selection.enableSelectionMovable();
      } else {
        selection.clean();
        selection.disableRubberband();
        selection.disableSelectionMovable();
        selection.disable();
      }
    }
    if (mode === "wire") graphRef.current?.getEdges().forEach((edge) => edge.removeTools());
    emitCommandState();
    if (notify) {
      container?.focus({ preventScroll: true });
      onToolModeChangeRef.current?.(mode);
    }
  }, [cancelWireDraft]);

  const refreshNode = (node: Node, next: SchematicNode) => {
    const metadata = createX6NodeMetadata(next);
    node.setData(next);
    node.setSize(next.width, next.height);
    node.position(Number(metadata.x), Number(metadata.y));
    node.attr(getNodeVisualAttrs(next));
    node.rotate(next.rotation, { absolute: true });
    const ports = metadata.ports;
    const portItems = ports && !Array.isArray(ports) ? ports.items ?? [] : [];
    for (const item of portItems) {
      if (item.id) node.setPortProp(String(item.id), "args", item.args ?? {});
    }
  };

  const renderMarkerOverlays = (document: SchematicDocument) => {
    const graph = graphRef.current;
    if (!graph) return;
    graph.getNodes()
      .filter((node) => node.getData<{ markerOverlay?: boolean }>()?.markerOverlay)
      .forEach((node) => node.remove());
    for (const marker of document.markers) {
      const color = marker.severity === "error" ? "#d13438" : "#c77700";
      graph.addNode({
        id: `marker-overlay-${marker.id}`,
        shape: "rect",
        x: marker.boundingBox.x - 5,
        y: marker.boundingBox.y - 5,
        width: Math.max(14, marker.boundingBox.width + 10),
        height: Math.max(14, marker.boundingBox.height + 10),
        zIndex: 30,
        attrs: {
          body: {
            fill: "transparent",
            stroke: color,
            strokeWidth: 1.5,
            strokeDasharray: "5 3",
            pointerEvents: "none",
          },
          label: {
            text: marker.severity === "error" ? "E" : "W",
            fill: color,
            fontSize: 9,
            fontWeight: 700,
            refX: 4,
            refY: 4,
            textAnchor: "start",
            textVerticalAnchor: "top",
            pointerEvents: "none",
          },
        },
        data: { wireDraft: true, markerOverlay: true },
      });
    }
  };

  const renderNoConnectOverlays = (document: SchematicDocument) => {
    const graph = graphRef.current;
    if (!graph) return;
    graph.getNodes()
      .filter((node) => node.getData<{ noConnectOverlay?: boolean }>()?.noConnectOverlay)
      .forEach((node) => node.remove());
    for (const marker of document.noConnects) {
      graph.addNode({
        id: `no-connect-overlay-${marker.id}`,
        shape: "rect",
        x: marker.position.x - 8,
        y: marker.position.y - 8,
        width: 16,
        height: 16,
        zIndex: 25,
        attrs: {
          body: { fill: "transparent", stroke: "transparent", pointerEvents: "none" },
          label: {
            text: "×",
            fill: "#d13438",
            fontFamily: "Segoe UI, Microsoft YaHei UI, sans-serif",
            fontSize: 18,
            fontWeight: 500,
            pointerEvents: "none",
          },
        },
        data: { wireDraft: true, noConnectOverlay: true },
      });
    }
  };

  const loadDocument = (document: SchematicDocument) => {
    const normalizedDocument = normalizeSchematicGeometry(document);
    const graph = graphRef.current;
    if (!graph) {
      baseDocumentRef.current = normalizedDocument;
      return;
    }
    cancelWireDraft();
    loadingRef.current = true;
    baseDocumentRef.current = normalizedDocument;
    selectionRef.current?.clean();
    // X6's renderer listens to model add/remove events. Using `silent: true`
    // mutates the model without ever creating the visible SVG views.
    graph.clearCells();
    for (const node of normalizedDocument.nodes) graph.addNode(createX6NodeMetadata(node));
    for (const junction of normalizedDocument.explicitJunctions) {
      graph.addNode(createX6NodeMetadata(junctionCanvasNode(junction)));
    }
    for (const label of normalizedDocument.netLabels) {
      graph.addNode(createX6NodeMetadata(netLabelCanvasNode(label)));
    }
    for (const edge of normalizedDocument.edges) graph.addEdge(edgeConfig(edge));
    renderMarkerOverlays(normalizedDocument);
    renderNoConnectOverlays(normalizedDocument);
    historyRef.current?.clean();
    loadingRef.current = false;
    onSelectionChangeRef.current?.(null);
    onDocumentChangeRef.current?.(normalizedDocument);
  };

  const toggleNoConnect = (node: SchematicNode, portId: string, position: Point) => {
    const graph = graphRef.current;
    if (!graph) return;
    const current = graphDocument(graph, baseDocumentRef.current);
    const id = `nc_${node.id}_${portId}`;
    const exists = current.noConnects.some((marker) => marker.nodeId === node.id && marker.portId === portId);
    const next = withDesignRevision({
      ...current,
      noConnects: exists
        ? current.noConnects.filter((marker) => !(marker.nodeId === node.id && marker.portId === portId))
        : [...current.noConnects, { id, nodeId: node.id, portId, position }]
          .sort((left, right) => left.id.localeCompare(right.id, "en", { numeric: true })),
    }, true);
    baseDocumentRef.current = next;
    renderNoConnectOverlays(next);
    onDocumentChangeRef.current?.(next);
  };

  const addDevice = (kind: DeviceKind, position?: { x: number; y: number }) => {
    const graph = graphRef.current;
    const container = containerRef.current;
    if (!graph || !container) return;
    if (toolModeRef.current !== "select") applyToolMode("select", true);
    const current = graphDocument(graph, baseDocumentRef.current);
    const canvasNodes = graph.getNodes()
      .filter((node) => !node.getData<{ wireDraft?: boolean }>()?.wireDraft)
      .map(nodeSnapshot);
    let point = position;
    if (!point) {
      const rect = container.getBoundingClientRect();
      const sameKindCount = current.nodes.filter((node) => node.kind === kind).length;
      const column = sameKindCount % 2;
      const row = Math.floor(sameKindCount / 2) % 3;
      point = graph.clientToLocal(
        rect.left + rect.width * (0.69 + column * 0.14),
        rect.top + rect.height * (0.23 + row * 0.2),
      );
    }

    if (kind === "junction") {
      const junctionPoint = {
        x: snapToElectricalGrid(point.x),
        y: snapToElectricalGrid(point.y),
      };
      const seed = createDeviceNode("junction", junctionPoint.x - 10, junctionPoint.y - 10, canvasNodes);
      const nodeData = {
        ...seed,
        properties: { objectType: "explicit-junction" },
      };
      const node = graph.addNode(createX6NodeMetadata(nodeData));
      selectCell(node);
      onSelectionChangeRef.current?.(nodeData);
      emitDocument();
      return;
    }

    if (kind === "netlabel") {
      const selectedEdge = selectedCells().find((cell): cell is Edge => cell.isEdge());
      if (!selectedEdge) return;
      const rawPoints = [selectedEdge.getSourcePoint(), ...selectedEdge.getVertices(), selectedEdge.getTargetPoint()]
        .map((candidate) => ({ x: candidate.x, y: candidate.y }));
      const requested = {
        x: snapToElectricalGrid(point.x),
        y: snapToElectricalGrid(point.y),
      };
      let segmentIndex = 0;
      let anchorPoint = rawPoints[0] ?? requested;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < rawPoints.length - 1; index += 1) {
        const closest = closestPointOnOrthogonalSegment(requested, rawPoints[index], rawPoints[index + 1]);
        if (!closest) continue;
        const distance = (closest.x - requested.x) ** 2 + (closest.y - requested.y) ** 2;
        if (distance >= bestDistance) continue;
        bestDistance = distance;
        segmentIndex = index;
        anchorPoint = closest;
      }
      const seed = createDeviceNode("netlabel", anchorPoint.x, anchorPoint.y - 15, canvasNodes);
      const labelData = {
        ...seed,
        properties: {
          ...seed.properties,
          wireId: selectedEdge.id,
          segmentIndex: String(segmentIndex),
          textAlignment: "start",
          objectType: "net-label",
        },
      };
      const node = graph.addNode(createX6NodeMetadata(labelData));
      selectCell(node);
      onSelectionChangeRef.current?.(labelData);
      emitDocument();
      return;
    }
    const definition = getDeviceDefinition(kind);
    const boxPosition = {
      x: snapToElectricalGrid(point.x - definition.width / 2),
      y: snapToElectricalGrid(point.y - definition.height / 2),
    };
    const seed = createDeviceNode(kind, 0, 0, current.nodes);
    const origin = canvasPositionToDocumentOrigin(seed, boxPosition);
    const nodeData = {
      ...seed,
      x: snapToElectricalGrid(origin.x),
      y: snapToElectricalGrid(origin.y),
    };
    const node = graph.addNode(createX6NodeMetadata(nodeData));
    selectCell(node);
    onSelectionChangeRef.current?.(nodeData);
    emitDocument();
  };

  const rotateSelected = () => {
    runGraphBatch("rotate-origin", () => {
      for (const node of selectedNodes()) {
        const data = nodeSnapshot(node);
        const rotation = normalizeRotation(data.rotation + 90);
        refreshNode(node, { ...data, rotation });
        onSelectionChangeRef.current?.({ ...data, rotation });
      }
    });
    emitDocument();
  };

  const mirrorSelected = () => {
    runGraphBatch("mirror-origin", () => {
      for (const node of selectedNodes()) {
        const data = nodeSnapshot(node);
        const next = { ...data, mirrored: !data.mirrored };
        refreshNode(node, next);
        onSelectionChangeRef.current?.(next);
      }
    });
    emitDocument();
  };

  const deleteSelected = () => {
    const graph = graphRef.current;
    const cells = selectedCells();
    if (!graph || !cells.length) return;
    const selectedIds = new Set(cells.map((cell) => cell.id));
    const selectedWireIds = new Set(cells.filter((cell) => cell.isEdge()).map((cell) => cell.id));
    const attachedLabels = graph.getNodes().filter((node) => {
      const snapshot = nodeSnapshot(node);
      return snapshot.kind === "netlabel" && selectedWireIds.has(snapshot.properties.wireId);
    });

    runGraphBatch("delete-selection", () => {
      // VSE delete semantics preserve the WireFigure when its instance is
      // deleted. Convert each surviving TerminalRef to the exact former pin
      // coordinate before X6 removes the node, preventing cascade deletion.
      for (const cell of cells) {
        if (!cell.isNode()) continue;
        const node = cell as Node;
        const snapshot = nodeSnapshot(node);
        if (snapshot.kind === "junction" || snapshot.kind === "netlabel") continue;
        for (const edge of graph.getConnectedEdges(node)) {
          if (selectedIds.has(edge.id)) continue;
          const source = edge.getSource();
          if ("cell" in source && terminalCellId(source.cell) === node.id && source.port) {
            const point = getPinWorldPosition(snapshot, String(source.port));
            if (point) edge.setSource(point);
          }
          const target = edge.getTarget();
          if ("cell" in target && terminalCellId(target.cell) === node.id && target.port) {
            const point = getPinWorldPosition(snapshot, String(target.port));
            if (point) edge.setTarget(point);
          }
        }
      }
      graph.removeCells([...cells, ...attachedLabels]);

      // A junction with no remaining WireFigure through it is no longer a
      // valid formal object. T-junction connectivity itself remains derived
      // from endpoint-on-segment geometry and therefore does not depend on
      // retaining an orphan marker dot.
      const orphanJunctions = graph.getNodes().filter((node) => {
        const snapshot = nodeSnapshot(node);
        if (snapshot.kind !== "junction") return false;
        const point = getPinWorldPosition(snapshot, "P");
        if (!point) return true;
        return !graph.getEdges().some((edge) => {
          const points = [edge.getSourcePoint(), ...edge.getVertices(), edge.getTargetPoint()]
            .map((candidate) => ({ x: candidate.x, y: candidate.y }));
          return points.slice(0, -1).some((start, index) =>
            isPointOnSegment(point, start, points[index + 1]));
        });
      });
      if (orphanJunctions.length) graph.removeCells(orphanJunctions);
    });
    selectionRef.current?.clean();
    onSelectionChangeRef.current?.(null);
    emitDocument();
  };

  const setGridMode = (mode: GridMode) => {
    const graph = graphRef.current;
    if (!graph) return;
    if (mode === "off") {
      graph.hideGrid();
      return;
    }
    graph.showGrid();
    graph.drawGrid(mode === "dot"
      ? { type: "analog-major-dot", args: { color: "#a8adb3", thickness: 1.55 } }
      : { type: "analog-major-mesh", args: { color: "#d7d7d7", thickness: 1 } });
  };

  const copySelected = () => {
    const graph = graphRef.current;
    const cells = selectedCells();
    if (!graph || !cells.length || !clipboardRef.current) return;
    clipboardRef.current.copy(cells);
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    registerGridShapes();
    registerWireShape();

    const graph: Graph = new Graph({
      container,
      autoResize: true,
      background: { color: "#ffffff" },
      grid: { visible: true, size: ELECTRICAL_GRID_SIZE, type: "analog-major-dot", args: { color: "#a8adb3", thickness: 1.55 } },
      panning: { enabled: true, eventTypes: ["rightMouseDown", "mouseWheel"] },
      mousewheel: { enabled: true, modifiers: ["ctrl", "meta"], minScale: 0.35, maxScale: 2.5, factor: 1.08 },
      // A plain click is reserved for the click-to-click wire tool; leaving
      // the magnet while pressed still preserves the familiar drag gesture.
      magnetThreshold: "onleave",
      interacting: () => {
        const selecting = toolModeRef.current === "select";
        return {
          nodeMovable: selecting,
          // Keep magnet mouse-up events alive while a click-to-click draft is
          // active. validateMagnet still prevents a second drag draft.
          magnetConnectable: !selecting,
          edgeMovable: false,
          arrowheadMovable: false,
          vertexMovable: selecting,
          vertexAddable: selecting,
          vertexDeletable: selecting,
          edgeLabelMovable: false,
          useEdgeTools: selecting,
          toolsAddable: selecting,
        };
      },
      connecting: {
        snap: { radius: 18 },
        allowBlank: true,
        allowLoop: true,
        allowNode: false,
        allowEdge: false,
        allowPort: true,
        highlight: true,
        anchor: "center",
        connectionPoint: "anchor",
        router: { name: "manhattan", args: WIRE_ROUTER_ARGS },
        connector: { name: "normal" },
        createEdge: (): Edge => graph.createEdge({
          shape: "analog-wire",
          data: { wireDraft: true, wireInput: "drag" },
        }),
        validateMagnet: () => toolModeRef.current === "wire" && activeWireDraftRef.current === null,
        validateConnection: ({ sourceMagnet, targetMagnet, sourceCell, targetCell, sourcePort, targetPort }) =>
          toolModeRef.current === "wire"
          && Boolean(sourceMagnet && sourceCell && sourcePort)
          && (
            Boolean(
              targetMagnet
              && targetCell
              && targetPort
              && !(sourceCell?.id === targetCell.id && sourcePort === targetPort)
            )
            || (!targetMagnet && !targetCell)
          ),
      },
      highlighting: {
        magnetAvailable: { name: "stroke", args: { padding: 1, attrs: { stroke: "#2b579a", strokeWidth: 1.2 } } },
        magnetAdsorbed: { name: "stroke", args: { padding: 1, attrs: { stroke: "#107c10", strokeWidth: 1.6 } } },
      },
    });

    const history = new History({
      enabled: true,
      stackSize: 100,
      beforeAddCommand: (_event, args) => {
        const cell = args && "cell" in args ? args.cell as Cell : null;
        return !cell?.getData<{ wireDraft?: boolean }>()?.wireDraft;
      },
    });
    const selection = new Selection({
      enabled: true,
      filter: (cell) => !cell.getData<{ wireDraft?: boolean }>()?.wireDraft,
      multiple: true,
      rubberband: true,
      rubberNode: true,
      rubberEdge: true,
      // Schematic marquee selection follows the CAD convention: a cell is
      // selected only when its complete bounding box is inside the marquee.
      strict: true,
      // Preserve edge selection when the pointer moves a few pixels between
      // mouse-down and mouse-up. Nodes remain governed by selectNodeOnMoved.
      selectCellOnMoved: true,
      selectEdgeOnMoved: true,
      selectNodeOnMoved: false,
      showNodeSelectionBox: true,
      // Edge state is rendered on the actual orthogonal path instead of a
      // large bounding rectangle, matching schematic-editor interaction.
      showEdgeSelectionBox: false,
      multipleSelectionModifiers: ["ctrl", "meta", "shift"],
      movable: true,
    });
    const keyboard = new Keyboard({ enabled: true, global: false });
    const snapline = new Snapline({ enabled: true, sharp: true, tolerance: 8 });
    const clipboard = new Clipboard({ enabled: true });
    graph.use(history);
    graph.use(selection);
    graph.use(keyboard);
    graph.use(snapline);
    graph.use(clipboard);

    graphRef.current = graph;
    historyRef.current = history;
    selectionRef.current = selection;
    clipboardRef.current = clipboard;
    loadDocument(baseDocumentRef.current);
    applyToolMode(toolModeRef.current);

    const updateSelection = (cells: Cell[]) => {
      const node = cells.find((cell): cell is Node => cell.isNode());
      onSelectionChangeRef.current?.(node ? nodeSnapshot(node) : null);
    };
    selection.on("selection:changed", ({ selected }) => updateSelection(selected));

    const beginWireDraft = (source: WireEndpoint, sourceCandidate?: SnapCandidate) => {
      if (toolModeRef.current !== "wire" || activeWireDraftRef.current) return;
      const sourcePoint = endpointWorldPoint(graph, source);
      if (!sourcePoint) return;
      const initialCandidate: SnapCandidate = sourceCandidate ?? {
        point: sourcePoint,
        endpoint: source,
        kind: isEdgeTerminal(source) ? "pin" : "grid",
      };
      const edge = graph.addEdge({
        shape: "analog-wire",
        source: x6Endpoint(source),
        target: sourcePoint,
        data: { wireDraft: true, wireInput: "click" },
        // The normal 16 px hit path would sit directly under the pointer and
        // swallow the blank click that is meant to finish this draft.
        attrs: { wrap: { pointerEvents: "none" } },
      });
      const marker = graph.addNode({
        shape: "circle",
        x: sourcePoint.x - 5,
        y: sourcePoint.y - 5,
        width: 10,
        height: 10,
        zIndex: 1000,
        data: { wireDraft: true, wireStartMarker: true },
        attrs: {
          body: {
            fill: "#ffffff",
            fillOpacity: 0.92,
            stroke: "#2b579a",
            strokeWidth: 1.8,
            pointerEvents: "none",
          },
          label: { text: "", pointerEvents: "none" },
        },
      });
      const targetMarker = graph.addNode({
        shape: "rect",
        x: sourcePoint.x - 5,
        y: sourcePoint.y - 5,
        width: 10,
        height: 10,
        zIndex: 1001,
        data: { wireDraft: true, wireTargetMarker: true },
        attrs: {
          body: {
            fill: "#ffffff",
            fillOpacity: 0.9,
            stroke: "#2b579a",
            strokeWidth: 1.5,
            pointerEvents: "none",
          },
          label: { text: "", pointerEvents: "none" },
        },
      });
      activeWireDraftRef.current = {
        edge,
        marker,
        targetMarker,
        source,
        sourceCandidate: initialCandidate,
        fixedPoints: [sourcePoint],
        fixedPointHistory: [[sourcePoint]],
        cursorPoint: sourcePoint,
        snapCandidate: initialCandidate.kind,
        activeCandidate: initialCandidate,
        previewSuppressed: true,
      };
      container.classList.add("wire-drawing");
      emitCommandState();
    };

    const completeWireDraft = (target: WireEndpoint, targetCandidate?: SnapCandidate) => {
      const draft = activeWireDraftRef.current;
      if (!draft) return;
      const targetPoint = endpointWorldPoint(graph, target);
      if (!targetPoint) {
        cancelWireDraft();
        return;
      }
      const route = routeFromLastFixedPoint(draft, targetPoint);
      const path = normalizePointList([...draft.fixedPoints, ...route.slice(1)]);
      if (path.length < 2) return;
      const finalCandidate = targetCandidate ?? {
        point: targetPoint,
        endpoint: target,
        kind: isEdgeTerminal(target) ? "pin" : "grid",
      } satisfies SnapCandidate;

      const completedEdge = {
        id: draft.edge.id,
        shape: "analog-wire",
        source: x6Endpoint(draft.source),
        target: x6Endpoint(target),
        vertices: path.slice(1, -1),
        data: { wireDraft: false, wireInput: "click" },
        attrs: SELECTABLE_WIRE_ATTRS,
      };
      activeWireDraftRef.current = null;
      container.classList.remove("wire-drawing");
      draft.marker.remove();
      draft.targetMarker.remove();
      draft.edge.remove();
      graph.startBatch("complete-wire");
      try {
        materializeConnectionCandidate(draft.sourceCandidate);
        materializeConnectionCandidate(finalCandidate);
        graph.addEdge(completedEdge);
      } finally {
        graph.stopBatch("complete-wire");
      }
      emitCommandState();
    };

    const fixWirePoint = (candidate: SnapCandidate) => {
      const draft = activeWireDraftRef.current;
      if (!draft) return;
      const route = routeFromLastFixedPoint(draft, candidate.point);
      const fixedPoints = normalizePointList([...draft.fixedPoints, ...route.slice(1)]);
      if (fixedPoints.length === draft.fixedPoints.length
        && fixedPoints.every((candidate, index) => candidate.x === draft.fixedPoints[index].x
          && candidate.y === draft.fixedPoints[index].y)) return;
      draft.fixedPoints = fixedPoints;
      draft.fixedPointHistory.push(fixedPoints.map((point) => ({ ...point })));
      draft.cursorPoint = candidate.point;
      draft.snapCandidate = candidate.kind;
      draft.activeCandidate = candidate;
      draft.previewSuppressed = true;
      renderFixedWireDraft(draft);
      emitCommandState();
    };

    const endpointForCandidate = (candidate: SnapCandidate): WireEndpoint =>
      candidate.endpoint ?? candidate.point;

    const handleWireCandidate = (candidate: SnapCandidate) => {
      const endpoint = endpointForCandidate(candidate);
      if (!activeWireDraftRef.current) {
        beginWireDraft(endpoint, candidate);
        return;
      }
      if (candidate.kind === "grid") fixWirePoint(candidate);
      else completeWireDraft(endpoint, candidate);
    };

    const finishWireAtCurrentPoint = () => {
      const draft = activeWireDraftRef.current;
      if (!draft) return;
      completeWireDraft(endpointForCandidate(draft.activeCandidate), draft.activeCandidate);
    };

    graph.on("node:magnet:click", ({ node, magnet }) => {
      const port = magnet.getAttribute("port");
      if (!port || (toolModeRef.current !== "wire" && toolModeRef.current !== "no-connect")) return;
      const snapshot = nodeSnapshot(node);
      if (snapshot.kind === "netlabel") return;
      const point = getPinWorldPosition(snapshot, port);
      if (!point) return;
      if (toolModeRef.current === "no-connect") {
        if (!getDeviceDefinition(snapshot.kind).netlistable) return;
        toggleNoConnect(snapshot, port, point);
        return;
      }
      const junction = snapshot.kind === "junction";
      const candidate: SnapCandidate = {
        point,
        kind: junction ? "junction" : "pin",
        endpoint: junction ? point : { nodeId: node.id, portId: port },
      };
      handleWireCandidate(candidate);
    });

    graph.on("node:dblclick", ({ node }) => {
      if (toolModeRef.current !== "select") return;
      selectCell(node);
      const snapshot = nodeSnapshot(node);
      onSelectionChangeRef.current?.(snapshot);
      onNodeDoubleClickRef.current?.(snapshot);
    });
    graph.on("edge:click", ({ edge, e, x, y }) => {
      if (edge.getData<{ wireDraft?: boolean }>()?.wireDraft) return;
      if (toolModeRef.current === "wire") {
        const pointer = typeof x === "number" && typeof y === "number"
          ? { x, y }
          : graph.clientToLocal(e.clientX, e.clientY);
        handleWireCandidate(findSnapCandidate(pointer));
        return;
      }
      selectCell(edge);
      graph.getEdges().forEach((candidate) => candidate.removeTools());
      edge.addTools([
        { name: "vertices", args: { snapRadius: ELECTRICAL_GRID_SIZE } },
        { name: "segments", args: { snapRadius: ELECTRICAL_GRID_SIZE } },
        { name: "button-remove", args: { distance: 0.5 } },
      ]);
    });
    const clearDynamicNetHighlight = () => {
      for (const candidate of graph.getEdges()) {
        const view = graph.findViewByCell(candidate);
        view?.container.classList.remove("x6-edge-net-highlight", "net-highlight-current", "net-highlight-stale");
      }
    };
    graph.on("edge:mouseenter", ({ edge }) => {
      if (edge.getData<{ wireDraft?: boolean }>()?.wireDraft) return;
      clearDynamicNetHighlight();
      const currentDocument = graphDocument(graph, baseDocumentRef.current);
      const connectivity = extractConnectivity(currentDocument);
      const logicalNet = connectivity.wireToNet.get(edge.id);
      const stale = currentDocument.revisions.connectivityRevision !== currentDocument.revisions.designRevision;
      for (const candidate of graph.getEdges()) {
        if (candidate.getData<{ wireDraft?: boolean }>()?.wireDraft) continue;
        if (logicalNet && connectivity.wireToNet.get(candidate.id) !== logicalNet) continue;
        if (!logicalNet && candidate.id !== edge.id) continue;
        const view = graph.findViewByCell(candidate);
        view?.container.classList.add("x6-edge-net-highlight", stale ? "net-highlight-stale" : "net-highlight-current");
      }
    });
    graph.on("edge:mouseleave", clearDynamicNetHighlight);
    graph.on("blank:click", ({ x, y }) => {
      if (toolModeRef.current === "wire") {
        handleWireCandidate(findSnapCandidate({ x, y }));
        return;
      }
      selectCell(null);
      graph.getEdges().forEach((edge) => edge.removeTools());
    });
    graph.on("blank:dblclick", ({ x, y }) => {
      if (toolModeRef.current !== "wire" || !activeWireDraftRef.current) return;
      const candidate = findSnapCandidate({ x, y });
      completeWireDraft(endpointForCandidate(candidate), candidate);
    });
    graph.on("node:moved", ({ node }) => {
      if (selection.isSelected(node)) onSelectionChangeRef.current?.(nodeSnapshot(node));
    });
    const emitPersistedCellChange = ({ cell }: { cell: Cell }) => {
      if (!cell.getData<{ wireDraft?: boolean }>()?.wireDraft) emitDocument();
    };
    graph.on("cell:added", emitPersistedCellChange);
    graph.on("cell:removed", emitPersistedCellChange);
    graph.on("cell:changed", emitPersistedCellChange);
    graph.on("edge:connected", ({ edge }) => {
      const data = edge.getData<{ wireDraft?: boolean }>() ?? {};
      if (!data.wireDraft) return;
      const target = edge.getTarget();
      if (!("cell" in target) && "x" in target && "y" in target) {
        const snappedTarget = {
          x: snapToElectricalGrid(Number(target.x)),
          y: snapToElectricalGrid(Number(target.y)),
        };
        const sourcePoint = edge.getSourcePoint();
        if (
          Math.abs(sourcePoint.x - snappedTarget.x) < ELECTRICAL_GRID_SIZE
          && Math.abs(sourcePoint.y - snappedTarget.y) < ELECTRICAL_GRID_SIZE
        ) {
          edge.remove();
          return;
        }
        edge.setTarget(snappedTarget);
      }
      const sourcePoint = edge.getSourcePoint();
      const targetPoint = edge.getTargetPoint();
      const route = routeOrthogonal(sourcePoint, targetPoint, wireDrawModeRef.current);
      const completedEdge = {
        id: edge.id,
        shape: "analog-wire",
        source: edge.getSource(),
        target: edge.getTarget(),
        vertices: route.slice(1, -1),
        data: { wireDraft: false },
        attrs: SELECTABLE_WIRE_ATTRS,
      };
      // Draft mutations stay outside History. Replacing the draft with one
      // persisted edge makes a completed wire exactly one undoable command.
      edge.remove();
      graph.addEdge(completedEdge);
    });
    graph.on("scale", emitViewport);
    graph.on("translate", emitViewport);
    graph.on("resize", emitViewport);

    keyboard.bindKey(["ctrl+z", "meta+z"], (event) => { event.preventDefault(); history.undo(); emitDocument(); });
    keyboard.bindKey(["ctrl+y", "meta+shift+z", "ctrl+shift+z"], (event) => { event.preventDefault(); history.redo(); emitDocument(); });
    keyboard.bindKey("delete", (event) => { event.preventDefault(); deleteSelected(); });
    keyboard.bindKey("backspace", (event) => {
      event.preventDefault();
      if (activeWireDraftRef.current) {
        removeLastFixedWireStep();
        return;
      }
      deleteSelected();
    });
    keyboard.bindKey("enter", (event) => {
      if (toolModeRef.current !== "wire" || !activeWireDraftRef.current) return;
      event.preventDefault();
      finishWireAtCurrentPoint();
    });
    keyboard.bindKey("f3", (event) => {
      event.preventDefault();
      const requestOptions = onCommandOptionsRequestRef.current;
      if (requestOptions) {
        requestOptions();
        return;
      }
      const modes: WireDrawMode[] = ["route", "horizontal-first", "vertical-first"];
      const index = modes.indexOf(wireDrawModeRef.current);
      setWireDrawModeInternal(modes[(index + 1) % modes.length], true);
    });
    keyboard.bindKey("f4", (event) => {
      event.preventDefault();
      partialSelectionRef.current = !partialSelectionRef.current;
      if (partialSelectionRef.current) selection.disableStrictRubberband();
      else selection.enableStrictRubberband();
      container.classList.toggle("partial-selection", partialSelectionRef.current);
      emitCommandState();
    });
    keyboard.bindKey("q", (event) => {
      if (toolModeRef.current !== "select") return;
      const node = selectedNodes()[0];
      if (!node) return;
      event.preventDefault();
      const snapshot = nodeSnapshot(node);
      onSelectionChangeRef.current?.(snapshot);
      onNodeDoubleClickRef.current?.(snapshot);
    });
    keyboard.bindKey("r", (event) => { event.preventDefault(); rotateSelected(); });
    keyboard.bindKey("x", (event) => { event.preventDefault(); mirrorSelected(); });
    keyboard.bindKey("w", (event) => { event.preventDefault(); applyToolMode("wire", true); });
    keyboard.bindKey("n", (event) => { event.preventDefault(); applyToolMode("no-connect", true); });
    keyboard.bindKey("esc", (event) => {
      event.preventDefault();
      if (activeWireDraftRef.current) {
        if (suppressWirePreview()) return;
        if (removeLastFixedWireStep()) return;
        cancelWireDraft();
        return;
      }
      const dragDrafts = graph.getEdges()
        .filter((edge) => edge.getData<{ wireDraft?: boolean }>()?.wireDraft);
      if (dragDrafts.length) {
        dragDrafts.forEach((edge) => edge.remove());
        return;
      }
      applyToolMode("select", true);
      graph.getEdges().forEach((edge) => edge.removeTools());
      selectCell(null);
    });
    keyboard.bindKey(["ctrl+c", "meta+c"], (event) => { event.preventDefault(); copySelected(); });
    keyboard.bindKey(["ctrl+v", "meta+v"], (event) => {
      if (toolModeRef.current !== "select") return;
      event.preventDefault();
      let pasted: Cell[] = [];
      runGraphBatch("paste-selection", () => {
        pasted = clipboard.paste({ offset: 20 }, graph);
        const pastedIds = new Set(pasted.map((cell) => cell.id));
        const namingContext = graph.getNodes()
          .filter((node) => !pastedIds.has(node.id))
          .map(nodeSnapshot);
        const pastedNodes = pasted
          .filter((cell): cell is Node => cell.isNode())
          .sort((left, right) => left.id.localeCompare(right.id, "en", { numeric: true }));
        for (const node of pastedNodes) {
          const snapshot = nodeSnapshot(node);
          if (snapshot.kind === "junction" || snapshot.kind === "netlabel") continue;
          const namingSeed = createDeviceNode(snapshot.kind, snapshot.x, snapshot.y, namingContext);
          const isTopLevelPin = snapshot.kind === "input" || snapshot.kind === "output" || snapshot.kind === "bidir";
          const next: SchematicNode = {
            ...snapshot,
            instanceName: namingSeed.instanceName,
            properties: isTopLevelPin
              ? { ...snapshot.properties, netName: namingSeed.instanceName }
              : snapshot.properties,
          };
          refreshNode(node, next);
          namingContext.push(next);
        }
      });
      selection.reset(pasted);
      emitDocument();
    });

    const initialFit = window.setTimeout(() => {
      graph.zoomToFit({ padding: 56, maxScale: 1.05 });
      emitViewport();
    }, 60);
    return () => {
      window.clearTimeout(initialFit);
      cancelWireDraft();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (viewportRafRef.current !== null) cancelAnimationFrame(viewportRafRef.current);
      graph.dispose();
      graphRef.current = null;
      historyRef.current = null;
      selectionRef.current = null;
      clipboardRef.current = null;
    };
    // X6 owns this imperative graph for the lifetime of the mounted container.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    applyToolMode(toolMode);
  }, [applyToolMode, toolMode]);

  useEffect(() => {
    setWireDrawModeInternal(wireDrawMode);
    // The imperative X6 graph is intentionally projected from this prop only
    // when the controlled value changes, not on every document re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wireDrawMode]);

  useImperativeHandle(ref, () => ({
    addDevice,
    addDeviceAtClient: (kind, clientX, clientY) => {
      const graph = graphRef.current;
      const container = containerRef.current;
      if (!graph || !container) return;
      const rect = container.getBoundingClientRect();
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return;
      addDevice(kind, graph.clientToLocal(clientX, clientY));
    },
    rotateSelected,
    mirrorSelected,
    deleteSelected,
    copySelected,
    undo: () => { historyRef.current?.undo(); emitDocument(); },
    redo: () => { historyRef.current?.redo(); emitDocument(); },
    zoomIn: () => graphRef.current?.zoom(0.12),
    zoomOut: () => graphRef.current?.zoom(-0.12),
    fit: () => {
      graphRef.current?.zoomToFit({ padding: 56, maxScale: 1.1 });
      emitViewport();
    },
    setGridMode,
    setToolMode: (mode) => applyToolMode(mode, true),
    setWireDrawMode: (mode) => setWireDrawModeInternal(mode, true),
    clear: () => loadDocument(createEmptyDocument(baseDocumentRef.current.project, "untitled")),
    loadDocument,
    setDocumentMetadata: (document) => {
      baseDocumentRef.current = document;
      renderMarkerOverlays(document);
      renderNoConnectOverlays(document);
      onDocumentChangeRef.current?.(document);
    },
    focusMarker: (markerId) => {
      const graph = graphRef.current;
      const marker = baseDocumentRef.current.markers.find((candidate) => candidate.id === markerId);
      if (!graph || !marker) return;
      graph.centerPoint(
        marker.boundingBox.x + marker.boundingBox.width / 2,
        marker.boundingBox.y + marker.boundingBox.height / 2,
      );
      emitViewport();
    },
    getDocument: () => graphRef.current ? graphDocument(graphRef.current, baseDocumentRef.current) : baseDocumentRef.current,
    updateSelectedProperties: (patch) => {
      const nodes = selectedNodes();
      runGraphBatch("update-properties", () => {
        for (const node of nodes) {
          const data = nodeSnapshot(node);
          const { instanceName, ...propertyPatch } = patch;
          const next: SchematicNode = {
            ...data,
            instanceName: instanceName ?? data.instanceName,
            properties: { ...data.properties, ...propertyPatch },
          };
          refreshNode(node, next);
          onSelectionChangeRef.current?.(next);
        }
      });
      emitDocument();
    },
  }));

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const kind = event.dataTransfer.getData("application/x-analog-device") as DeviceKind;
    if (!kind) return;
    const graph = graphRef.current;
    if (!graph) return;
    const point = graph.clientToLocal(event.clientX, event.clientY);
    addDevice(kind, point);
  };

  return (
    <div
      ref={containerRef}
      className="schematic-canvas"
      data-testid="schematic-canvas"
      tabIndex={0}
      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }}
      onDrop={handleDrop}
      onMouseDown={() => containerRef.current?.focus({ preventScroll: true })}
      onPointerMoveCapture={(event) => {
        const graph = graphRef.current;
        if (!graph) return;
        const point = graph.clientToLocal(event.clientX, event.clientY);
        const snappedPoint = {
          x: snapToElectricalGrid(point.x),
          y: snapToElectricalGrid(point.y),
        };
        updateWireDraft(snappedPoint);
        onCursorPositionChangeRef.current?.(snappedPoint);
      }}
      onMouseLeave={() => onCursorPositionChangeRef.current?.(null)}
    />
  );
});
