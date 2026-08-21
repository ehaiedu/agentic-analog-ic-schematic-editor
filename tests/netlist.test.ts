import assert from "node:assert/strict";
import test from "node:test";

import { compileNetlist } from "../lib/netlist";
import {
  canvasPositionToDocumentOrigin,
  createDemoDocument,
  createDeviceNode,
  createEmptyDocument,
  documentOriginToCanvasPosition,
  ELECTRICAL_GRID_SIZE,
  getDeviceDefinition,
  getNodeOriginOffset,
  getPinPosition,
  getPinWorldPosition,
  normalizeSchematicGeometry,
  orthogonalWireVertices,
  type DeviceKind,
  type Rotation,
  updateNodeProperties,
} from "../lib/schematic";
import { createX6NodeMetadata } from "../components/x6Symbols";

const expectedSpectre = `// agentic-analog-ic-schematic-editor / cmos_inverter
simulator lang=spectre
global 0 VDD
subckt cmos_inverter VIN VOUT
  M1 (VOUT VIN 0 0) nmos w=10u l=180n m=1 nf=1
  M2 (VOUT VIN VDD VDD) pmos w=20u l=180n m=1 nf=1
ends cmos_inverter
`;

const expectedSpice = `* agentic-analog-ic-schematic-editor / cmos_inverter
.global VDD
.subckt cmos_inverter VIN VOUT
M1 VOUT VIN 0 0 nmos W=10u L=180n M=1 NF=1
M2 VOUT VIN VDD VDD pmos W=20u L=180n M=1 NF=1
.ends cmos_inverter
`;

test("demo inverter compiles to deterministic Spectre", () => {
  const result = compileNetlist(createDemoDocument(), "spectre");

  assert.equal(result.text, expectedSpectre);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(
    result.nets.map((net) => net.name).sort(),
    ["0", "VDD", "VIN", "VOUT"],
  );
});
test("demo inverter compiles to deterministic SPICE", () => {
  const result = compileNetlist(createDemoDocument(), "spice");

  assert.equal(result.text, expectedSpice);
  assert.deepEqual(result.issues, []);
});

test("terminal-to-point stub reports one dangling warning and counts its source pin", () => {
  const resistor = createDeviceNode("resistor", 100, 100);
  const [sourcePin, otherPin] = getDeviceDefinition("resistor").pins;
  const document = {
    ...createEmptyDocument("stub", "dangling_wire"),
    nodes: [resistor],
    edges: [{
      id: "W_STUB",
      source: { nodeId: resistor.id, portId: sourcePin.id },
      target: { x: 220, y: 120 },
    }],
  };

  const result = compileNetlist(document, "spectre");
  const danglingIssues = result.issues.filter((issue) => issue.code === "DANGLING_WIRE");

  assert.equal(danglingIssues.length, 1);
  assert.equal(danglingIssues[0].severity, "warning");
  assert.equal(danglingIssues[0].edgeId, "W_STUB");
  assert.deepEqual(danglingIssues[0].objectRefs, ["W_STUB"]);
  assert.equal(result.issues.some((issue) => issue.code === "CORRUPTED_OBJECT_REFERENCE"), false);
  assert.equal(result.issues.some((issue) =>
    issue.code === "UNCONNECTED_REQUIRED_TERMINAL"
    && issue.nodeId === resistor.id
    && issue.portId === sourcePin.id), false);
  assert.equal(result.issues.some((issue) =>
    issue.code === "UNCONNECTED_REQUIRED_TERMINAL"
    && issue.nodeId === resistor.id
    && issue.portId === otherPin.id), true);

  const sourceNet = result.nets.find((net) => net.terminals.some((terminal) =>
    terminal.nodeId === resistor.id && terminal.portId === sourcePin.id));
  assert.deepEqual(sourceNet?.terminals, [{ nodeId: resistor.id, portId: sourcePin.id }]);
});

