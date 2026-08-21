import type { SchematicDocument } from "./schematic";

function compareId(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id, "en", { numeric: true, sensitivity: "base" });
}

export function canonicalizeDocument(document: SchematicDocument): SchematicDocument {
  return {
    ...structuredClone(document),
    nodes: [...document.nodes].sort(compareId),
    edges: [...document.edges].sort((left, right) =>
      (left.creationOrder ?? Number.MAX_SAFE_INTEGER) - (right.creationOrder ?? Number.MAX_SAFE_INTEGER)
      || compareId(left, right)),
    explicitJunctions: [...document.explicitJunctions].sort(compareId),
    netLabels: [...document.netLabels].sort(compareId),
    noConnects: [...document.noConnects].sort(compareId),
    notes: [...document.notes].sort(compareId),
    markers: [...document.markers].sort((left, right) =>
      left.severity.localeCompare(right.severity)
      || left.ruleId.localeCompare(right.ruleId)
      || compareId(left, right)),
  };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([key, child]) => [key, stableValue(child)]));
}

export function serializeSchematic(document: SchematicDocument, pretty = false): string {
  return JSON.stringify(stableValue(canonicalizeDocument(document)), null, pretty ? 2 : undefined);
}
