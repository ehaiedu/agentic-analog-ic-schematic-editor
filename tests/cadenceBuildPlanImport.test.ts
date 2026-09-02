import assert from "node:assert/strict";
import test from "node:test";

import {
  importCadenceBuildPlanAsSchematic,
  isCadenceBuildPlan,
} from "../lib/cadenceBuildPlanImport";
import { extractConnectivity } from "../lib/connectivity";
import { hierarchyCellViews } from "../lib/hierarchy";
import { compileNetlist } from "../lib/netlist";
import type { Point, SchematicEdge } from "../lib/schematic";

function pointEndpoint(edge: SchematicEdge): Point | null {
  if ("nodeId" in edge.source) return "nodeId" in edge.target ? null : edge.target;
  return edge.source;
}

function routeContainsPoint(route: SchematicEdge, point: Point): boolean {
  if ("nodeId" in route.source || "nodeId" in route.target) return false;
  if (route.source.x === route.target.x) {
    return point.x === route.source.x
      && point.y >= Math.min(route.source.y, route.target.y)
      && point.y <= Math.max(route.source.y, route.target.y);
  }
  if (route.source.y === route.target.y) {
    return point.y === route.source.y
      && point.x >= Math.min(route.source.x, route.target.x)
      && point.x <= Math.max(route.source.x, route.target.x);
  }
  return false;
}

