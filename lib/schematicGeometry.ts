import {
  getPinWorldPosition,
  isEdgeTerminal,
  snapToElectricalGrid,
  type Point,
  type SchematicDocument,
  type SchematicEdge,
  type WireEndpoint,
} from "./schematic";

export interface WireSegment {
  wireId: string;
  segmentIndex: number;
  start: Point;
  end: Point;
}

export type OrthogonalIntersection =
  | { kind: "none" }
  | { kind: "point"; point: Point }
  | { kind: "overlap"; start: Point; end: Point };

export function pointKey(point: Point): string {
  return `${Math.round(point.x)},${Math.round(point.y)}`;
}

export function samePoint(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y;
}

export function snapPoint(point: Point): Point {
  return {
    x: snapToElectricalGrid(point.x),
    y: snapToElectricalGrid(point.y),
  };
}

export function endpointPoint(
  document: Pick<SchematicDocument, "nodes">,
  endpoint: WireEndpoint,
): Point | null {
  if (!isEdgeTerminal(endpoint)) return snapPoint(endpoint);
  const node = document.nodes.find((candidate) => candidate.id === endpoint.nodeId);
  return node ? getPinWorldPosition(node, endpoint.portId) : null;
}

export function wirePathPoints(
  document: Pick<SchematicDocument, "nodes">,
  wire: SchematicEdge,
): Point[] {
  const source = endpointPoint(document, wire.source);
  const target = endpointPoint(document, wire.target);
  if (!source || !target) return [];
  return [source, ...(wire.vertices ?? []).map(snapPoint), target];
}

export function isOrthogonalSegment(start: Point, end: Point): boolean {
  return start.x === end.x || start.y === end.y;
}

export function isPointOnSegment(
  point: Point,
  start: Point,
  end: Point,
  includeEndpoints = true,
): boolean {
  if (!isOrthogonalSegment(start, end)) return false;
  if (start.x === end.x) {
    if (point.x !== start.x) return false;
    const minimum = Math.min(start.y, end.y);
    const maximum = Math.max(start.y, end.y);
    return includeEndpoints
      ? point.y >= minimum && point.y <= maximum
      : point.y > minimum && point.y < maximum;
  }
  if (point.y !== start.y) return false;
  const minimum = Math.min(start.x, end.x);
  const maximum = Math.max(start.x, end.x);
  return includeEndpoints
    ? point.x >= minimum && point.x <= maximum
    : point.x > minimum && point.x < maximum;
}

function sortedRange(first: number, second: number): [number, number] {
  return first <= second ? [first, second] : [second, first];
}

export function orthogonalIntersection(
  firstStart: Point,
  firstEnd: Point,
  secondStart: Point,
  secondEnd: Point,
): OrthogonalIntersection {
  if (!isOrthogonalSegment(firstStart, firstEnd) || !isOrthogonalSegment(secondStart, secondEnd)) {
    return { kind: "none" };
  }

  const firstHorizontal = firstStart.y === firstEnd.y;
  const secondHorizontal = secondStart.y === secondEnd.y;
  if (firstHorizontal !== secondHorizontal) {
    const horizontalStart = firstHorizontal ? firstStart : secondStart;
    const horizontalEnd = firstHorizontal ? firstEnd : secondEnd;
    const verticalStart = firstHorizontal ? secondStart : firstStart;
    const verticalEnd = firstHorizontal ? secondEnd : firstEnd;
    const point = { x: verticalStart.x, y: horizontalStart.y };
    return isPointOnSegment(point, horizontalStart, horizontalEnd)
      && isPointOnSegment(point, verticalStart, verticalEnd)
      ? { kind: "point", point }
      : { kind: "none" };
  }

  if (firstHorizontal) {
    if (firstStart.y !== secondStart.y) return { kind: "none" };
    const [a0, a1] = sortedRange(firstStart.x, firstEnd.x);
    const [b0, b1] = sortedRange(secondStart.x, secondEnd.x);
    const start = Math.max(a0, b0);
    const end = Math.min(a1, b1);
    if (start > end) return { kind: "none" };
    if (start === end) return { kind: "point", point: { x: start, y: firstStart.y } };
    return {
      kind: "overlap",
      start: { x: start, y: firstStart.y },
      end: { x: end, y: firstStart.y },
    };
  }

  if (firstStart.x !== secondStart.x) return { kind: "none" };
  const [a0, a1] = sortedRange(firstStart.y, firstEnd.y);
  const [b0, b1] = sortedRange(secondStart.y, secondEnd.y);
  const start = Math.max(a0, b0);
  const end = Math.min(a1, b1);
  if (start > end) return { kind: "none" };
  if (start === end) return { kind: "point", point: { x: firstStart.x, y: start } };
  return {
    kind: "overlap",
    start: { x: firstStart.x, y: start },
    end: { x: firstStart.x, y: end },
  };
}

