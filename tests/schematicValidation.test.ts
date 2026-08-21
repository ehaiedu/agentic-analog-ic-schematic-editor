import assert from "node:assert/strict";
import test from "node:test";

import {
  createDemoDocument,
  createDeviceNode,
  createEmptyDocument,
  documentOriginToCanvasPosition,
} from "../lib/schematic";
import { parseSchematicDocument } from "../lib/schematicValidation";

test("v3 documents round-trip with the VSE-Core-1 envelope", () => {
  const document = createDemoDocument();
  const parsed = parseSchematicDocument(JSON.parse(JSON.stringify(document)));

  assert.deepEqual(parsed, document);
  assert.equal(parsed.version, 3);
  assert.equal(parsed.formatVersion, 1);
  assert.equal(parsed.editorProfile, "VSE-Core-1");
  assert.equal(parsed.units.userUnit, "um");
  assert.equal(parsed.units.dbuPerUserUnit, 1_000);
});

test("v3 validation rejects unsupported versions, duplicate IDs, and broken terminals", () => {
  const document = createDemoDocument();

  assert.throws(() => parseSchematicDocument({ ...document, version: 4 }));
  assert.throws(() => parseSchematicDocument({
    ...document,
    nodes: [...document.nodes, document.nodes[0]],
  }));
  assert.throws(() => parseSchematicDocument({
    ...document,
    edges: [{
      id: "broken-edge",
      source: { nodeId: document.nodes[0].id, portId: "NOT_A_PIN" },
      target: { nodeId: "missing-node", portId: "P" },
      style: "NORMAL",
      width: 1,
      creationOrder: 0,
    }],
  }));
});

test("v1 top-left coordinates migrate to v3 placement origins", () => {
  const nmos = createDeviceNode("nmos4", 200, 220);
  const resistor = createDeviceNode("resistor", 360, 180, [nmos]);
  const legacyNodes = [nmos, resistor].map((node) => {
    const position = documentOriginToCanvasPosition(node);
    return { ...node, x: position.x, y: position.y };
  });
  const legacy = {
    version: 1,
    project: "legacy-project",
    cell: "legacy-cell",
    view: "schematic",
    nodes: legacyNodes,
    edges: [{
      id: "legacy-wire",
      source: { nodeId: nmos.id, portId: "G" },
      target: { nodeId: resistor.id, portId: "P" },
    }],
  };

  const migrated = parseSchematicDocument(legacy);

  assert.equal(migrated.version, 3);
  assert.equal(migrated.formatVersion, 1);
  assert.deepEqual(
    migrated.nodes.map((node) => documentOriginToCanvasPosition(node)),
    legacyNodes.map((node) => ({ x: node.x, y: node.y })),
  );
  assert.equal(migrated.edges[0].style, "NORMAL");
  assert.equal(migrated.edges[0].width, 1);
  assert.equal(migrated.edges[0].creationOrder, 0);
});

test("v2 point endpoints migrate, snap, and preserve unknown top-level data", () => {
  const resistor = createDeviceNode("resistor", 100, 100);
  const migrated = parseSchematicDocument({
    version: 2,
    project: "legacy-project",
    cell: "point-wire",
    view: "schematic",
    nodes: [resistor],
    edges: [{
      id: "legacy-point-wire",
      source: { x: 43, y: 62 },
      target: { nodeId: resistor.id, portId: "P" },
      vertices: [{ x: 78, y: 118 }],
    }],
    vendorPayload: { keep: true },
  });

  assert.equal(migrated.version, 3);
  assert.deepEqual(migrated.edges[0].source, { x: 45, y: 60 });
  assert.deepEqual(migrated.edges[0].vertices, [{ x: 80, y: 120 }]);
  assert.deepEqual(migrated.extensions, {
    legacy: { vendorPayload: { keep: true } },
  });
});

test("v3 formal labels must attach to a valid wire segment", () => {
  const base = createEmptyDocument("validation", "labels");
  const wire = {
    id: "wire-label",
    source: { x: 0, y: 20 },
    target: { x: 100, y: 20 },
    style: "NORMAL" as const,
    width: 1,
    creationOrder: 0,
  };
  const valid = {
    ...base,
    edges: [wire],
    netLabels: [{
      id: "label-bias",
      text: "BIAS",
      wireId: wire.id,
      segmentIndex: 0,
      anchorPoint: { x: 40, y: 20 },
      orientation: 0 as const,
      textAlignment: "start" as const,
    }],
  };

  assert.equal(parseSchematicDocument(valid).netLabels[0].text, "BIAS");
  assert.throws(() => parseSchematicDocument({
    ...valid,
    netLabels: [{ ...valid.netLabels[0], anchorPoint: { x: 40, y: 25 } }],
  }));
  assert.throws(() => parseSchematicDocument({
    ...valid,
    netLabels: [{ ...valid.netLabels[0], wireId: "missing-wire" }],
  }));
});

test("v3 rejects legacy utility nodes and NoConnect on a top-level pin", () => {
  const base = createEmptyDocument("validation", "formal-objects");
  const legacyJunction = createDeviceNode("junction", 40, 40);
  const input = createDeviceNode("input", 80, 80);

  assert.throws(() => parseSchematicDocument({ ...base, nodes: [legacyJunction] }));
  assert.throws(() => parseSchematicDocument({
    ...base,
    nodes: [input],
    noConnects: [{
      id: "nc-input",
      nodeId: input.id,
      portId: "P",
      position: { x: 80, y: 100 },
    }],
  }));
});
