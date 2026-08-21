import assert from "node:assert/strict";
import test from "node:test";

import { runSchematicCheck } from "../lib/checkEngine";
import {
  createIdleCommandSession,
  reduceCommandSession,
} from "../lib/commandEngine";
import { extractConnectivity } from "../lib/connectivity";
import { DesignStore } from "../lib/designStore";
import { serializeSchematic } from "../lib/persistence";
import {
  createDeviceNode,
  createEmptyDocument,
  getPinWorldPosition,
  withCheckedRevision,
  withDesignRevision,
  withSavedRevision,
  type Point,
  type SchematicDocument,
  type SchematicEdge,
} from "../lib/schematic";

function wire(
  id: string,
  source: Point,
  target: Point,
  creationOrder: number,
): SchematicEdge {
  return {
    id,
    source,
    target,
    style: "NORMAL",
    width: 1,
    creationOrder,
  };
}

function geometryDocument(edges: SchematicEdge[]): SchematicDocument {
  return {
    ...createEmptyDocument("vse-core", "geometry"),
    edges,
  };
}

test("a wire endpoint on another segment creates a physical T connection", () => {
  const document = geometryDocument([
    wire("wire-horizontal", { x: 0, y: 0 }, { x: 100, y: 0 }, 1),
    wire("wire-branch", { x: 50, y: -50 }, { x: 50, y: 0 }, 2),
  ]);

  const connectivity = extractConnectivity(document);

  assert.equal(connectivity.physicalComponents.length, 1);
  assert.deepEqual(connectivity.physicalComponents[0].wireIds, ["wire-branch", "wire-horizontal"]);
  assert.equal(connectivity.logicalNets.length, 1);
  assert.deepEqual(connectivity.logicalNets[0].wireIds, ["wire-branch", "wire-horizontal"]);
});

test("ordinary interior crossover does not connect its two physical nets", () => {
  const document = geometryDocument([
    wire("wire-horizontal", { x: 0, y: 0 }, { x: 100, y: 0 }, 1),
    wire("wire-vertical", { x: 50, y: -50 }, { x: 50, y: 50 }, 2),
  ]);

  const connectivity = extractConnectivity(document);

  assert.equal(connectivity.physicalComponents.length, 2);
  assert.equal(connectivity.logicalNets.length, 2);
  assert.notEqual(
    connectivity.wireToNet.get("wire-horizontal"),
    connectivity.wireToNet.get("wire-vertical"),
  );
});

test("an explicit Junction turns an interior crossover into one physical net", () => {
  const base = geometryDocument([
    wire("wire-horizontal", { x: 0, y: 0 }, { x: 100, y: 0 }, 1),
    wire("wire-vertical", { x: 50, y: -50 }, { x: 50, y: 50 }, 2),
  ]);
  const document = {
    ...base,
    explicitJunctions: [{ id: "junction-centre", point: { x: 50, y: 0 } }],
  };

  const connectivity = extractConnectivity(document);

  assert.equal(connectivity.physicalComponents.length, 1);
  assert.deepEqual(connectivity.physicalComponents[0].wireIds, ["wire-horizontal", "wire-vertical"]);
  assert.equal(connectivity.logicalNets.length, 1);
});

test("same-name labels merge disconnected physical components into one logical net", () => {
  const base = geometryDocument([
    wire("wire-a", { x: 0, y: 0 }, { x: 100, y: 0 }, 1),
    wire("wire-b", { x: 0, y: 100 }, { x: 100, y: 100 }, 2),
  ]);
  const document = {
    ...base,
    netLabels: [
      {
        id: "label-a",
        text: "BIAS",
        wireId: "wire-a",
        segmentIndex: 0,
        anchorPoint: { x: 40, y: 0 },
        orientation: 0 as const,
        textAlignment: "start" as const,
      },
      {
        id: "label-b",
        text: "BIAS",
        wireId: "wire-b",
        segmentIndex: 0,
        anchorPoint: { x: 60, y: 100 },
        orientation: 0 as const,
        textAlignment: "start" as const,
      },
    ],
  };

  const connectivity = extractConnectivity(document);
  const bias = connectivity.logicalNets.find((net) => net.name === "BIAS");

  assert.equal(connectivity.physicalComponents.length, 2);
  assert.ok(bias);
  assert.deepEqual(bias.physicalComponentIds, connectivity.physicalComponents.map((component) => component.id));
  assert.deepEqual(bias.wireIds, ["wire-a", "wire-b"]);
  assert.deepEqual(bias.labelIds, ["label-a", "label-b"]);
});