test("Cadence build_plan imports backend route segments as editable schematic wires", () => {
  const buildPlan = {
    operations: [
      { op: "create_library", lib: "AS_IMPORT_TEST" },
      { op: "create_cellview", lib: "AS_IMPORT_TEST", cell: "leaf_inv", view: "schematic" },
      { op: "create_pin", lib: "AS_IMPORT_TEST", cell: "leaf_inv", pin: "IN", direction: "input", order: 0, xy: [-400, 0] },
      { op: "create_pin", lib: "AS_IMPORT_TEST", cell: "leaf_inv", pin: "OUT", direction: "output", order: 1, xy: [400, 0] },
      { op: "create_pin", lib: "AS_IMPORT_TEST", cell: "leaf_inv", pin: "VDD", direction: "inputOutput", order: 2, xy: [0, 600] },
      { op: "create_pin", lib: "AS_IMPORT_TEST", cell: "leaf_inv", pin: "VSS", direction: "inputOutput", order: 3, xy: [0, -600] },
      {
        op: "place_instance",
        lib: "AS_IMPORT_TEST",
        cell: "leaf_inv",
        instance: "MN0",
        source_kind: "primitive",
        source_primitive_type: "nmos",
        source_model: "nmos",
        logical_pin_order: ["D", "G", "S", "B"],
        connections: { D: "OUT", G: "IN", S: "VSS", B: "VSS" },
        params: { w: "2u", l: "180n", nf: "1", m: "1" },
        master: { lib: "smic18mmrf", cell: "n18", view: "symbol" },
        xy: [0, -220],
        orient: "R0",
      },
      {
        op: "route_net",
        lib: "AS_IMPORT_TEST",
        cell: "leaf_inv",
        net: "IN",
        segments: [[[-400, 0], [-80, 0]], [[-80, 0], [-80, -220]]],
      },
      {
        op: "route_net",
        lib: "AS_IMPORT_TEST",
        cell: "leaf_inv",
        net: "OUT",
        segments: [[[40, -128], [400, -128]], [[400, -128], [400, 0]]],
      },
      {
        op: "route_net",
        lib: "AS_IMPORT_TEST",
        cell: "leaf_inv",
        net: "VSS",
        segments: [[[40, -312], [40, -600]], [[40, -600], [0, -600]]],
      },
      { op: "create_symbol_from_ports", lib: "AS_IMPORT_TEST", cell: "leaf_inv", ports: ["IN", "OUT", "VDD", "VSS"] },
      { op: "check_and_save", lib: "AS_IMPORT_TEST", cell: "leaf_inv" },
      { op: "create_cellview", lib: "AS_IMPORT_TEST", cell: "top_cell", view: "schematic" },
      { op: "create_pin", lib: "AS_IMPORT_TEST", cell: "top_cell", pin: "VIN", direction: "input", order: 0, xy: [-600, 0] },
      { op: "create_pin", lib: "AS_IMPORT_TEST", cell: "top_cell", pin: "VOUT", direction: "output", order: 1, xy: [600, 0] },
      { op: "create_pin", lib: "AS_IMPORT_TEST", cell: "top_cell", pin: "VDD", direction: "inputOutput", order: 2, xy: [0, 500] },
      { op: "create_pin", lib: "AS_IMPORT_TEST", cell: "top_cell", pin: "VSS", direction: "inputOutput", order: 3, xy: [0, -500] },
      {
        op: "place_instance",
        lib: "AS_IMPORT_TEST",
        cell: "top_cell",
        instance: "XINV0",
        source_kind: "subckt",
        source_subckt: "leaf_inv",
        logical_pin_order: ["IN", "OUT", "VDD", "VSS"],
        connections: { IN: "VIN", OUT: "VOUT", VDD: "VDD", VSS: "VSS" },
        master: { lib: "AS_IMPORT_TEST", cell: "leaf_inv", view: "symbol" },
        xy: [0, 0],
        orient: "R0",
      },
      { op: "route_net", lib: "AS_IMPORT_TEST", cell: "top_cell", net: "VIN", segments: [[[-600, 0], [-100, 0]]] },
      { op: "route_net", lib: "AS_IMPORT_TEST", cell: "top_cell", net: "VOUT", segments: [[[100, 0], [600, 0]]] },
      { op: "route_net", lib: "AS_IMPORT_TEST", cell: "top_cell", net: "VDD", segments: [[[0, 500], [0, 100]]] },
      { op: "route_net", lib: "AS_IMPORT_TEST", cell: "top_cell", net: "VSS", segments: [[[0, -100], [0, -500]]] },
      { op: "create_symbol_from_ports", lib: "AS_IMPORT_TEST", cell: "top_cell", ports: ["VIN", "VOUT", "VDD", "VSS"] },
      { op: "check_and_save", lib: "AS_IMPORT_TEST", cell: "top_cell" },
    ],
  };

  const result = importCadenceBuildPlanAsSchematic(buildPlan, {
    topCell: "top_cell",
    project: "import_test",
    coordinateScale: 0.5,
  });
  const children = hierarchyCellViews(result.document);
  const compiled = compileNetlist(result.document, "spectre");
  const terminalEntries = (result.document.extensions?.cadenceTerminalNets as { entries?: Array<{ nodeId: string; portId: string; net: string }> } | undefined)?.entries ?? [];

  assert.equal(isCadenceBuildPlan(buildPlan), true);
  assert.equal(isCadenceBuildPlan({ version: 3, nodes: [] }), false);
  assert.equal(result.summary.library, "AS_IMPORT_TEST");
  assert.equal(result.summary.topCell, "top_cell");
  assert.equal(result.summary.cellCount, 2);
  assert.equal(result.summary.routeSegmentCount, 10);
  assert.ok(result.summary.adapterWireCount > 0);
  assert.equal(result.document.properties.routedBy, "cadence_schematic_convertor_backend");
  assert.ok(result.document.edges.some((edge) => edge.id.startsWith("cad_route_top_cell_VIN")));
  assert.ok(result.document.edges.some((edge) => edge.id.startsWith("cad_adapter_top_cell_VIN")));
  assert.ok(result.document.edges.some((edge) => edge.id.startsWith("cad_route_top_cell_VIN") && edge.style === "REFERENCE"));
  assert.ok(result.document.netLabels.some((label) => label.text === "VIN" && label.wireId.startsWith("cad_adapter_top_cell_VIN")));
  const vinRoutes = result.document.edges.filter((edge) => edge.id.startsWith("cad_route_top_cell_VIN"));
  const vinAdapters = result.document.edges.filter((edge) => edge.id.startsWith("cad_adapter_top_cell_VIN"));
  for (const adapter of vinAdapters) {
    const endpoint = pointEndpoint(adapter);
    assert.ok(endpoint, `${adapter.id} should expose a routed point endpoint`);
    assert.ok(
      vinRoutes.some((route) => routeContainsPoint(route, endpoint)),
      `${adapter.id} should terminate on the imported Cadence VIN route`,
    );
  }
  assert.ok(terminalEntries.some((entry) => entry.nodeId === "inst_XINV0" && entry.net === "VIN"));
  assert.equal(Object.values(children).length, 1);
  assert.equal(Object.values(children)[0].cell, "leaf_inv");
  assert.equal(result.document.nodes.find((node) => node.instanceName === "XINV0")?.properties.hierarchyEditable, "true");
  assert.equal(Object.values(children)[0].nodes.find((node) => node.instanceName === "MN0")?.width, 64);
  assert.equal(Object.values(children)[0].nodes.find((node) => node.instanceName === "MN0")?.height, 92);
  assert.match(compiled.text, /XINV0/);
  assert.match(compiled.text, /VIN/);

  const defaultScaled = importCadenceBuildPlanAsSchematic(buildPlan, {
    topCell: "top_cell",
    project: "import_test_default_scale",
  });
  const defaultRoute = defaultScaled.document.edges.find((edge) => edge.id.startsWith("cad_route_top_cell_VIN"));
  assert.ok(defaultRoute && !("nodeId" in defaultRoute.source) && !("nodeId" in defaultRoute.target));
  assert.equal(defaultRoute.source.x, -300);
  assert.ok(Math.abs(defaultRoute.source.y) < 1e-9);
  assert.equal(defaultRoute.target.x, -50);
  assert.ok(Math.abs(defaultRoute.target.y) < 1e-9);
  const defaultChildren = hierarchyCellViews(defaultScaled.document);
  const defaultLeafImport = Object.values(defaultChildren)[0].extensions?.cadenceBuildPlanImport as { cellCoordinateScale?: number };
  assert.equal(defaultLeafImport.cellCoordinateScale, 0.4);
});