test("point-to-terminal stub counts the terminal without inventing a geometric net", () => {
  const resistor = createDeviceNode("resistor", 100, 100);
  const [targetPin, otherPin] = getDeviceDefinition("resistor").pins;
  const document = {
    ...createEmptyDocument("stub", "reverse_dangling_wire"),
    nodes: [resistor],
    edges: [{
      id: "W_REVERSE_STUB",
      source: { x: 40, y: 120 },
      target: { nodeId: resistor.id, portId: targetPin.id },
    }],
  };

  const result = compileNetlist(document, "spectre");
  assert.equal(result.issues.filter((issue) => issue.code === "DANGLING_WIRE").length, 1);
  assert.equal(result.issues.some((issue) =>
    issue.code === "UNCONNECTED_REQUIRED_TERMINAL"
    && issue.nodeId === resistor.id
    && issue.portId === targetPin.id), false);
  assert.equal(result.issues.some((issue) =>
    issue.code === "UNCONNECTED_REQUIRED_TERMINAL"
    && issue.nodeId === resistor.id
    && issue.portId === otherPin.id), true);
});

test("point-to-point wire remains persisted geometry and reports both free ends", () => {
  const document = {
    ...createEmptyDocument("stub", "floating_wire"),
    edges: [{
      id: "W_FLOATING",
      source: { x: 40, y: 60 },
      target: { x: 140, y: 60 },
    }],
  };

  const result = compileNetlist(document, "spectre");
  const dangling = result.issues.filter((issue) => issue.code === "DANGLING_WIRE");
  assert.equal(dangling.length, 1);
  assert.equal(dangling[0].severity, "warning");
  assert.equal(dangling[0].edgeId, "W_FLOATING");
  assert.equal(result.issues.some((issue) => issue.code === "INVALID_WIRE_GEOMETRY"), false);
  assert.equal(result.nets.length, 1);
  assert.deepEqual(result.nets[0].wireIds, ["W_FLOATING"]);
  assert.deepEqual(result.nets[0].terminals, []);
});

test("different terminals on the same MOS can be explicitly connected", () => {
  const nmos = createDeviceNode("nmos4", 100, 100);
  const document = {
    ...createEmptyDocument("loop", "same_device_ports"),
    nodes: [nmos],
    edges: [{
      id: "W_SOURCE_BULK",
      source: { nodeId: nmos.id, portId: "S" },
      target: { nodeId: nmos.id, portId: "B" },
    }],
  };

  const result = compileNetlist(document, "spectre");
  const sourceBulkNet = result.nets.find((net) => net.terminals.some((terminal) =>
    terminal.nodeId === nmos.id && terminal.portId === "S"));
  assert.deepEqual(
    new Set(sourceBulkNet?.terminals.map((terminal) => terminal.portId)),
    new Set(["B", "S"]),
  );
  assert.equal(result.issues.some((issue) => issue.code === "CORRUPTED_OBJECT_REFERENCE"), false);
});

test("same terminal self-wire is ignored instead of masking an open pin", () => {
  const nmos = createDeviceNode("nmos4", 100, 100);
  const document = {
    ...createEmptyDocument("loop", "same_terminal"),
    nodes: [nmos],
    edges: [{
      id: "W_SAME_PORT",
      source: { nodeId: nmos.id, portId: "S" },
      target: { nodeId: nmos.id, portId: "S" },
    }],
  };

  const result = compileNetlist(document, "spectre");
  assert.equal(result.issues.some((issue) =>
    issue.code === "ZERO_LENGTH_WIRE"
    && issue.edgeId === "W_SAME_PORT"), true);
  assert.equal(result.issues.some((issue) =>
    issue.code === "UNCONNECTED_REQUIRED_TERMINAL"
    && issue.nodeId === nmos.id
    && issue.portId === "S"), true);
});