export function wireSegments(
  document: Pick<SchematicDocument, "nodes">,
  wire: SchematicEdge,
): WireSegment[] {
  const points = wirePathPoints(document, wire);
  const segments: WireSegment[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (samePoint(start, end)) continue;
    segments.push({ wireId: wire.id, segmentIndex: index, start, end });
  }
  return segments;
}

export function closestPointOnOrthogonalSegment(
  point: Point,
  start: Point,
  end: Point,
): Point | null {
  if (!isOrthogonalSegment(start, end)) return null;
  if (start.x === end.x) {
    const [minimum, maximum] = sortedRange(start.y, end.y);
    return { x: start.x, y: Math.max(minimum, Math.min(maximum, point.y)) };
  }
  const [minimum, maximum] = sortedRange(start.x, end.x);
  return { x: Math.max(minimum, Math.min(maximum, point.x)), y: start.y };
}

export function squaredDistance(left: Point, right: Point): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
}

export function normalizePointList(
  points: readonly Point[],
  protectedPoints: ReadonlySet<string> = new Set(),
): Point[] {
  const snapped: Point[] = [];
  for (const value of points) {
    const point = snapPoint(value);
    if (!snapped.length || !samePoint(snapped[snapped.length - 1], point)) snapped.push(point);
  }
  if (snapped.length < 3) return snapped;

  const normalized: Point[] = [snapped[0]];
  for (let index = 1; index < snapped.length - 1; index += 1) {
    const previous = normalized[normalized.length - 1];
    const current = snapped[index];
    const next = snapped[index + 1];
    const collinear = (previous.x === current.x && current.x === next.x)
      || (previous.y === current.y && current.y === next.y);
    if (collinear && !protectedPoints.has(pointKey(current))) continue;
    normalized.push(current);
  }
  normalized.push(snapped[snapped.length - 1]);
  return normalized;
}

export function normalizeWire(
  document: Pick<SchematicDocument, "nodes">,
  wire: SchematicEdge,
  protectedPoints: ReadonlySet<string> = new Set(),
): SchematicEdge | null {
  const path = normalizePointList(wirePathPoints(document, wire), protectedPoints);
  if (path.length < 2 || path.some((point, index) => index > 0 && !isOrthogonalSegment(path[index - 1], point))) {
    return null;
  }
  const source = isEdgeTerminal(wire.source) ? wire.source : path[0];
  const target = isEdgeTerminal(wire.target) ? wire.target : path[path.length - 1];
  return {
    ...wire,
    source,
    target,
    ...(path.length > 2 ? { vertices: path.slice(1, -1) } : { vertices: undefined }),
  };
}

export function routeOrthogonal(
  start: Point,
  target: Point,
  mode: "route" | "horizontal-first" | "vertical-first" = "route",
  previousDirection?: "horizontal" | "vertical",
): Point[] {
  const source = snapPoint(start);
  const destination = snapPoint(target);
  if (samePoint(source, destination)) return [source];
  if (isOrthogonalSegment(source, destination)) return [source, destination];

  const horizontalFirst = mode === "horizontal-first"
    || (mode === "route" && previousDirection !== "vertical");
  const corner = horizontalFirst
    ? { x: destination.x, y: source.y }
    : { x: source.x, y: destination.y };
  return normalizePointList([source, corner, destination]);
}