test("SAR ADC Cadence build_plan imports as a readable top-to-leaf hierarchy", () => {
  const createCell = (cell: string, pins: string[]) => [
    { op: "create_cellview", lib: "AS_SAR_TEST", cell, view: "schematic" },
    ...pins.map((pin, order) => ({
      op: "create_pin",
      lib: "AS_SAR_TEST",
      cell,
      pin,
      direction: pin === "OUTP" || pin === "OUTN" || pin === "DOUT" || pin === "OUT" || pin === "OUTB" ? "output" : "inputOutput",
      order,
      xy: [order * 120, 0],
    })),
  ];
  const subckt = (
    cell: string,
    instance: string,
    sourceSubckt: string,
    logicalPinOrder: string[],
    connections: Record<string, string>,
  ) => ({
    op: "place_instance",
    lib: "AS_SAR_TEST",
    cell,
    instance,
    source_kind: "subckt",
    source_subckt: sourceSubckt,
    logical_pin_order: logicalPinOrder,
    connections,
    master: { lib: "AS_SAR_TEST", cell: sourceSubckt, view: "symbol" },
    xy: [0, 0],
    orient: "R0",
  });
  const primitive = (
    cell: string,
    instance: string,
    kind: string,
    logicalPinOrder: string[],
    connections: Record<string, string>,
  ) => ({
    op: "place_instance",
    lib: "AS_SAR_TEST",
    cell,
    instance,
    source_kind: "primitive",
    source_primitive_type: kind,
    logical_pin_order: logicalPinOrder,
    connections,
    master: { lib: "smic18mmrf", cell: kind === "pmos" ? "p18" : kind === "nmos" ? "n18" : "cap", view: "symbol" },
    xy: [0, 0],
    orient: "R0",
  });
  const buildPlan = {
    operations: [
      { op: "create_library", lib: "AS_SAR_TEST" },
      ...createCell("sar_inv_only", ["IN", "OUT", "VDD", "VSS"]),
      primitive("sar_inv_only", "MP_INV", "pmos", ["D", "G", "S", "B"], { D: "OUT", G: "IN", S: "VDD", B: "VDD" }),
      primitive("sar_inv_only", "MN_INV", "nmos", ["D", "G", "S", "B"], { D: "OUT", G: "IN", S: "VSS", B: "VSS" }),
      ...createCell("sample_hold_tgate_mos", ["VIN", "SAMPLED", "CLK", "CLKB", "VDD", "VSS"]),
      primitive("sample_hold_tgate_mos", "MSHP", "pmos", ["D", "G", "S", "B"], { D: "SAMPLED", G: "CLKB", S: "VIN", B: "VDD" }),
      primitive("sample_hold_tgate_mos", "MSHN", "nmos", ["D", "G", "S", "B"], { D: "SAMPLED", G: "CLK", S: "VIN", B: "VSS" }),
      ...createCell("sar_bit_ctrl_buffer", ["IN", "OUT", "OUTB", "VDD", "VSS"]),
      primitive("sar_bit_ctrl_buffer", "MP_INV0", "pmos", ["D", "G", "S", "B"], { D: "OUTB", G: "IN", S: "VDD", B: "VDD" }),
      primitive("sar_bit_ctrl_buffer", "MN_INV0", "nmos", ["D", "G", "S", "B"], { D: "OUTB", G: "IN", S: "VSS", B: "VSS" }),
      ...createCell("cdac_bit0_mos_switch_cell", ["BIDIR_TOP", "BIDIR_BOT", "BP", "BPB", "BN", "BNB", "VCM", "VREFN", "VREFP", "VDD", "VSS"]),
      primitive("cdac_bit0_mos_switch_cell", "CUNIT0", "cap", ["PLUS", "MINUS"], { PLUS: "BIDIR_TOP", MINUS: "BIDIR_BOT" }),
      primitive("cdac_bit0_mos_switch_cell", "MREFP0P", "pmos", ["D", "G", "S", "B"], { D: "BIDIR_BOT", G: "BPB", S: "VREFP", B: "VDD" }),
      ...createCell("cdac_split_10b_from_code", ["BIDIR_TOP", "BIDIR_BOT", "CTRL", "VCM", "VREFN", "VREFP", "VDD", "VSS"]),
      subckt("cdac_split_10b_from_code", "XBUF0", "sar_bit_ctrl_buffer", ["IN", "OUT", "OUTB", "VDD", "VSS"], {
        IN: "CTRL",
        OUT: "B0",
        OUTB: "B0B",
        VDD: "VDD",
        VSS: "VSS",
      }),
      subckt("cdac_split_10b_from_code", "XCU0", "cdac_bit0_mos_switch_cell", ["BIDIR_TOP", "BIDIR_BOT", "BP", "BPB", "BN", "BNB", "VCM", "VREFN", "VREFP", "VDD", "VSS"], {
        BIDIR_TOP: "BIDIR_TOP",
        BIDIR_BOT: "BIDIR_BOT",
        BP: "B0",
        BPB: "B0B",
        BN: "B0B",
        BNB: "B0",
        VCM: "VCM",
        VREFN: "VREFN",
        VREFP: "VREFP",
        VDD: "VDD",
        VSS: "VSS",
      }),
      ...createCell("strongarm_comparator_offset_repaired", ["CLK", "INN", "INP", "OUTN", "OUTP", "VDD", "VSS"]),
      primitive("strongarm_comparator_offset_repaired", "MXCMP_TAIL", "nmos", ["D", "G", "S", "B"], { D: "TAIL", G: "CLK", S: "VSS", B: "VSS" }),
      ...createCell("sar_logic_register_dac_ctrl", ["CLK", "RST", "CMP", "CTRL", "DOUT", "VDD", "VSS"]),
      subckt("sar_logic_register_dac_ctrl", "XCTRL", "sar_bit_ctrl_buffer", ["IN", "OUT", "OUTB", "VDD", "VSS"], {
        IN: "CMP",
        OUT: "CTRL",
        OUTB: "CTRLB",
        VDD: "VDD",
        VSS: "VSS",
      }),
      subckt("sar_logic_register_dac_ctrl", "XDOUT", "sar_inv_only", ["IN", "OUT", "VDD", "VSS"], {
        IN: "CMP",
        OUT: "DOUT",
        VDD: "VDD",
        VSS: "VSS",
      }),
      ...createCell("sar_adc_10b_split_cdac_top", ["CLK", "DOUT", "RST", "VIN", "VREFN", "VREFP", "VCM", "OUTP", "OUTN", "VDD", "VSS"]),
      subckt("sar_adc_10b_split_cdac_top", "XCLKINV", "sar_inv_only", ["IN", "OUT", "VDD", "VSS"], {
        IN: "CLK",
        OUT: "CLKB",
        VDD: "VDD",
        VSS: "VSS",
      }),
      subckt("sar_adc_10b_split_cdac_top", "XSH0", "sample_hold_tgate_mos", ["VIN", "SAMPLED", "CLK", "CLKB", "VDD", "VSS"], {
        VIN: "VIN",
        SAMPLED: "SAMPLED",
        CLK: "CLK",
        CLKB: "CLKB",
        VDD: "VDD",
        VSS: "VSS",
      }),
      subckt("sar_adc_10b_split_cdac_top", "XCDAC0", "cdac_split_10b_from_code", ["BIDIR_TOP", "BIDIR_BOT", "CTRL", "VCM", "VREFN", "VREFP", "VDD", "VSS"], {
        BIDIR_TOP: "SAMPLED",
        BIDIR_BOT: "VCM",
        CTRL: "DAC_CTRL",
        VCM: "VCM",
        VREFN: "VREFN",
        VREFP: "VREFP",
        VDD: "VDD",
        VSS: "VSS",
      }),
      subckt("sar_adc_10b_split_cdac_top", "XCMP0", "strongarm_comparator_offset_repaired", ["CLK", "INN", "INP", "OUTN", "OUTP", "VDD", "VSS"], {
        CLK: "CLK",
        INN: "VCM",
        INP: "SAMPLED",
        OUTN: "OUTN",
        OUTP: "OUTP",
        VDD: "VDD",
        VSS: "VSS",
      }),
      subckt("sar_adc_10b_split_cdac_top", "XSAR0", "sar_logic_register_dac_ctrl", ["CLK", "RST", "CMP", "CTRL", "DOUT", "VDD", "VSS"], {
        CLK: "CLK",
        RST: "RST",
        CMP: "OUTP",
        CTRL: "DAC_CTRL",
        DOUT: "DOUT",
        VDD: "VDD",
        VSS: "VSS",
      }),
    ],
  };

  const rawResult = importCadenceBuildPlanAsSchematic(buildPlan, {
    topCell: "sar_adc_10b_split_cdac_top",
    project: "sar_raw_route_test",
  });
  const rawTerminalEntries = (rawResult.document.extensions?.cadenceTerminalNets as { entries?: Array<{ nodeId: string; portId: string; net: string }> } | undefined)?.entries ?? [];

  assert.equal(rawResult.document.properties.routedBy, "cadence_schematic_convertor_backend");
  assert.equal(rawResult.document.properties.semanticLayout, undefined);
  assert.equal(rawResult.summary.cellCount, 8);
  assert.ok(rawResult.summary.adapterWireCount > 0);
  assert.ok(rawTerminalEntries.length > 0, "default import must preserve converter terminal-net bindings");
  assert.equal(rawResult.document.edges.every((edge) => edge.style === "REFERENCE"), true);

  const result = importCadenceBuildPlanAsSchematic(buildPlan, {
    topCell: "sar_adc_10b_split_cdac_top",
    project: "sar_semantic_test",
    preferSemanticLayouts: true,
  });
  const children = hierarchyCellViews(result.document);
  const importedCellViews = [result.document, ...Object.values(children)];
  const cdac = Object.values(children).find((child) => child.cell === "cdac_split_10b_from_code");
  const bit = Object.values(children).find((child) => child.cell === "cdac_bit0_mos_switch_cell");
  const topConnectivity = extractConnectivity(result.document);
  const sampledNet = topConnectivity.logicalNets.find((net) => net.name === "SAMPLED");
  const clkNet = topConnectivity.logicalNets.find((net) => net.name === "CLK");
  const hasPortEdge = (document: typeof result.document, nodeId: string, portId = "P") =>
    document.edges.some((edge) =>
      ("nodeId" in edge.source && edge.source.nodeId === nodeId && edge.source.portId === portId)
      || ("nodeId" in edge.target && edge.target.nodeId === nodeId && edge.target.portId === portId));

  assert.equal(result.document.properties.semanticLayout, "sar_adc_hierarchy");
  assert.equal(result.summary.cellCount, 8);
  assert.equal(result.document.notes.length, 0);
  assert.equal(result.document.nodes.find((node) => node.instanceName === "XSH0")?.kind, "sampling_switch");
  assert.equal(result.document.nodes.find((node) => node.instanceName === "XCDAC0")?.kind, "cdac_array");
  assert.equal(result.document.nodes.find((node) => node.instanceName === "XCMP0")?.kind, "dynamic_comparator");
  assert.equal(result.document.nodes.find((node) => node.instanceName === "XSAR0")?.kind, "sar_logic");
  assert.ok(result.document.edges.length < 80);
  assert.ok(result.document.netLabels.length >= 8);
  assert.equal(
    result.document.edges.some((edge) => edge.id.includes("CLK") && edge.id.includes("_trunk")),
    false,
    "top-level clocks should use labelled stubs instead of crossing the analog signal path",
  );
  assert.equal(
    result.document.edges.some((edge) => edge.id.includes("VDD") && edge.id.includes("_trunk")),
    false,
    "top-level power rails should use labelled stubs instead of full-width trunk wires",
  );
  assert.ok(result.document.netLabels.some((label) => label.text === "CLK"));
  assert.ok(result.document.netLabels.some((label) => label.text === "VDD"));
  assert.ok(sampledNet && sampledNet.terminals.length >= 3, "SAMPLED should be one visible multi-terminal net");
  assert.ok(clkNet && clkNet.terminals.length >= 4, "CLK should be one visible multi-terminal net");
  assert.ok(
    result.document.edges.some((edge) => edge.id.includes("SAMPLED_XSH0:SAMPLED_XCDAC0:BIDIR_TOP")),
    "sample/hold output should visibly enter the CDAC top plate",
  );
  assert.ok(
    result.document.edges.some((edge) => edge.id.includes("SAMPLED_XCDAC0:BIDIR_TOP_XCMP0:INP")),
    "CDAC top plate should visibly drive the comparator input",
  );
  assert.ok(
    result.document.edges.some((edge) => edge.id.includes("OUTP_XCMP0:OUTP_XSAR0:CMP")),
    "comparator decision should visibly feed SAR logic",
  );
  assert.ok(
    result.document.edges.some((edge) => edge.id.includes("DAC_CTRL") && edge.id.includes("XSAR0") && edge.id.includes("XCDAC0")),
    "SAR DAC control bus should visibly feed the CDAC control port",
  );
  assert.ok(
    result.document.edges.some((edge) => edge.id.includes("VREFP") && edge.id.includes("XCDAC0")),
    "reference high should visibly enter the CDAC",
  );
  assert.ok(
    result.document.edges.some((edge) => edge.id.includes("VCM") && edge.id.includes("XCMP0")),
    "common-mode reference should visibly feed the comparator input",
  );
  const terminalEntries = (result.document.extensions?.cadenceTerminalNets as { entries?: Array<{ nodeId: string; portId: string }> } | undefined)?.entries ?? [];
  assert.ok(
    terminalEntries.length > 0,
    "SAR semantic import must preserve explicit terminal-net bindings from the build plan",
  );
  for (const entry of terminalEntries) {
    assert.equal(hasPortEdge(result.document, entry.nodeId, entry.portId), true, `${entry.nodeId}.${entry.portId} should have a visible incident route or labelled stub`);
  }
  const sampleHold = result.document.nodes.find((node) => node.instanceName === "XSH0");
  assert.equal(sampleHold?.properties.portOrder, "VIN,CLK,CLKB,SAMPLED,VDD,VSS");
  assert.equal(sampleHold?.properties.portOrderFull, "VIN,SAMPLED,CLK,CLKB,VDD,VSS");
  assert.equal(result.document.nodes.find((node) => node.instanceName === "XCDAC0")?.properties.hierarchyCell, "cdac_split_10b_from_code");
  assert.equal(cdac?.properties.semanticLayout, "sar_adc_hierarchy");
  assert.equal(cdac?.notes.length ?? 0, 0);
  assert.equal(cdac?.nodes.find((node) => node.instanceName === "XCU0")?.properties.hierarchyCell, "cdac_bit0_mos_switch_cell");
  assert.equal(bit?.properties.semanticLayout, "sar_adc_hierarchy");
  assert.equal(bit?.notes.length ?? 0, 0);
  assert.ok((bit?.netLabels.length ?? 0) >= 5);
  assert.equal(bit?.nodes.find((node) => node.instanceName === "MREFP0P")?.width, 64);
  assert.equal(bit?.nodes.find((node) => node.instanceName === "MREFP0P")?.height, 92);
  assert.equal(bit?.nodes.find((node) => node.instanceName === "VREFP")?.mirrored, true);
  for (const port of bit?.nodes.filter((node) => node.kind === "input" || node.kind === "output" || node.kind === "bidir") ?? []) {
    assert.equal(hasPortEdge(bit!, port.id), true, `${bit?.cell}.${port.instanceName} should have a visible incident wire`);
  }
  assert.ok((bit?.edges.length ?? 99) < 30);
  for (const document of importedCellViews) {
    const compiled = compileNetlist(document, "spectre");
    assert.equal(
      compiled.issues.some((issue) => issue.code === "MULTIPLE_EXPLICIT_NET_NAMES"),
      false,
      `${document.cell} should not merge distinct explicit net names`,
    );
    assert.equal(
      compiled.issues.some((issue) => issue.code === "DANGLING_WIRE"),
      false,
      `${document.cell} should terminate labelled import stubs cleanly`,
    );
  }
});