test("separate terminal-to-netlabel wires merge through identical label names", () => {
  const first = createDeviceNode("resistor", 40, 80);
  const second = createDeviceNode("resistor", 280, 80, [first]);
  const firstLabelBase = createDeviceNode("netlabel", 140, 80, [first, second]);
  const secondLabelBase = createDeviceNode("netlabel", 380, 80, [first, second, firstLabelBase]);
  const firstLabel = {
    ...firstLabelBase,
    properties: { ...firstLabelBase.properties, netName: "BIAS" },
  };
  const secondLabel = {
    ...secondLabelBase,
    properties: { ...secondLabelBase.properties, netName: "BIAS" },
  };
  const resistorPin = getDeviceDefinition("resistor").pins[0].id;
  const labelPin = getDeviceDefinition("netlabel").pins[0].id;
  const document = {
    ...createEmptyDocument("labels", "implicit_merge"),
    nodes: [first, second, firstLabel, secondLabel],
    edges: [
      {
        id: "W_LABEL_A",
        source: { nodeId: first.id, portId: resistorPin },
        target: { nodeId: firstLabel.id, portId: labelPin },
      },
      {
        id: "W_LABEL_B",
        source: { nodeId: second.id, portId: resistorPin },
        target: { nodeId: secondLabel.id, portId: labelPin },
      },
    ],
  };

  const result = compileNetlist(document, "spectre");
  const biasNet = result.nets.find((net) => net.name === "BIAS");

  assert.ok(biasNet);
  assert.deepEqual(
    new Set(biasNet.terminals.map((terminal) => `${terminal.nodeId}:${terminal.portId}`)),
    new Set([
      `${first.id}:${resistorPin}`,
      `${second.id}:${resistorPin}`,
      `${firstLabel.id}:${labelPin}`,
      `${secondLabel.id}:${labelPin}`,
    ]),
  );
  assert.equal(result.issues.some((issue) => issue.code === "MULTIPLE_EXPLICIT_NET_NAMES"), false);
});

test("PMOS bulk reaches global VDD through a short wire and VDD label", () => {
  const pmos = createDeviceNode("pmos4", 200, 200);
  const vdd = createDeviceNode("vdd", 400, 40, [pmos]);
  const labelBase = createDeviceNode("netlabel", 260, 200, [pmos, vdd]);
  const label = {
    ...labelBase,
    properties: { ...labelBase.properties, netName: "VDD" },
  };
  const document = {
    ...createEmptyDocument("labels", "bulk_vdd"),
    nodes: [pmos, vdd, label],
    edges: [{
      id: "W_BULK_VDD",
      source: { nodeId: pmos.id, portId: "B" },
      target: { nodeId: label.id, portId: "P" },
    }],
  };

  const result = compileNetlist(document, "spectre");
  const vddNet = result.nets.find((net) => net.name === "VDD");
  assert.ok(vddNet?.terminals.some((terminal) =>
    terminal.nodeId === pmos.id && terminal.portId === "B"));
  assert.match(result.text, /M1 \([^\n]+ VDD\) pmos/);
});

test("uniformly translating symbols and wire geometry preserves electrical output", () => {
  const original = createDemoDocument();
  const offset = { x: 135, y: -75 };
  const movedNodes = original.nodes.map((node) => ({
    ...node,
    x: node.x + offset.x,
    y: node.y + offset.y,
  }));
  const moved = {
    ...original,
    nodes: movedNodes,
    edges: original.edges.map((edge) => ({
      ...edge,
      source: "nodeId" in edge.source
        ? edge.source
        : { x: edge.source.x + offset.x, y: edge.source.y + offset.y },
      target: "nodeId" in edge.target
        ? edge.target
        : { x: edge.target.x + offset.x, y: edge.target.y + offset.y },
      ...(edge.vertices ? {
        vertices: edge.vertices.map((point) => ({
          x: point.x + offset.x,
          y: point.y + offset.y,
        })),
      } : {}),
    })),
    explicitJunctions: original.explicitJunctions.map((junction) => ({
      ...junction,
      point: { x: junction.point.x + offset.x, y: junction.point.y + offset.y },
    })),
    netLabels: original.netLabels.map((label) => ({
      ...label,
      anchorPoint: {
        x: label.anchorPoint.x + offset.x,
        y: label.anchorPoint.y + offset.y,
      },
    })),
  };

  assert.equal(
    compileNetlist(moved, "spectre").text,
    compileNetlist(original, "spectre").text,
  );
  assert.equal(
    compileNetlist(moved, "spice").text,
    compileNetlist(original, "spice").text,
  );
});

