import { hierarchyCellViews, rootCellKey } from "./hierarchy";
import { getDeviceDefinition, type SchematicDocument, type SchematicNode } from "./schematic";
import type { NetlistDialect } from "./netlist";

export interface CodePreviewToken {
  text: string;
  kind?: "comment" | "keyword" | "instance" | "parameter" | "number" | "string" | "property" | "punctuation";
}

const KEYWORDS = new Set([
  "simulator",
  "lang",
  "global",
  "subckt",
  "ends",
  ".global",
  ".subckt",
  ".ends",
  ".param",
  ".include",
  "include",
  "parameters",
  "resistor",
  "capacitor",
  "inductor",
  "vsource",
  "isource",
  "vcvs",
  "vccs",
  "switch",
  "procedure",
  "let",
  "setq",
  "unless",
  "error",
  "schcreateinst",
  "dbopencellviewbytype",
  "schcheck",
  "dbsave",
]);

const NETLIST_TOKEN = /\s+|\/\/.*|;.*|\*.*|"(?:\\.|[^"\\])*"|[A-Za-z_.$!][A-Za-z0-9_.$!]*=|[-+]?(?:\d*\.)?\d+(?:[eE][-+]?\d+)?[A-Za-z]*|[A-Za-z_.$!][A-Za-z0-9_.$!]*|[()[\]{},:]|\S/g;
const JSON_TOKEN = /\s+|"(?:\\.|[^"\\])*"|[-+]?(?:\d*\.)?\d+(?:[eE][-+]?\d+)?|true|false|null|[()[\]{},:]|\S/g;

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en", { numeric: true, sensitivity: "base" });
}

function commentPrefix(dialect: NetlistDialect): string {
  if (dialect === "cadence_skill") return ";";
  if (dialect === "spectre") return "//";
  return "*";
}

function property(node: SchematicNode, key: string): string {
  const exact = node.properties[key];
  if (exact !== undefined) return exact;
  const match = Object.entries(node.properties)
    .find(([candidate]) => candidate.toLowerCase() === key.toLowerCase());
  return match?.[1] ?? "";
}

function countByCategory(document: SchematicDocument, category: ReturnType<typeof getDeviceDefinition>["category"]): number {
  return document.nodes.filter((node) => getDeviceDefinition(node.kind).category === category).length;
}

function portNames(document: SchematicDocument): string[] {
  return document.nodes
    .filter((node) => node.kind === "input" || node.kind === "output" || node.kind === "bidir")
    .map((node) => node.properties.netName || node.instanceName)
    .filter(Boolean)
    .sort(compareText);
}

function childSummary(child: SchematicDocument): string {
  const mos = countByCategory(child, "mos");
  const passives = countByCategory(child, "passive");
  const macros = countByCategory(child, "macro");
  const ports = portNames(child);
  const annotations = [
    propertyFromDocument(child, "topology"),
    propertyFromDocument(child, "generatedBy"),
    propertyFromDocument(child, "templateKind"),
    propertyFromDocument(child, "circuitFamily"),
  ].filter(Boolean);
  return `${child.cell}: ${mos} MOS, ${passives} passive, ${macros} macro, ports ${ports.join(",") || "none"}${annotations.length ? `; ${annotations.join("; ")}` : ""}`;
}

function propertyFromDocument(document: SchematicDocument, key: string): string {
  const value = document.properties[key];
  return typeof value === "string" && value.trim() ? `${key}=${value.trim()}` : "";
}

function instancePortOrder(node: SchematicNode): string {
  const portOrder = property(node, "portOrder");
  if (portOrder.trim()) return portOrder;
  return Object.entries(node.properties)
    .filter(([key, value]) => /^port_[A-L]$/i.test(key) && value.trim())
    .sort(([left], [right]) => compareText(left, right))
    .map(([, value]) => value)
    .join(",");
}