test("Cadence build_plan imports analogLib current sources as compact primitives", () => {
  const buildPlan = {
    operations: [
      { op: "create_library", lib: "AS_SOURCE_TEST" },
      { op: "create_cellview", lib: "AS_SOURCE_TEST", cell: "comparator", view: "schematic" },
      {
        op: "place_instance",
        lib: "AS_SOURCE_TEST",
        cell: "comparator",
        instance: "I_tail",
        source_kind: "primitive",
        source_primitive_type: "isource",
        logical_pin_order: ["PLUS", "MINUS"],
        connections: { PLUS: "vtail", MINUS: "vss" },
        logical_params: { dc: "20u" },
        params: { idc: "20u", srcType: "dc" },
        master: { lib: "analogLib", cell: "isource", view: "symbol" },
        xy: [360, -760],
        orient: "R0",
      },
      { op: "check_and_save", lib: "AS_SOURCE_TEST", cell: "comparator" },
    ],
  };

  const result = importCadenceBuildPlanAsSchematic(buildPlan, {
    topCell: "comparator",
    project: "source_test",
  });
  const source = result.document.nodes.find((node) => node.instanceName === "I_tail");
  const compiled = compileNetlist(result.document, "spectre");

  assert.equal(source?.kind, "isource");
  assert.equal(source?.properties.dc, "20u");
  assert.match(compiled.text, /^  I_tail \(vtail vss\) isource dc=20u$/m);
  assert.doesNotMatch(compiled.text, /cadenceMasterCell|port_A|NC NC/);
});

