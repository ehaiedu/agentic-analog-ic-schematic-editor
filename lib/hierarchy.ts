import {
  createDeviceNode,
  createEmptyDocument,
  snapToElectricalGrid,
  withDesignRevision,
  type DeviceKind,
  type Point,
  type SchematicDocument,
  type SchematicNode,
} from "./schematic";
import {
  createSubcircuitTemplateCellView,
  getSubcircuitTemplate,
  type SubcircuitTemplateKind,
} from "./subcircuitTemplates";

export type { SubcircuitTemplateKind } from "./subcircuitTemplates";

export interface HierarchyFrame {
  key: string;
  cell: string;
  instanceId?: string;
}

export interface HierarchicalTemplateInstanceResult {
  document: SchematicDocument;
  instance: SchematicNode;
  child: SchematicDocument;
  childKey: string;
}

const CELLVIEWS_EXTENSION_KEY = "hierarchicalCellViews";
const PIN_IDS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"] as const;

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en", { numeric: true, sensitivity: "base" });
}

function cleanIdentifier(value: string, fallback: string): string {
  const replaced = value.trim().replace(/[^A-Za-z0-9_]/g, "_");
  const candidate = /^[A-Za-z_]/.test(replaced) ? replaced : `_${replaced}`;
  return candidate || fallback;
}

export function rootCellKey(document: SchematicDocument): string {
  return document.id || `cellview:${document.project}:${document.cell}:schematic`;
}

export function hierarchyCellViews(document: SchematicDocument): Record<string, SchematicDocument> {
  const value = document.extensions?.[CELLVIEWS_EXTENSION_KEY];
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, SchematicDocument>;
}

export function hierarchyCellView(document: SchematicDocument, key: string): SchematicDocument | null {
  return hierarchyCellViews(document)[key] ?? null;
}

export function resolveHierarchyCellView(
  root: SchematicDocument,
  visible: SchematicDocument,
  key: string,
): SchematicDocument | null {
  return hierarchyCellView(visible, key) ?? hierarchyCellView(root, key);
}

export function withHierarchyCellView(
  root: SchematicDocument,
  child: SchematicDocument,
  bumpRevision = true,
): SchematicDocument {
  const childCellViews = hierarchyCellViews(child);
  const next = {
    ...root,
    extensions: {
      ...root.extensions,
      [CELLVIEWS_EXTENSION_KEY]: {
        ...hierarchyCellViews(root),
        ...childCellViews,
        [rootCellKey(child)]: child,
      },
    },
  };
  return bumpRevision ? withDesignRevision(next, true) : next;
}

function nextChildCellName(root: SchematicDocument, base: string): string {
  const used = new Set([
    root.cell.toLowerCase(),
    ...Object.values(hierarchyCellViews(root)).map((document) => document.cell.toLowerCase()),
  ]);
  let index = 1;
  const clean = cleanIdentifier(base, "child_cell").toLowerCase();
  while (used.has(`${clean}_${index}`)) index += 1;
  return `${clean}_${index}`;
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

function childPortNames(child: SchematicDocument): string[] {
  return child.nodes
    .filter((node) => node.kind === "input" || node.kind === "output" || node.kind === "bidir")
    .sort((left, right) => compareText(left.id, right.id))
    .map((node) => node.properties.netName || node.instanceName)
    .filter(Boolean);
}

function nextTemplateInstanceIndex(root: SchematicDocument, stem: string): number {
  const used = new Set(root.nodes.map((node) => node.instanceName.toUpperCase()));
  let index = 1;
  while (used.has(`${stem}${index}`.toUpperCase())) index += 1;
  return index;
}

export function placeHierarchicalTemplateInstance(
  root: SchematicDocument,
  kind: SubcircuitTemplateKind,
  anchor: Point,
): HierarchicalTemplateInstanceResult {
  const definition = getSubcircuitTemplate(kind);
  const instanceIndex = nextTemplateInstanceIndex(root, definition.instanceStem);
  const childCell = nextChildCellName(root, kind.replace(/_cmos$/, ""));
  const child = createSubcircuitTemplateCellView(
    {
      ...createEmptyDocument(root.project, childCell),
      library: root.library,
    },
    kind,
  );
  const childKey = rootCellKey(child);
  const portNames = childPortNames(child);
  const instanceKind = chooseSubcktKind(portNames.length);
  const instanceSeed = createDeviceNode(
    instanceKind,
    snapToElectricalGrid(anchor.x),
    snapToElectricalGrid(anchor.y),
    root.nodes,
  );
  const portProperties = Object.fromEntries(PIN_IDS.map((pin, index) => [`port_${pin}`, portNames[index] ?? ""]));
  const instance: SchematicNode = {
    ...instanceSeed,
    instanceName: `${definition.instanceStem}${instanceIndex}`,
    properties: {
      ...instanceSeed.properties,
      master: child.cell,
      hierarchyChildKey: childKey,
      hierarchyCell: child.cell,
      hierarchyLibrary: child.library,
      hierarchyView: child.view,
      hierarchyEditable: "true",
      templateKind: kind,
      templateLabel: definition.label,
      templateInstance: `${definition.instanceStem}${instanceIndex}`,
      portOrder: portNames.join(","),
      ...portProperties,
    },
  };
  const withInstance = withDesignRevision({
    ...root,
    nodes: [...root.nodes, instance].sort((left, right) => compareText(left.id, right.id)),
  }, true);
  const document = withHierarchyCellView(withInstance, child, false);
  return { document, instance, child, childKey };
}