function hierarchyNotes(document: SchematicDocument, rootDocument: SchematicDocument): string[] {
  const rootViews = hierarchyCellViews(rootDocument);
  const localViews = hierarchyCellViews(document);
  const cellViews = { ...rootViews, ...localViews };
  const lines = [
    "Analog Studio annotated code preview",
    `Cell: ${document.library || document.project}/${document.cell}/${document.view}`,
  ];
  const hierarchyInstances = document.nodes
    .filter((node) => Boolean(property(node, "hierarchyChildKey") || property(node, "hierarchyCell")))
    .sort((left, right) => compareText(left.instanceName, right.instanceName));

  if (!hierarchyInstances.length) {
    const selfKey = rootCellKey(document);
    const isStoredChild = rootCellKey(rootDocument) !== selfKey && Boolean(cellViews[selfKey]);
    lines.push(isStoredChild
      ? "Subcircuits: current cell is an editable MOS-level child cell"
      : "Subcircuits: flat editable device-level cell");
    return lines;
  }

  lines.push("Subcircuits:");
  for (const node of hierarchyInstances) {
    const childKey = property(node, "hierarchyChildKey");
    const child = childKey ? cellViews[childKey] : undefined;
    const childCell = property(node, "hierarchyCell") || property(node, "master") || child?.cell || "unknown_cell";
    const editable = property(node, "hierarchyEditable") === "true" ? "editable MOS-level" : "symbol boundary";
    const portOrder = instancePortOrder(node);
    lines.push(`  ${node.instanceName} -> ${childCell} (${editable}${portOrder ? `; ports ${portOrder}` : ""})`);
    if (child) lines.push(`    ${childSummary(child)}`);
  }
  return lines;
}

function jsonPreview(text: string, notes: string[]): string {
  try {
    const payload = JSON.parse(text) as Record<string, unknown>;
    return `${JSON.stringify({
      analogStudioPreviewNotes: notes,
      ...payload,
    }, null, 2)}\n`;
  } catch {
    return text;
  }
}

export function buildAnnotatedNetlistPreview(
  document: SchematicDocument,
  rootDocument: SchematicDocument,
  dialect: NetlistDialect,
  compiledText: string,
): string {
  const notes = hierarchyNotes(document, rootDocument);
  if (dialect === "oa_exchange") return jsonPreview(compiledText, notes);
  const prefix = commentPrefix(dialect);
  return `${notes.map((line) => `${prefix} ${line}`).join("\n")}\n${compiledText}`;
}

function classifyJsonToken(token: string, nextToken: string | undefined): CodePreviewToken {
  if (!token.trim()) return { text: token };
  if (/^"(?:\\.|[^"\\])*"$/.test(token)) {
    return { text: token, kind: nextToken === ":" ? "property" : "string" };
  }
  if (/^[-+]?(?:\d*\.)?\d+(?:[eE][-+]?\d+)?$/.test(token) || token === "true" || token === "false" || token === "null") {
    return { text: token, kind: "number" };
  }
  if (/^[()[\]{},:]$/.test(token)) return { text: token, kind: "punctuation" };
  return { text: token };
}

function classifyNetlistToken(token: string, firstCodeToken: boolean): CodePreviewToken {
  if (!token.trim()) return { text: token };
  if (token.startsWith("//") || token.startsWith(";") || token.startsWith("*")) return { text: token, kind: "comment" };
  if (/^"(?:\\.|[^"\\])*"$/.test(token)) return { text: token, kind: "string" };
  const lower = token.toLowerCase();
  if (KEYWORDS.has(lower)) return { text: token, kind: "keyword" };
  if (/^[A-Za-z_.$!][A-Za-z0-9_.$!]*=$/.test(token)) return { text: token, kind: "parameter" };
  if (/^[-+]?(?:\d*\.)?\d+(?:[eE][-+]?\d+)?[A-Za-z]*$/.test(token)) return { text: token, kind: "number" };
  if (/^[()[\]{},:]$/.test(token)) return { text: token, kind: "punctuation" };
  if (firstCodeToken && /^[XMRCLVIDQEG]/i.test(token)) return { text: token, kind: "instance" };
  return { text: token };
}

export function highlightNetlistLine(line: string, dialect: NetlistDialect): CodePreviewToken[] {
  const pattern = dialect === "oa_exchange" ? JSON_TOKEN : NETLIST_TOKEN;
  const rawTokens = line.match(pattern) ?? [line];
  if (dialect === "oa_exchange") {
    return rawTokens.map((token, index) => {
      const next = rawTokens.slice(index + 1).find((candidate) => candidate.trim());
      return classifyJsonToken(token, next);
    });
  }
  let seenCode = false;
  return rawTokens.map((token) => {
    const firstCodeToken = !seenCode && Boolean(token.trim());
    const classified = classifyNetlistToken(token, firstCodeToken);
    if (token.trim() && classified.kind !== "comment") seenCode = true;
    return classified;
  });
}