test("canonical serialization is independent of object and property insertion order", () => {
  const first = createDeviceNode("resistor", 20, 20);
  const second = createDeviceNode("capacitor", 220, 20, [first]);
  const edgeA = wire("wire-a", { x: 0, y: 0 }, { x: 100, y: 0 }, 1);
  const edgeB = wire("wire-b", { x: 0, y: 40 }, { x: 100, y: 40 }, 2);
  const left: SchematicDocument = {
    ...createEmptyDocument("stable", "serialization"),
    properties: { zeta: "last", alpha: "first" },
    nodes: [second, first],
    edges: [edgeB, edgeA],
    explicitJunctions: [
      { id: "junction-z", point: { x: 80, y: 40 } },
      { id: "junction-a", point: { x: 20, y: 0 } },
    ],
    notes: [
      { id: "note-z", text: "z", anchorPoint: { x: 10, y: 10 }, orientation: 0 },
      { id: "note-a", text: "a", anchorPoint: { x: 20, y: 20 }, orientation: 0 },
    ],
  };
  const right: SchematicDocument = {
    ...structuredClone(left),
    properties: { alpha: "first", zeta: "last" },
    nodes: [first, second],
    edges: [edgeA, edgeB],
    explicitJunctions: [...left.explicitJunctions].reverse(),
    notes: [...left.notes].reverse(),
  };

  assert.equal(serializeSchematic(left), serializeSchematic(right));
  assert.equal(serializeSchematic(left), serializeSchematic(left));
});

test("design, saved, connectivity, and check revisions advance by change type", () => {
  const current: SchematicDocument = {
    ...createEmptyDocument("revision", "matrix"),
    revisions: {
      designRevision: 5,
      savedRevision: 4,
      connectivityRevision: 5,
      checkRevision: 5,
    },
  };

  const visualOnly = withDesignRevision(current, false);
  assert.deepEqual(visualOnly.revisions, {
    designRevision: 6,
    savedRevision: 4,
    connectivityRevision: 6,
    checkRevision: 6,
  });

  const connectivityChange = withDesignRevision(current, true);
  assert.deepEqual(connectivityChange.revisions, {
    designRevision: 6,
    savedRevision: 4,
    connectivityRevision: 5,
    checkRevision: 5,
  });
  assert.equal(withSavedRevision(connectivityChange).revisions.savedRevision, 6);
  assert.deepEqual(withCheckedRevision(connectivityChange).revisions, {
    designRevision: 6,
    savedRevision: 4,
    connectivityRevision: 6,
    checkRevision: 6,
  });
});

test("CommandTransaction undo and redo restore exact documents and selections", () => {
  const initial = createEmptyDocument("transactions", "undo-redo");
  const store = new DesignStore(initial);
  const resistor = createDeviceNode("resistor", 100, 100);

  const transaction = store.execute(
    "create-instance",
    (document) => ({ ...document, nodes: [resistor] }),
    {
      transactionId: "tx-create-r1",
      timestamp: 1234,
      selectionBefore: [],
      selectionAfter: [resistor.id],
      connectivityAffected: true,
    },
  );

  assert.ok(transaction);
  assert.equal(transaction.id, "tx-create-r1");
  assert.deepEqual(transaction.selectionBefore, []);
  assert.deepEqual(transaction.selectionAfter, [resistor.id]);
  assert.equal(store.document.nodes[0].id, resistor.id);
  assert.equal(store.document.revisions.designRevision, 1);
  assert.equal(store.canUndo, true);
  assert.equal(store.canRedo, false);

  const undo = store.undo();
  assert.equal(undo?.id, transaction.id);
  assert.deepEqual(store.document, initial);
  assert.equal(store.canUndo, false);
  assert.equal(store.canRedo, true);

  const redo = store.redo();
  assert.equal(redo?.id, transaction.id);
  assert.deepEqual(store.document, transaction.after);
  assert.equal(store.canUndo, true);
  assert.equal(store.canRedo, false);

  const detached = store.document;
  detached.nodes.length = 0;
  assert.equal(store.document.nodes.length, 1, "readers cannot mutate store state through a snapshot");
});