const deviceKinds: DeviceKind[] = [
  "nmos4",
  "pmos4",
  "resistor",
  "capacitor",
  "inductor",
  "vsource",
  "isource",
  "vdd",
  "gnd",
  "input",
  "output",
  "bidir",
  "junction",
  "netlabel",
];

function rotatedOffset(x: number, y: number, rotation: Rotation) {
  if (rotation === 90) return { x: -y, y: x };
  if (rotation === 180) return { x: -x, y: -y };
  if (rotation === 270) return { x: y, y: -x };
  return { x, y };
}

test("all canonical ports stay on the 5 px electrical grid after mirror and rotation", () => {
  const rotations: Rotation[] = [0, 90, 180, 270];
  for (const kind of deviceKinds) {
    const base = createDeviceNode(kind, 15, 25);
    const definition = getDeviceDefinition(kind);
    for (const mirrored of [false, true]) {
      const node = { ...base, mirrored };
      for (const pin of definition.pins) {
        const local = getPinPosition(pin, node);
        for (const rotation of rotations) {
          const rotatedNode = { ...node, rotation };
          const box = documentOriginToCanvasPosition(rotatedNode);
          const center = { x: box.x + node.width / 2, y: box.y + node.height / 2 };
          const offset = rotatedOffset(local.x - node.width / 2, local.y - node.height / 2, rotation);
          const absolute = { x: center.x + offset.x, y: center.y + offset.y };
          assert.equal(Math.abs(absolute.x % ELECTRICAL_GRID_SIZE), 0, `${kind}.${pin.id} x at ${rotation}°`);
          assert.equal(Math.abs(absolute.y % ELECTRICAL_GRID_SIZE), 0, `${kind}.${pin.id} y at ${rotation}°`);
        }
      }
    }
  }
});

test("MOS Gate origin is stable for every rotation and mirror state", () => {
  const rotations: Rotation[] = [0, 90, 180, 270];
  const expected = {
    normal: [{ x: 0, y: 35 }, { x: 25, y: 10 }, { x: 50, y: 35 }, { x: 25, y: 60 }],
    mirrored: [{ x: 50, y: 35 }, { x: 25, y: 60 }, { x: 0, y: 35 }, { x: 25, y: 10 }],
  };
  for (const mirrored of [false, true]) {
    rotations.forEach((rotation, index) => {
      const node = {
        ...createDeviceNode("pmos4", 375, 185),
        mirrored,
        rotation,
      };
      assert.deepEqual(
        getNodeOriginOffset(node),
        expected[mirrored ? "mirrored" : "normal"][index],
      );
      const box = documentOriginToCanvasPosition(node);
      assert.deepEqual(canvasPositionToDocumentOrigin(node, box), { x: node.x, y: node.y });
      const metadata = createX6NodeMetadata(node);
      assert.deepEqual({ x: metadata.x, y: metadata.y }, box);
    });
  }
});

test("orthogonal wire helper persists one valid corner only when needed", () => {
  assert.deepEqual(
    orthogonalWireVertices({ x: 12, y: 18 }, { x: 97, y: 83 }),
    [{ x: 95, y: 20 }],
  );
  assert.deepEqual(orthogonalWireVertices({ x: 10, y: 20 }, { x: 100, y: 20 }), []);
});

test("geometry migration snaps old drawings without changing connectivity", () => {
  const original = createDemoDocument();
  const legacy = {
    ...original,
    nodes: original.nodes.map((node, index) => index === 0
      ? { ...node, x: 81, y: 242, width: 80, height: 38 }
      : node),
    edges: original.edges.map((edge, index) => index === 0
      ? { ...edge, vertices: [{ x: 13, y: 17 }] }
      : edge),
  };
  const normalized = normalizeSchematicGeometry(legacy);
  const input = normalized.nodes[0];

  assert.deepEqual(
    { x: input.x, y: input.y, width: input.width, height: input.height },
    { x: 80, y: 240, width: 80, height: 40 },
  );
  assert.deepEqual(normalized.edges[0].vertices, [{ x: 15, y: 15 }]);
  assert.equal(compileNetlist(normalized, "spectre").text, compileNetlist(original, "spectre").text);
});

