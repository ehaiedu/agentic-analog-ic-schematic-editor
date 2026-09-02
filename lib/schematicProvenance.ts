import type { SchematicDocument } from "./schematic";

export type SchematicProvenanceKind =
  | "cadence_backend_routed"
  | "cadence_backend_generated"
  | "demo_seed"
  | "manual_or_imported"
  | "empty";

export interface SchematicProvenance {
  kind: SchematicProvenanceKind;
  label: string;
  message: string;
  canClaimConvertedSchematic: boolean;
  reasons: string[];
}

const BACKEND_GENERATOR_VALUES = new Set([
  "cadence_schematic_convertor",
  "cadence_schematic_convertor_backend",
]);

function normalized(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function property(document: SchematicDocument, key: string): string {
  return normalized(document.properties[key]);
}

function collectReason(reasons: string[], condition: boolean, reason: string) {
  if (condition) reasons.push(reason);
}

function hasBackendSource(document: SchematicDocument): boolean {
  const generatedBy = property(document, "generatedBy");
  const sourceFlow = property(document, "sourceFlow");
  const sourceServer = property(document, "sourceServer");
  const routedBy = property(document, "routedBy");
  return BACKEND_GENERATOR_VALUES.has(generatedBy)
    || BACKEND_GENERATOR_VALUES.has(routedBy)
    || sourceFlow.includes("cadence_schematic_convertor")
    || sourceServer.includes("cadence_schematic_convertor");
}

function hasRoutedBackendSource(document: SchematicDocument): boolean {
  const routedBy = property(document, "routedBy");
  const routingStatus = property(document, "routingStatus");
  return routedBy === "cadence_schematic_convertor_backend"
    || routingStatus === "pass"
    || routingStatus === "routed";
}

export function inspectSchematicProvenance(
  document: SchematicDocument,
  rootDocument: SchematicDocument = document,
): SchematicProvenance {
  const scopedDocuments = rootDocument === document ? [document] : [rootDocument, document];
  const reasons: string[] = [];
  const hasObjects = scopedDocuments.some((candidate) => candidate.nodes.length > 0 || candidate.edges.length > 0);

  for (const candidate of scopedDocuments) {
    collectReason(
      reasons,
      property(candidate, "evidenceLevel") === "demo_seed_not_signoff",
      `${candidate.cell}: evidenceLevel=demo_seed_not_signoff`,
    );
    collectReason(
      reasons,
      property(candidate, "generatedBy") === "analog_studio_seed_project",
      `${candidate.cell}: generatedBy=analog_studio_seed_project`,
    );
    collectReason(
      reasons,
      property(candidate, "sourceFlow") === "editable_template_cellview",
      `${candidate.cell}: sourceFlow=editable_template_cellview`,
    );
  }

  if (reasons.length > 0) {
    return {
      kind: "demo_seed",
      label: "Demo seed",
      message: "当前 cellview 含 seed/template 标记，不能作为工程转换原理图。",
      canClaimConvertedSchematic: false,
      reasons,
    };
  }

  if (scopedDocuments.some(hasRoutedBackendSource)) {
    return {
      kind: "cadence_backend_routed",
      label: "Cadence routed",
      message: "当前 cellview 标记为 Cadence 后端生成并完成布线。",
      canClaimConvertedSchematic: true,
      reasons: ["backend routing provenance present"],
    };
  }

  if (scopedDocuments.some(hasBackendSource)) {
    return {
      kind: "cadence_backend_generated",
      label: "Cadence generated",
      message: "当前 cellview 标记为 Cadence 转换工程生成。",
      canClaimConvertedSchematic: true,
      reasons: ["backend generation provenance present"],
    };
  }

  if (!hasObjects) {
    return {
      kind: "empty",
      label: "Empty schematic",
      message: "当前 cellview 为空，尚无工程转换结果。",
      canClaimConvertedSchematic: false,
      reasons: ["no schematic objects"],
    };
  }

  return {
    kind: "manual_or_imported",
    label: "Manual/imported",
    message: "当前 cellview 未带 Cadence 后端生成标记，不能称为工程转换原理图。",
    canClaimConvertedSchematic: false,
    reasons: ["missing cadence backend provenance"],
  };
}