test("wire command state supports fixed points, layered cancel, and repeat", () => {
  let session = reduceCommandSession(createIdleCommandSession(), {
    type: "INVOKE",
    commandId: "create-wire",
  });
  assert.equal(session.phase, "COMMAND_ARMED");

  session = reduceCommandSession(session, {
    type: "WIRE_START",
    source: { x: 0, y: 0 },
    point: { x: 0, y: 0 },
  });
  session = reduceCommandSession(session, {
    type: "WIRE_FIX_POINT",
    point: { x: 40, y: 0 },
  });
  assert.equal(session.phase, "DYNAMIC_PREVIEW");
  assert.deepEqual(session.wire?.fixedPoints, [{ x: 0, y: 0 }, { x: 40, y: 0 }]);

  session = reduceCommandSession(session, { type: "CANCEL" });
  assert.deepEqual(session.wire?.fixedPoints, [{ x: 0, y: 0 }]);
  session = reduceCommandSession(session, { type: "CANCEL" });
  assert.equal(session.phase, "COMMAND_ARMED");
  assert.equal(session.wire?.source, null);
  session = reduceCommandSession(session, { type: "CANCEL" });
  assert.equal(session.phase, "IDLE");

  session = reduceCommandSession(createIdleCommandSession(), {
    type: "INVOKE",
    commandId: "create-wire",
  });
  session = reduceCommandSession(session, {
    type: "WIRE_START",
    source: { x: 0, y: 0 },
    point: { x: 0, y: 0 },
  });
  session = reduceCommandSession(session, { type: "COMMIT" });
  assert.equal(session.phase, "REPEAT");
  assert.equal(session.wire?.source, null);
});

test("Check creates deterministic markers and updates check revisions", () => {
  const first = createDeviceNode("resistor", 0, 0);
  const secondBase = createDeviceNode("resistor", 240, 0, [first]);
  const second = { ...secondBase, instanceName: first.instanceName };
  const document: SchematicDocument = {
    ...createEmptyDocument("check", "markers"),
    nodes: [first, second],
    revisions: {
      designRevision: 3,
      savedRevision: 2,
      connectivityRevision: 1,
      checkRevision: 1,
    },
  };

  const result = runSchematicCheck(document);
  const repeated = runSchematicCheck(document);
  const duplicateMarker = result.markers.find((marker) => marker.ruleId === "DUPLICATE_INSTANCE_NAME");

  assert.ok(duplicateMarker);
  assert.equal(duplicateMarker.severity, "error");
  assert.equal(duplicateMarker.revision, 3);
  assert.equal(duplicateMarker.status, "active");
  assert.deepEqual(duplicateMarker.objectRefs, [first.id, second.id]);
  assert.deepEqual(result.document.markers, result.markers);
  assert.equal(result.document.revisions.connectivityRevision, 3);
  assert.equal(result.document.revisions.checkRevision, 3);
  assert.deepEqual(
    repeated.markers.map((marker) => marker.id),
    result.markers.map((marker) => marker.id),
  );

  const disabled = runSchematicCheck(document, {
    DUPLICATE_INSTANCE_NAME: {
      enabled: false,
      severity: "error",
      parameters: {},
    },
  });
  assert.equal(disabled.markers.some((marker) => marker.ruleId === "DUPLICATE_INSTANCE_NAME"), false);
});

test("No Connect on a wired instance terminal creates a deterministic conflict marker", () => {
  const resistor = createDeviceNode("resistor", 100, 100);
  const position = getPinWorldPosition(resistor, "P");
  assert.ok(position);
  const document: SchematicDocument = {
    ...createEmptyDocument("check", "no-connect"),
    nodes: [resistor],
    edges: [{
      id: "wire-no-connect-conflict",
      source: { nodeId: resistor.id, portId: "P" },
      target: { x: position.x - 40, y: position.y },
      style: "NORMAL",
      width: 1,
      creationOrder: 1,
    }],
    noConnects: [{
      id: `nc_${resistor.id}_P`,
      nodeId: resistor.id,
      portId: "P",
      position,
    }],
  };

  const first = runSchematicCheck(document);
  const second = runSchematicCheck(document);
  const conflict = first.markers.find((marker) => marker.ruleId === "NO_CONNECT_AND_WIRE");

  assert.ok(conflict);
  assert.equal(conflict.severity, "error");
  assert.deepEqual(conflict.objectRefs, [`nc_${resistor.id}_P`, resistor.id].sort());
  assert.equal(
    second.markers.find((marker) => marker.ruleId === "NO_CONNECT_AND_WIRE")?.id,
    conflict.id,
  );
});