test("demo input branch terminates on the vertical gate segment", () => {
  const document = createDemoDocument();
  const input = document.nodes.find((node) => node.kind === "input");
  assert.ok(input);
  const inputPin = getPinPosition(getDeviceDefinition("input").pins[0], input);
  const branch = document.edges.find((edge) => edge.id === "wire_01");
  const gateWire = document.edges.find((edge) => edge.id === "wire_02");
  assert.ok(branch);
  assert.ok(gateWire);
  assert.deepEqual(branch.target, { x: 370, y: 260 });
  assert.equal(input.y + inputPin.y, 260);
  const gateTerminals = [gateWire.source, gateWire.target];
  assert.ok(gateTerminals.every((endpoint) => "nodeId" in endpoint));
  const gatePoints = gateTerminals.map((endpoint) => {
    if (!("nodeId" in endpoint)) throw new Error("expected terminal endpoint");
    const node = document.nodes.find((candidate) => candidate.id === endpoint.nodeId);
    assert.ok(node);
    return getPinWorldPosition(node, endpoint.portId);
  });
  assert.ok(gatePoints.every(Boolean));
  assert.equal(gatePoints[0]?.x, 370);
  assert.equal(gatePoints[1]?.x, 370);
  assert.ok(260 >= Math.min(gatePoints[0]!.y, gatePoints[1]!.y));
  assert.ok(260 <= Math.max(gatePoints[0]!.y, gatePoints[1]!.y));
});

test("MOS annotations use a fixed Cadence-style stack on the right", () => {
  const pmos = createDemoDocument().nodes.find((node) => node.kind === "pmos4");
  assert.ok(pmos);
  const pinPositions = Object.fromEntries(
    getDeviceDefinition("pmos4").pins.map((pin) => [pin.id, getPinPosition(pin, pmos)]),
  );
  assert.deepEqual(pinPositions, {
    D: { x: 40, y: 70 },
    G: { x: 0, y: 35 },
    S: { x: 40, y: 0 },
    B: { x: 40, y: 35 },
  });
  const metadata = createX6NodeMetadata({ ...pmos, rotation: 90 });
  const attrs = metadata.attrs as Record<string, Record<string, unknown>>;

  assert.equal(attrs.labelGroup.transform, "rotate(-90 25 35)");
  assert.equal(attrs.instanceLabel.x, 64);
  assert.equal(attrs.instanceLabel.refX, 0);
  assert.equal(attrs.instanceLabel.refY, 0);
  assert.deepEqual(
    [
      attrs.instanceLabel.text,
      attrs.mosModelLabel.text,
      attrs.mosWidthLabel.text,
      attrs.mosLengthLabel.text,
      attrs.mosFingerLabel.text,
      attrs.mosMultiplierLabel.text,
    ],
    ["M2", '"pmos"', "w:20u", "l:180n", "fingers:1", "m:1"],
  );
  assert.deepEqual(
    [
      attrs.instanceLabel.y,
      attrs.mosModelLabel.y,
      attrs.mosWidthLabel.y,
      attrs.mosLengthLabel.y,
      attrs.mosFingerLabel.y,
      attrs.mosMultiplierLabel.y,
    ],
    [10, 21, 32, 43, 54, 65],
  );
});

