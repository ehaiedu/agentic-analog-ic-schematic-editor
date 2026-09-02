import { parseSchematicDocument } from "./schematicValidation";
import { rootCellKey, withHierarchyCellView } from "./hierarchy";
import type { SchematicDocument } from "./schematic";

export interface HierarchicalSchematicExchange {
  schema: "analog_studio.hierarchical_schematic.v1";
  root: SchematicDocument;
  cellviews: SchematicDocument[];
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readCellviews(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function withoutEmbeddedCellviews(document: SchematicDocument): SchematicDocument {
  if (!document.extensions?.hierarchicalCellViews) return document;
  const extensions = { ...document.extensions };
  delete extensions.hierarchicalCellViews;
  return {
    ...document,
    ...(Object.keys(extensions).length ? { extensions } : { extensions: undefined }),
  };
}

export function isHierarchicalSchematicExchange(input: unknown): boolean {
  const root = readRecord(input);
  return root.schema === "analog_studio.hierarchical_schematic.v1"
    || Boolean(root.root && (root.cellviews || root.cells));
}

export function parseHierarchicalSchematicExchange(input: unknown): SchematicDocument {
  const root = readRecord(input);
  const rawRoot = root.root ?? root.top;
  if (!rawRoot) throw new Error("hierarchical exchange missing root document");
  let document = parseSchematicDocument(rawRoot);
  const cellviews = readCellviews(root.cellviews ?? root.cells);
  for (const rawChild of cellviews) {
    const child = parseSchematicDocument(rawChild);
    if (rootCellKey(child) === rootCellKey(document)) continue;
    document = withHierarchyCellView(document, child, false);
  }
  return document;
}

export function buildHierarchicalSchematicExchange(root: SchematicDocument): HierarchicalSchematicExchange {
  const cellviews = Object.values(readRecord(root.extensions?.hierarchicalCellViews))
    .map((value) => withoutEmbeddedCellviews(parseSchematicDocument(value)));
  return {
    schema: "analog_studio.hierarchical_schematic.v1",
    root: withoutEmbeddedCellviews(root),
    cellviews,
  };
}
