import assert from "node:assert/strict";
import test from "node:test";

import {
  createDeviceNode,
  createEmptyDocument,
  type DeviceKind,
  type NodePropertyPatch,
  type SchematicDocument,
  type SchematicNode,
} from "../lib/schematic";
import {
  hierarchyCellView,
  placeHierarchicalTemplateInstance,
  rootCellKey,
  withHierarchyCellView,
} from "../lib/hierarchy";
import {
  buildHierarchicalSchematicExchange,
  parseHierarchicalSchematicExchange,
} from "../lib/hierarchicalExchange";
import { parseSchematicDocument } from "../lib/schematicValidation";

function addNode(
  nodes: SchematicNode[],
  kind: DeviceKind,
  x: number,
  y: number,
  patch: NodePropertyPatch = {},
): SchematicNode {
  const seed = createDeviceNode(kind, x, y, nodes);
  const node = {
    ...seed,
    ...patch,
    properties: {
      ...seed.properties,
      ...patch.properties,
    },
  };
  nodes.push(node);
  return node;
}

function hasEmbeddedCellviews(document: SchematicDocument): boolean {
  return Boolean(document.extensions?.hierarchicalCellViews);
}

test("manual subcircuit seeds create editable hierarchical cellviews instead of flattening into the top cell", () => {
  const result = placeHierarchicalTemplateInstance(
    createEmptyDocument("adc_project", "sar_top"),
    "cdac_bit_slice_cmos",
    { x: 360, y: 260 },
  );
  const top = parseSchematicDocument(result.document);
  const instance = top.nodes[0];
  const child = hierarchyCellView(top, result.childKey);

  assert.equal(top.nodes.length, 1);
  assert.equal(top.nodes.some((node) => node.kind === "nmos4" || node.kind === "pmos4"), false);
  assert.ok(instance.properties.hierarchyChildKey);
  assert.equal(instance.properties.master, result.child.cell);
  assert.equal(instance.properties.templateKind, "cdac_bit_slice_cmos");
  assert.ok(child);
  assert.ok(child.nodes.some((node) => node.kind === "nmos4"));
  assert.ok(child.nodes.some((node) => node.kind === "pmos4"));
  assert.doesNotMatch(instance.properties.portOrder, /XCDAC\d+_/);
});

test("hierarchical exchange imports code-generated CDAC cellviews without template-specific frontend logic", () => {
  const childNodes: SchematicNode[] = [];
  addNode(childNodes, "bidir", 90, 140, {
    instanceName: "TOP",
    properties: { netName: "TOP" },
  });
  addNode(childNodes, "bidir", 90, 280, {
    instanceName: "BOT",
    properties: { netName: "BOT" },
  });
  addNode(childNodes, "input", 90, 420, {
    instanceName: "CTRL0",
    properties: { netName: "CTRL0" },
  });
  addNode(childNodes, "capacitor", 350, 180, {
    instanceName: "CU0",
    properties: { value: "1.0f" },
  });
  addNode(childNodes, "nmos4", 560, 240, {
    instanceName: "MSW0",
    properties: { model: "nch_18", W: "420n", L: "180n", M: "2", NF: "1" },
  });
  const cdacChild = {
    ...createEmptyDocument("adc_project", "cdac_binary_split_from_code"),
    nodes: childNodes,
    properties: { generatedBy: "cadence_schematic_convertor", topology: "binary_split_cdac" },
  };
  const childKey = rootCellKey(cdacChild);
  const topInstanceSeed = createDeviceNode("subckt12", 360, 260);
  const topInstance: SchematicNode = {
    ...topInstanceSeed,
    instanceName: "XCDAC_CODE",
    properties: {
      ...topInstanceSeed.properties,
      master: cdacChild.cell,
      hierarchyChildKey: childKey,
      hierarchyCell: cdacChild.cell,
      hierarchyLibrary: cdacChild.library,
      hierarchyView: cdacChild.view,
      hierarchyEditable: "true",
      portOrder: "TOP,BOT,CTRL0,VREFP,VREFN,VCM",
      port_A: "TOP",
      port_B: "BOT",
      port_C: "CTRL0",
      port_D: "VREFP",
      port_E: "VREFN",
      port_F: "VCM",
    },
  };
  const exchange = {
    schema: "analog_studio.hierarchical_schematic.v1",
    root: {
      ...createEmptyDocument("adc_project", "sar_adc_from_code"),
      nodes: [topInstance],
    },
    cellviews: [cdacChild],
  };

  const imported = parseHierarchicalSchematicExchange(exchange);
  const importedChild = hierarchyCellView(imported, childKey);

  assert.equal(imported.nodes.length, 1);
  assert.equal(imported.nodes[0].properties.templateKind, undefined);
  assert.equal(imported.nodes[0].properties.master, "cdac_binary_split_from_code");
  assert.ok(importedChild);
  assert.equal(importedChild.properties.topology, "binary_split_cdac");
  assert.ok(importedChild.nodes.some((node) => node.kind === "capacitor"));
  assert.ok(importedChild.nodes.some((node) => node.kind === "nmos4"));
});

test("hierarchical export separates root and cellviews for converter round trips", () => {
  const result = placeHierarchicalTemplateInstance(
    createEmptyDocument("adc_project", "round_trip_top"),
    "strongarm_comparator_cmos",
    { x: 420, y: 320 },
  );
  const exchange = buildHierarchicalSchematicExchange(result.document);

  assert.equal(exchange.schema, "analog_studio.hierarchical_schematic.v1");
  assert.equal(exchange.root.cell, "round_trip_top");
  assert.equal(exchange.cellviews.length, 1);
  assert.equal(hasEmbeddedCellviews(exchange.root), false);
  assert.equal(hasEmbeddedCellviews(exchange.cellviews[0]), false);

  const roundTrip = parseHierarchicalSchematicExchange(exchange);
  assert.ok(hierarchyCellView(roundTrip, result.childKey));
});

test("saving a child cellview promotes nested hierarchy to the project-level cellview map", () => {
  const root = createEmptyDocument("adc_project", "top");
  const child = createEmptyDocument("adc_project", "cdac_array");
  const grandchild = createEmptyDocument("adc_project", "unit_cap_switch");
  const promoted = withHierarchyCellView(root, withHierarchyCellView(child, grandchild, false), false);

  assert.equal(hierarchyCellView(promoted, rootCellKey(child))?.cell, "cdac_array");
  assert.equal(hierarchyCellView(promoted, rootCellKey(grandchild))?.cell, "unit_cap_switch");
});