test("Cadence-style terminals distinguish square pins from round junctions", () => {
  const nmos = createDeviceNode("nmos4", 100, 100);
  const junction = createDeviceNode("junction", 200, 100, [nmos]);
  const nmosMetadata = createX6NodeMetadata(nmos);
  const junctionMetadata = createX6NodeMetadata(junction);
  const nmosPorts = nmosMetadata.ports as unknown as {
    groups: { pin: { markup: Array<Record<string, unknown>>; attrs: { portBody: Record<string, unknown> } } };
  };
  const junctionPorts = junctionMetadata.ports as unknown as typeof nmosPorts;

  assert.deepEqual(nmosPorts.groups.pin.markup[0], {
    tagName: "rect",
    selector: "portBody",
    className: "terminal-port",
  });
  assert.deepEqual(
    {
      x: nmosPorts.groups.pin.attrs.portBody.x,
      y: nmosPorts.groups.pin.attrs.portBody.y,
      width: nmosPorts.groups.pin.attrs.portBody.width,
      height: nmosPorts.groups.pin.attrs.portBody.height,
      fill: nmosPorts.groups.pin.attrs.portBody.fill,
    },
    { x: -3, y: -3, width: 6, height: 6, fill: "#d13438" },
  );
  assert.deepEqual(junctionPorts.groups.pin.markup[0], {
    tagName: "circle",
    selector: "portBody",
    className: "junction-port-hit",
  });
  const junctionAttrs = junctionMetadata.attrs as Record<string, Record<string, unknown>>;
  assert.deepEqual(
    {
      r: junctionAttrs.junction.r,
      fill: junctionAttrs.junction.fill,
      stroke: junctionAttrs.junction.stroke,
    },
    { r: 3.5, fill: "#2b579a", stroke: "none" },
  );
});

test("MOS paths and arrow stay bound to the semantic Source terminal", () => {
  const nmos = createDeviceNode("nmos4", 100, 100);
  const pmos = createDeviceNode("pmos4", 200, 100, [nmos]);
  const nmosAttrs = createX6NodeMetadata(nmos).attrs as Record<string, Record<string, unknown>>;
  const pmosAttrs = createX6NodeMetadata(pmos).attrs as Record<string, Record<string, unknown>>;

  assert.equal(nmosAttrs.mosSource.d, "M 30 50 L 40 50 L 40 70");
  assert.equal(nmosAttrs.mosDrain.d, "M 30 20 L 40 20 L 40 0");
  assert.equal(nmosAttrs.mosArrow.d, "M 32 46 L 39 50 L 32 54");
  assert.equal(pmosAttrs.mosSource.d, "M 30 20 L 40 20 L 40 0");
  assert.equal(pmosAttrs.mosDrain.d, "M 30 50 L 40 50 L 40 70");
  assert.equal(pmosAttrs.mosArrow.d, "M 38 16 L 31 20 L 38 24");

  for (const rotation of [0, 90, 180, 270] as const) {
    for (const mirrored of [false, true]) {
      const rotated = { ...pmos, rotation, mirrored };
      const source = getPinWorldPosition(rotated, "S");
      assert.ok(source);
      assert.equal(Math.abs(source.x % ELECTRICAL_GRID_SIZE), 0);
      assert.equal(Math.abs(source.y % ELECTRICAL_GRID_SIZE), 0);
    }
  }
});

test("ERC reports duplicate names, open required pins, and blank parameters", () => {
  const first = createDeviceNode("nmos4", 0, 0);
  const second = createDeviceNode("nmos4", 160, 0, [first]);
  const document = {
    ...createEmptyDocument("erc", "broken_cell"),
    nodes: [
      first,
      {
        ...second,
        instanceName: first.instanceName,
        properties: { ...second.properties, W: "" },
      },
    ],
  };

  const result = compileNetlist(document, "spectre");
  const codes = result.issues.map((issue) => issue.code);

  assert.ok(codes.includes("DUPLICATE_INSTANCE_NAME"));
  assert.ok(codes.includes("UNCONNECTED_REQUIRED_TERMINAL"));
  assert.ok(codes.includes("EMPTY_PARAMETER"));

  const repairedWidth = updateNodeProperties(document, second.id, {
    properties: { W: "12u" },
  });
  assert.equal(
    repairedWidth.nodes.find((node) => node.id === second.id)?.properties.W,
    "12u",
  );
  assert.equal(document.nodes[1].properties.W, "");
});