test("Cadence build_plan imports basic comparator as readable semantic schematic", () => {
  const baseInstance = {
    op: "place_instance",
    lib: "AS_CMP_TEST",
    cell: "comparator",
    source_kind: "primitive",
    logical_pin_order: ["D", "G", "S", "B"],
    orient: "R0",
  };
  const mosParams = { nf: "1", m: "1" };
  const buildPlan = {
    operations: [
      { op: "create_library", lib: "AS_CMP_TEST" },
      { op: "create_cellview", lib: "AS_CMP_TEST", cell: "comparator", view: "schematic" },
      { op: "create_pin", lib: "AS_CMP_TEST", cell: "comparator", pin: "vdd", direction: "inputOutput", order: 0, xy: [0, 700] },
      { op: "create_pin", lib: "AS_CMP_TEST", cell: "comparator", pin: "vinm", direction: "input", order: 1, xy: [450, 0] },
      { op: "create_pin", lib: "AS_CMP_TEST", cell: "comparator", pin: "vinp", direction: "input", order: 2, xy: [-450, 0] },
      { op: "create_pin", lib: "AS_CMP_TEST", cell: "comparator", pin: "vout", direction: "output", order: 3, xy: [700, 0] },
      { op: "create_pin", lib: "AS_CMP_TEST", cell: "comparator", pin: "vss", direction: "inputOutput", order: 4, xy: [0, -700] },
      {
        ...baseInstance,
        instance: "M1",
        source_primitive_type: "nmos",
        source_model: "n18",
        role: "diff_pair_left",
        connections: { D: "net1", G: "vinp", S: "vtail", B: "vss" },
        params: { ...mosParams, w: "5u", l: "500n" },
        master: { lib: "smic18mmrf", cell: "n18", view: "symbol" },
        xy: [-100, -200],
      },
      {
        ...baseInstance,
        instance: "M2",
        source_primitive_type: "nmos",
        source_model: "n18",
        role: "diff_pair_right",
        connections: { D: "net2", G: "vinm", S: "vtail", B: "vss" },
        params: { ...mosParams, w: "5u", l: "500n" },
        master: { lib: "smic18mmrf", cell: "n18", view: "symbol" },
        xy: [200, -200],
      },
      {
        ...baseInstance,
        instance: "M3",
        source_primitive_type: "pmos",
        source_model: "p18",
        role: "current_mirror_reference",
        connections: { D: "net1", G: "net1", S: "vdd", B: "vdd" },
        params: { ...mosParams, w: "10u", l: "500n" },
        master: { lib: "smic18mmrf", cell: "p18", view: "symbol" },
        xy: [-100, 200],
      },
      {
        ...baseInstance,
        instance: "M4",
        source_primitive_type: "pmos",
        source_model: "p18",
        role: "current_mirror_output",
        connections: { D: "net2", G: "net1", S: "vdd", B: "vdd" },
        params: { ...mosParams, w: "10u", l: "500n" },
        master: { lib: "smic18mmrf", cell: "p18", view: "symbol" },
        xy: [200, 200],
      },
      {
        ...baseInstance,
        instance: "M5",
        source_primitive_type: "pmos",
        source_model: "p18",
        role: "output_stage",
        connections: { D: "vout", G: "net2", S: "vdd", B: "vdd" },
        params: { ...mosParams, w: "4u", l: "180n" },
        master: { lib: "smic18mmrf", cell: "p18", view: "symbol" },
        xy: [500, 200],
      },
      {
        ...baseInstance,
        instance: "M6",
        source_primitive_type: "nmos",
        source_model: "n18",
        role: "output_stage",
        connections: { D: "vout", G: "net2", S: "vss", B: "vss" },
        params: { ...mosParams, w: "2u", l: "180n" },
        master: { lib: "smic18mmrf", cell: "n18", view: "symbol" },
        xy: [500, -200],
      },
      {
        op: "place_instance",
        lib: "AS_CMP_TEST",
        cell: "comparator",
        instance: "I_tail",
        source_kind: "primitive",
        source_primitive_type: "isource",
        logical_pin_order: ["PLUS", "MINUS"],
        connections: { PLUS: "vtail", MINUS: "vss" },
        logical_params: { dc: "20u" },
        params: { idc: "20u" },
        master: { lib: "analogLib", cell: "isource", view: "symbol" },
        xy: [0, -500],
        orient: "R0",
        role: "tail_source",
      },
      { op: "route_net", lib: "AS_CMP_TEST", cell: "comparator", net: "net1", segments: [[[-100, 200], [200, 200]]] },
      { op: "route_net", lib: "AS_CMP_TEST", cell: "comparator", net: "vdd", segments: [[[0, 700], [500, 700]]] },
      { op: "check_and_save", lib: "AS_CMP_TEST", cell: "comparator" },
    ],
  };

  const result = importCadenceBuildPlanAsSchematic(buildPlan, {
    topCell: "comparator",
    project: "cmp_test",
    preferSemanticLayouts: true,
  });
  const compiled = compileNetlist(result.document, "spectre");

  assert.equal(result.document.properties.semanticLayout, "basic_cmos_comparator");
  assert.equal(result.summary.routeSegmentCount, 0);
  assert.equal(result.summary.adapterWireCount, 0);
  assert.equal(result.document.edges.some((edge) => edge.style === "REFERENCE"), false);
  assert.deepEqual(compiled.issues.filter((issue) => issue.severity === "error"), []);
  assert.deepEqual(compiled.issues.filter((issue) => issue.code === "DANGLING_WIRE"), []);
  assert.match(compiled.text, /^  M1 \(net1 vinp vtail vss\) n18 w=5u l=500n m=1 nf=1$/m);
  assert.match(compiled.text, /^  M6 \(vout net2 vss vss\) n18 w=2u l=180n m=1 nf=1$/m);
  assert.match(compiled.text, /^  I_tail \(vtail vss\) isource dc=20u$/m);
});
