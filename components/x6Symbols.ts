import type { NodeMetadata } from "@antv/x6";
import { getSvg, symbols, type SchSymbol } from "schematic-symbols";
import {
  documentOriginToCanvasPosition,
  getDeviceDefinition,
  getPinPosition,
  type SchematicNode,
} from "../lib/schematic";

type SymbolMarkup = {
  tagName: string;
  selector?: string;
  children?: SymbolMarkup[];
};

const standardSymbols = symbols as unknown as Record<string, SchSymbol | undefined>;
const VIRTUOSO_LIGHT_DEVICE = "#f0cf62";
const VIRTUOSO_LIGHT_WIRE = "#61c5ff";
const VIRTUOSO_LIGHT_TERMINAL = "#ff5f69";
const standardSymbolNames: Partial<Record<SchematicNode["kind"], string>> = {
  diode: "diode_right",
  npn3: "npn_bipolar_transistor_vert",
  pnp3: "pnp_bipolar_transistor_vert",
  resistor: "resistor_right",
  capacitor: "capacitor_right",
  inductor: "inductor_right",
  isource: "current_source_up",
  switch4: "spst_switch_right",
  opamp3: "opamp_no_power_right",
};
const standardSymbolUris = new Map<SchematicNode["kind"], string>();

function standardSymbolUri(kind: SchematicNode["kind"]) {
  const cached = standardSymbolUris.get(kind);
  if (cached) return cached;
  const name = standardSymbolNames[kind];
  const symbol = name ? standardSymbols[name] : undefined;
  if (!symbol) return null;
  const svg = getSvg(symbol, { width: 180, height: 110 })
    .replace(/<text\b[^>]*>[\s\S]*?<\/text>/g, "")
    .replaceAll("black", VIRTUOSO_LIGHT_DEVICE);
  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  standardSymbolUris.set(kind, uri);
  return uri;
}

const path = (selector: string): SymbolMarkup => ({ tagName: "path", selector });
const line = (selector: string): SymbolMarkup => ({ tagName: "line", selector });
const circle = (selector: string): SymbolMarkup => ({ tagName: "circle", selector });
const polygon = (selector: string): SymbolMarkup => ({ tagName: "polygon", selector });
const rect = (selector: string): SymbolMarkup => ({ tagName: "rect", selector });
const textNode = (selector: string): SymbolMarkup => ({ tagName: "text", selector });

const macroKinds = new Set<SchematicNode["kind"]>([
  "transmission_gate",
  "sampling_switch",
  "cdac_array",
  "sar_logic",
  "dynamic_comparator",
  "diff_pair",
  "current_mirror",
  "bias_current",
  "gain_stage",
  "latch",
  "subckt4",
  "subckt5",
  "subckt6",
  "subckt7",
  "subckt8",
  "subckt9",
  "subckt10",
  "subckt11",
  "subckt12",
]);

function symbolMarkup(kind: SchematicNode["kind"]): SymbolMarkup[] {
  if (kind === "junction") return [circle("junction")];

  const symbolChildren: SymbolMarkup[] = [];
  const labelChildren: SymbolMarkup[] = [textNode("instanceLabel"), textNode("detailLabel")];
  const common: SymbolMarkup[] = [
    { tagName: "rect", selector: "body" },
    {
      tagName: "g",
      selector: "symbolGroup",
      children: symbolChildren,
    },
    {
      tagName: "g",
      selector: "labelGroup",
      children: labelChildren,
    },
  ];

  switch (kind) {
    case "nmos4":
    case "pmos4":
      symbolChildren.push(
        path("mosChannel"),
        path("mosGate"),
        path("mosDrain"),
        path("mosSource"),
        path("mosBulk"),
        path("mosArrow"),
      );
      labelChildren.push(
        textNode("mosModelLabel"),
        textNode("mosWidthLabel"),
        textNode("mosLengthLabel"),
        textNode("mosFingerLabel"),
        textNode("mosMultiplierLabel"),
      );
      break;
    case "diode":
    case "npn3":
    case "pnp3":
    case "resistor":
    case "capacitor":
    case "inductor":
    case "isource":
    case "switch4":
    case "opamp3":
      symbolChildren.push({ tagName: "image", selector: "librarySymbol" });
      break;
    case "vsource":
      symbolChildren.push(line("sourceLeadTop"), circle("sourceCircle"), line("sourceLeadBottom"), path("sourceMark"));
      break;
    case "vcvs":
    case "vccs":
      symbolChildren.push(line("sourceLeadTop"), polygon("diamondShape"), line("sourceLeadBottom"), line("controlLeadLeft"), line("controlLeadRight"), textNode("sourceGlyph"));
      break;
    case "transmission_gate":
      symbolChildren.push(
        rect("macroBody"),
        line("macroLeftLead"),
        line("macroRightLead"),
        path("macroSwitchBlade"),
        path("macroSwitchBladeB"),
        line("macroControlTop"),
        line("macroControlBottom"),
        circle("macroGateBubble"),
        textNode("macroTitle"),
      );
      break;
    case "sampling_switch":
      symbolChildren.push(
        rect("macroBody"),
        line("macroLeftLead"),
        line("macroRightLead"),
        path("macroSwitchBlade"),
        circle("macroSwitchContact"),
        line("macroHoldCapLead"),
        line("macroHoldCapTop"),
        line("macroHoldCapBottom"),
        line("macroHoldCapBottomLead"),
        textNode("macroTitle"),
      );
      break;
    case "cdac_array":
      symbolChildren.push(
        rect("macroBody"),
        line("cdacTopBus"),
        line("cdacBottomBus"),
        line("cdacCtrlBus"),
        line("cdacRefRail"),
        line("cdacCap0LeadTop"),
        line("cdacCap0Top"),
        line("cdacCap0Bottom"),
        line("cdacCap0LeadBottom"),
        line("cdacCap1LeadTop"),
        line("cdacCap1Top"),
        line("cdacCap1Bottom"),
        line("cdacCap1LeadBottom"),
        line("cdacCap2LeadTop"),
        line("cdacCap2Top"),
        line("cdacCap2Bottom"),
        line("cdacCap2LeadBottom"),
        textNode("macroTitle"),
      );
      break;
    case "sar_logic":
      symbolChildren.push(
        rect("macroBody"),
        rect("macroLogicCore"),
        line("sarBit0"),
        line("sarBit1"),
        line("sarBit2"),
        path("sarClockGlyph"),
        line("sarDacBus"),
        path("sarFeedback"),
        textNode("macroTitle"),
      );
      break;
    case "dynamic_comparator":
      symbolChildren.push(
        rect("macroBody"),
        polygon("macroComparatorCore"),
        textNode("cmpPlus"),
        textNode("cmpMinus"),
        line("cmpLatchTop"),
        line("cmpLatchBottom"),
        line("cmpClockStem"),
        line("cmpOutTop"),
        line("cmpOutBottom"),
        textNode("macroTitle"),
      );
      break;
    case "diff_pair":
    case "current_mirror":
    case "bias_current":
    case "gain_stage":
    case "latch":
    case "subckt4":
    case "subckt5":
    case "subckt6":
    case "subckt7":
    case "subckt8":
    case "subckt9":
    case "subckt10":
    case "subckt11":
    case "subckt12":
      symbolChildren.push(rect("macroBody"), path("macroAnalogCore"), line("macroLeftLead"), line("macroRightLead"), textNode("macroTitle"));
      break;
    case "vdd":
      symbolChildren.push(path("powerPath"));
      break;
    case "gnd":
      symbolChildren.push(path("groundPath"));
      break;
    case "input":
    case "output":
    case "bidir":
      symbolChildren.push(polygon("portShape"));
      break;
    case "netlabel":
      symbolChildren.push(path("labelLead"));
      break;
  }
  return common;
}

function detailText(node: SchematicNode) {
  if (node.kind === "diode" || node.kind === "npn3" || node.kind === "pnp3" || node.kind === "switch4") {
    return node.properties.model ?? "";
  }
  if (node.kind === "resistor" || node.kind === "capacitor" || node.kind === "inductor") {
    return node.properties.value ?? "";
  }
  if (node.kind === "vsource" || node.kind === "isource") return `dc=${node.properties.dc ?? "0"}`;
  if (node.kind === "vcvs") return `A=${node.properties.gain ?? "1"}`;
  if (node.kind === "vccs") return `gm=${node.properties.gm ?? "1m"}`;
  if (macroKinds.has(node.kind)) return node.properties.master ?? node.kind;
  if (["vdd", "gnd", "input", "output", "bidir", "netlabel"].includes(node.kind)) {
    return node.properties.netName ?? "";
  }
  return "";
}

function visiblePortText(node: SchematicNode): string {
  const netName = node.properties.netName?.trim();
  if (netName) return netName;
  return node.instanceName.replace(/^(INPUT|OUTPUT|BIDIR)_/i, "");
}

function netTextColor(text: string): string {
  const normalized = text.trim().toUpperCase();
  if (normalized === "VDD" || normalized === "VSS" || normalized === "GND" || normalized === "0") {
    return `var(--schematic-power-label, ${VIRTUOSO_LIGHT_TERMINAL})`;
  }
  if (normalized.includes("CLK") || normalized.includes("RST")) return `var(--schematic-net-label, ${VIRTUOSO_LIGHT_TERMINAL})`;
  return `var(--schematic-net-label, ${VIRTUOSO_LIGHT_TERMINAL})`;
}

function netLabelTextAnchor(node: SchematicNode): "start" | "middle" | "end" {
  const alignment = node.properties.textAlignment;
  return alignment === "middle" || alignment === "end" ? alignment : "start";
}

function macroTitleForKind(kind: SchematicNode["kind"]): string {
  if (kind === "dynamic_comparator") return "COMP";
  if (kind === "transmission_gate") return "TG";
  if (kind === "sampling_switch") return "S/H";
  if (kind === "cdac_array") return "CDAC";
  if (kind === "sar_logic") return "SAR";
  if (kind === "diff_pair") return "DIFF";
  if (kind === "current_mirror") return "MIR";
  if (kind === "bias_current") return "BIAS";
  if (kind === "gain_stage") return "GAIN";
  if (kind === "latch") return "LATCH";
  if (kind === "subckt4") return "X4";
  if (kind === "subckt5") return "X5";
  if (kind === "subckt6") return "X6";
  if (kind === "subckt7") return "X7";
  if (kind === "subckt8") return "X8";
  if (kind === "subckt9") return "X9";
  if (kind === "subckt10") return "X10";
  if (kind === "subckt11") return "X11";
  if (kind === "subckt12") return "X12";
  return "X";
}

function symbolAttrs(node: SchematicNode) {
  const { width, height, kind } = node;
  const ink = "var(--schematic-symbol-ink, #323130)";
  const wire = `var(--schematic-device-stroke, ${VIRTUOSO_LIGHT_DEVICE})`;
  const schematicWire = `var(--schematic-wire-stroke, ${VIRTUOSO_LIGHT_WIRE})`;
  const netRed = `var(--schematic-net-label, ${VIRTUOSO_LIGHT_TERMINAL})`;
  const textMuted = "var(--schematic-text-muted, #605e5c)";
  const textHalo = "var(--schematic-text-halo, #ffffff)";
  const labelY = Math.max(11, height - 4);
  const attrs: Record<string, Record<string, string | number | boolean>> = {
    body: { x: 1, y: 1, width: width - 2, height: height - 2, rx: 2, ry: 2, fill: "transparent", stroke: "transparent", strokeWidth: 1 },
    symbolGroup: { transform: node.mirrored ? `translate(${width} 0) scale(-1 1)` : "" },
    labelGroup: { transform: node.rotation ? `rotate(${-node.rotation} ${width / 2} ${height / 2})` : "" },
    instanceLabel: { x: width / 2, y: 11, refX: 0, refY: 0, text: node.instanceName, fill: ink, fontSize: 10, fontFamily: "Cascadia Mono, Consolas, monospace", fontWeight: 700, textAnchor: "middle", textVerticalAnchor: "middle", pointerEvents: "none" },
    detailLabel: { x: width / 2, y: labelY, refX: 0, refY: 0, text: detailText(node), fill: textMuted, fontSize: 8, fontFamily: "Cascadia Mono, Consolas, monospace", textAnchor: "middle", textVerticalAnchor: "middle", pointerEvents: "none" },
  };

  if (kind === "nmos4" || kind === "pmos4") {
    const centerY = height / 2;
    const terminalX = width - 10;
    const channelX = terminalX - 12;
    const gateX = channelX - 15;
    const channelTop = 14;
    const channelBottom = height - 14;
    const sourceY = kind === "pmos4" ? channelTop : channelBottom;
    const sourcePinY = kind === "pmos4" ? 0 : height;
    const drainY = kind === "pmos4" ? channelBottom : channelTop;
    const drainPinY = kind === "pmos4" ? height : 0;
    attrs.mosChannel = { d: `M ${channelX} ${channelTop} L ${channelX} ${channelBottom}`, fill: "none", stroke: wire, strokeWidth: 1.9 };
    attrs.mosGate = { d: `M 0 ${centerY} L ${gateX - 5} ${centerY} M ${gateX} ${channelTop} L ${gateX} ${channelBottom}`, fill: "none", stroke: wire, strokeWidth: 1.7 };
    attrs.mosDrain = { d: `M ${channelX} ${drainY} L ${terminalX} ${drainY} L ${terminalX} ${drainPinY}`, fill: "none", stroke: wire, strokeWidth: 1.7 };
    attrs.mosSource = { d: `M ${channelX} ${sourceY} L ${terminalX} ${sourceY} L ${terminalX} ${sourcePinY}`, fill: "none", stroke: wire, strokeWidth: 1.7 };
    attrs.mosBulk = { d: `M ${channelX} ${centerY} L ${terminalX} ${centerY}`, fill: "none", stroke: wire, strokeWidth: 1.5 };
    attrs.mosArrow = {
      d: kind === "nmos4"
        ? `M ${channelX + 2} ${sourceY - 4} L ${terminalX - 1} ${sourceY} L ${channelX + 2} ${sourceY + 4}`
        : `M ${terminalX - 2} ${sourceY - 4} L ${channelX + 1} ${sourceY} L ${terminalX - 2} ${sourceY + 4}`,
      fill: "none",
      stroke: wire,
      strokeWidth: 1.45,
      strokeLinejoin: "miter",
      strokeLinecap: "square",
    };
    const visibleRightEdge = node.rotation % 180 === 0
      ? (node.rotation === 180 || node.mirrored ? width : terminalX)
      : width / 2 + height / 2;
    const annotationX = visibleRightEdge + 4;
    const annotationTop = Math.max(12, centerY - 8);
    const annotationLineHeight = 13;
    const annotationStyle = {
      x: annotationX,
      refX: 0,
      refY: 0,
      fill: textMuted,
      fontSize: 9,
      fontFamily: "Cascadia Mono, Consolas, monospace",
      textAnchor: "start",
      textVerticalAnchor: "middle",
      pointerEvents: "none",
      paintOrder: "stroke fill",
      stroke: textHalo,
      strokeWidth: 1,
      strokeLinejoin: "round",
    };
    attrs.instanceLabel = {
      ...annotationStyle,
      x: 2,
      y: 11,
      text: node.instanceName,
      fill: ink,
      fontSize: 11,
      fontWeight: 700,
    };
    attrs.detailLabel.text = "";
    attrs.mosModelLabel = {
      ...annotationStyle,
      y: annotationTop,
      text: `"${node.properties.model ?? (kind === "pmos4" ? "pmos" : "nmos")}"`,
    };
    attrs.mosWidthLabel = {
      ...annotationStyle,
      y: annotationTop + annotationLineHeight,
      text: `W/L ${node.properties.W ?? "—"}/${node.properties.L ?? "—"}`,
    };
    attrs.mosLengthLabel = {
      ...annotationStyle,
      y: annotationTop + annotationLineHeight * 2,
      text: "",
    };
    attrs.mosFingerLabel = {
      ...annotationStyle,
      y: annotationTop + annotationLineHeight * 3,
      text: "",
    };
    attrs.mosMultiplierLabel = {
      ...annotationStyle,
      y: annotationTop + annotationLineHeight * 4,
      text: "",
    };
  } else if (kind === "diode" || kind === "npn3" || kind === "pnp3" || kind === "resistor" || kind === "capacitor" || kind === "inductor" || kind === "isource" || kind === "switch4" || kind === "opamp3") {
    const uri = standardSymbolUri(kind);
    attrs.librarySymbol = {
      x: kind === "isource" ? 13 : kind === "opamp3" ? 7 : 5,
      y: kind === "isource" ? 14 : kind === "opamp3" ? 11 : 11,
      width: kind === "isource" ? width - 26 : kind === "opamp3" ? width - 14 : width - 10,
      height: kind === "isource" ? height - 28 : kind === "opamp3" ? height - 24 : height - 22,
      href: uri ?? "",
      xlinkHref: uri ?? "",
      preserveAspectRatio: "xMidYMid meet",
      pointerEvents: "none",
    };
  } else if (kind === "vcvs" || kind === "vccs") {
    attrs.sourceLeadTop = { x1: width / 2, y1: 0, x2: width / 2, y2: 18, stroke: wire, strokeWidth: 1.05 };
    attrs.sourceLeadBottom = { x1: width / 2, y1: height - 18, x2: width / 2, y2: height, stroke: wire, strokeWidth: 1.05 };
    attrs.controlLeadLeft = { x1: 0, y1: height / 2, x2: 18, y2: height / 2, stroke: wire, strokeWidth: 1 };
    attrs.controlLeadRight = { x1: width - 18, y1: height / 2, x2: width, y2: height / 2, stroke: wire, strokeWidth: 1 };
    attrs.diamondShape = { points: `${width / 2},17 ${width - 18},${height / 2} ${width / 2},${height - 17} 18,${height / 2}`, fill: "var(--schematic-source-fill, #fff)", stroke: wire, strokeWidth: 1.05 };
    attrs.sourceGlyph = { x: width / 2, y: height / 2 + 3, text: kind === "vcvs" ? "E" : "G", fill: ink, fontSize: 16, fontFamily: "Cascadia Mono, Consolas, monospace", fontWeight: 700, textAnchor: "middle", textVerticalAnchor: "middle", pointerEvents: "none" };
  } else if (macroKinds.has(kind)) {
    const title = macroTitleForKind(kind);
    const bodyX = 5;
    const bodyY = 8;
    const bodyW = width - 10;
    const bodyH = height - 16;
    const left = bodyX + 10;
    const right = width - bodyX - 10;
    const top = bodyY + 13;
    const bottom = height - bodyY - 13;
    const midX = width / 2;
    const midY = height / 2;
    const deviceLine = {
      fill: "none",
      stroke: wire,
      strokeWidth: 1.05,
      strokeLinecap: "square",
      strokeLinejoin: "miter",
      pointerEvents: "none",
    };
    const routeLine = {
      fill: "none",
      stroke: schematicWire,
      strokeWidth: 1,
      strokeLinecap: "square",
      strokeLinejoin: "miter",
      pointerEvents: "none",
    };

    attrs.macroBody = { x: bodyX, y: bodyY, width: bodyW, height: bodyH, rx: 1, ry: 1, fill: "var(--schematic-macro-fill, #fbfcfe)", stroke: ink, strokeWidth: 1.05 };
    attrs.macroTitle = { x: width / 2, y: height / 2 + 3, text: title, fill: ink, fontSize: 13, fontFamily: "Cascadia Mono, Consolas, monospace", fontWeight: 800, textAnchor: "middle", textVerticalAnchor: "middle", pointerEvents: "none" };

    if (kind === "transmission_gate") {
      attrs.macroTitle = { ...attrs.macroTitle, y: bodyY + 15, fontSize: 11 };
      attrs.macroLeftLead = { x1: left, y1: midY, x2: midX - 25, y2: midY, ...routeLine };
      attrs.macroRightLead = { x1: midX + 25, y1: midY, x2: right, y2: midY, ...routeLine };
      attrs.macroSwitchBlade = { d: `M ${midX - 24} ${midY - 8} L ${midX + 18} ${midY - 15}`, ...deviceLine };
      attrs.macroSwitchBladeB = { d: `M ${midX - 24} ${midY + 8} L ${midX + 18} ${midY + 15}`, ...deviceLine };
      attrs.macroControlTop = { x1: midX, y1: bodyY + 7, x2: midX, y2: midY - 17, ...routeLine };
      attrs.macroControlBottom = { x1: midX, y1: midY + 17, x2: midX, y2: height - bodyY - 7, ...routeLine };
      attrs.macroGateBubble = { cx: midX + 20, cy: midY + 15, r: 2.2, fill: "var(--schematic-macro-fill, #fbfcfe)", stroke: wire, strokeWidth: 1 };
    } else if (kind === "sampling_switch") {
      attrs.macroTitle = { ...attrs.macroTitle, y: bodyY + 15, fontSize: 11 };
      attrs.macroLeftLead = { x1: left, y1: midY, x2: midX - 24, y2: midY, ...routeLine };
      attrs.macroRightLead = { x1: midX + 23, y1: midY, x2: right, y2: midY, ...routeLine };
      attrs.macroSwitchBlade = { d: `M ${midX - 24} ${midY} L ${midX + 10} ${midY - 12}`, ...deviceLine };
      attrs.macroSwitchContact = { cx: midX + 17, cy: midY, r: 2.5, fill: "var(--schematic-macro-fill, #fbfcfe)", stroke: wire, strokeWidth: 1 };
      attrs.macroHoldCapLead = { x1: midX + 28, y1: midY, x2: midX + 28, y2: midY + 14, ...routeLine };
      attrs.macroHoldCapTop = { x1: midX + 17, y1: midY + 15, x2: midX + 39, y2: midY + 15, ...deviceLine };
      attrs.macroHoldCapBottom = { x1: midX + 17, y1: midY + 21, x2: midX + 39, y2: midY + 21, ...deviceLine };
      attrs.macroHoldCapBottomLead = { x1: midX + 28, y1: midY + 21, x2: midX + 28, y2: bottom, ...routeLine };
    } else if (kind === "cdac_array") {
      const topBusY = bodyY + 31;
      const bottomBusY = height - bodyY - 25;
      const capXs = [bodyX + bodyW * 0.3, midX, bodyX + bodyW * 0.7];
      attrs.macroTitle = { ...attrs.macroTitle, y: bodyY + 16, fontSize: 11 };
      attrs.cdacTopBus = { x1: left, y1: topBusY, x2: right, y2: topBusY, ...routeLine };
      attrs.cdacBottomBus = { x1: left, y1: bottomBusY, x2: right, y2: bottomBusY, ...routeLine };
      attrs.cdacCtrlBus = { x1: bodyX + 6, y1: midY, x2: left + 6, y2: midY, ...routeLine };
      attrs.cdacRefRail = { x1: right - 8, y1: topBusY + 10, x2: right, y2: topBusY + 10, ...routeLine };
      attrs.cdacCap0LeadTop = { x1: capXs[0], y1: topBusY, x2: capXs[0], y2: topBusY + 10, ...routeLine };
      attrs.cdacCap0Top = { x1: capXs[0] - 10, y1: topBusY + 10, x2: capXs[0] + 10, y2: topBusY + 10, ...deviceLine };
      attrs.cdacCap0Bottom = { x1: capXs[0] - 10, y1: topBusY + 17, x2: capXs[0] + 10, y2: topBusY + 17, ...deviceLine };
      attrs.cdacCap0LeadBottom = { x1: capXs[0], y1: topBusY + 17, x2: capXs[0], y2: bottomBusY, ...routeLine };
      attrs.cdacCap1LeadTop = { x1: capXs[1], y1: topBusY, x2: capXs[1], y2: topBusY + 10, ...routeLine };
      attrs.cdacCap1Top = { x1: capXs[1] - 10, y1: topBusY + 10, x2: capXs[1] + 10, y2: topBusY + 10, ...deviceLine };
      attrs.cdacCap1Bottom = { x1: capXs[1] - 10, y1: topBusY + 17, x2: capXs[1] + 10, y2: topBusY + 17, ...deviceLine };
      attrs.cdacCap1LeadBottom = { x1: capXs[1], y1: topBusY + 17, x2: capXs[1], y2: bottomBusY, ...routeLine };
      attrs.cdacCap2LeadTop = { x1: capXs[2], y1: topBusY, x2: capXs[2], y2: topBusY + 10, ...routeLine };
      attrs.cdacCap2Top = { x1: capXs[2] - 10, y1: topBusY + 10, x2: capXs[2] + 10, y2: topBusY + 10, ...deviceLine };
      attrs.cdacCap2Bottom = { x1: capXs[2] - 10, y1: topBusY + 17, x2: capXs[2] + 10, y2: topBusY + 17, ...deviceLine };
      attrs.cdacCap2LeadBottom = { x1: capXs[2], y1: topBusY + 17, x2: capXs[2], y2: bottomBusY, ...routeLine };
    } else if (kind === "dynamic_comparator") {
      const coreLeft = bodyX + 28;
      const coreRight = width - bodyX - 28;
      attrs.macroTitle = { ...attrs.macroTitle, y: bodyY + 16, fontSize: 11 };
      attrs.macroComparatorCore = {
        points: `${coreLeft},${top + 4} ${coreRight},${midY} ${coreLeft},${bottom - 4}`,
        fill: "transparent",
        stroke: wire,
        strokeWidth: 1.05,
        pointerEvents: "none",
      };
      attrs.cmpPlus = { x: coreLeft - 12, y: midY - 12, text: "+", fill: netRed, fontSize: 12, fontFamily: "Cascadia Mono, Consolas, monospace", fontWeight: 800, textAnchor: "middle", textVerticalAnchor: "middle", pointerEvents: "none" };
      attrs.cmpMinus = { x: coreLeft - 12, y: midY + 14, text: "-", fill: netRed, fontSize: 12, fontFamily: "Cascadia Mono, Consolas, monospace", fontWeight: 800, textAnchor: "middle", textVerticalAnchor: "middle", pointerEvents: "none" };
      attrs.cmpLatchTop = { x1: coreRight - 29, y1: midY - 13, x2: coreRight - 10, y2: midY + 10, ...deviceLine };
      attrs.cmpLatchBottom = { x1: coreRight - 29, y1: midY + 13, x2: coreRight - 10, y2: midY - 10, ...deviceLine };
      attrs.cmpClockStem = { x1: midX, y1: bodyY + 7, x2: midX, y2: top + 4, ...routeLine };
      attrs.cmpOutTop = { x1: coreRight - 1, y1: midY - 8, x2: right, y2: midY - 8, ...routeLine };
      attrs.cmpOutBottom = { x1: coreRight - 1, y1: midY + 8, x2: right, y2: midY + 8, ...routeLine };
    } else if (kind === "sar_logic") {
      const coreX = bodyX + 22;
      const coreY = bodyY + 21;
      const coreW = bodyW - 44;
      const coreH = bodyH - 42;
      attrs.macroTitle = { ...attrs.macroTitle, y: midY + 4, fontSize: 12 };
      attrs.macroLogicCore = { x: coreX, y: coreY, width: coreW, height: coreH, rx: 1, ry: 1, fill: "transparent", stroke: ink, strokeWidth: 0.9, pointerEvents: "none" };
      attrs.sarBit0 = { x1: coreX + 8, y1: coreY + 9, x2: coreX + coreW - 8, y2: coreY + 9, ...routeLine };
      attrs.sarBit1 = { x1: coreX + 8, y1: coreY + coreH / 2, x2: coreX + coreW - 8, y2: coreY + coreH / 2, ...routeLine };
      attrs.sarBit2 = { x1: coreX + 8, y1: coreY + coreH - 9, x2: coreX + coreW - 8, y2: coreY + coreH - 9, ...routeLine };
      attrs.sarClockGlyph = { d: `M ${bodyX + 10} ${bottom - 10} h 9 l 4 -6 l 5 6 h 10`, ...deviceLine };
      attrs.sarDacBus = { x1: coreX + coreW, y1: midY + 16, x2: right, y2: midY + 16, ...routeLine };
      attrs.sarFeedback = { d: `M ${right - 3} ${midY - 16} H ${midX + 8} V ${top + 7}`, ...routeLine };
    } else {
      attrs.macroTitle = { ...attrs.macroTitle, y: bodyY + 16, fontSize: 11 };
      attrs.macroAnalogCore = {
        d: `M ${left} ${midY} H ${midX - 16} M ${midX - 16} ${midY + 12} V ${midY - 12} L ${midX + 18} ${midY} L ${midX - 16} ${midY + 12} M ${midX + 18} ${midY} H ${right}`,
        ...deviceLine,
      };
      attrs.macroLeftLead = { x1: bodyX + 6, y1: midY, x2: left, y2: midY, ...routeLine };
      attrs.macroRightLead = { x1: right, y1: midY, x2: width - bodyX - 6, y2: midY, ...routeLine };
    }
  } else if (kind === "vsource") {
    attrs.sourceLeadTop = { x1: width / 2, y1: 0, x2: width / 2, y2: 22, stroke: wire, strokeWidth: 1.2 };
    attrs.sourceCircle = { cx: width / 2, cy: height / 2, r: 22, fill: "var(--schematic-source-fill, #ffffff)", stroke: wire, strokeWidth: 1.2 };
    attrs.sourceLeadBottom = { x1: width / 2, y1: height - 22, x2: width / 2, y2: height, stroke: wire, strokeWidth: 1.2 };
    attrs.sourceMark = { d: `M ${width / 2 - 6} ${height / 2 - 8} L ${width / 2 + 6} ${height / 2 - 8} M ${width / 2} ${height / 2 - 14} L ${width / 2} ${height / 2 - 2} M ${width / 2 - 6} ${height / 2 + 9} L ${width / 2 + 6} ${height / 2 + 9}`, fill: "none", stroke: wire, strokeWidth: 1.1 };
  } else if (kind === "vdd") {
    attrs.powerPath = { d: `M ${width / 2} ${height} L ${width / 2} 20 M ${width / 2} 20 L ${width / 2 - 8} 30 M ${width / 2} 20 L ${width / 2 + 8} 30`, fill: "none", stroke: "var(--schematic-power-stroke, #3c8467)", strokeWidth: 1.2 };
    attrs.instanceLabel.y = 13; attrs.detailLabel.text = "";
  } else if (kind === "gnd") {
    attrs.groundPath = { d: `M ${width / 2} 0 L ${width / 2} 20 M ${width / 2 - 13} 20 L ${width / 2 + 13} 20 M ${width / 2 - 8} 26 L ${width / 2 + 8} 26 M ${width / 2 - 3} 32 L ${width / 2 + 3} 32`, fill: "none", stroke: "var(--schematic-power-stroke, #3c8467)", strokeWidth: 1.2 };
    attrs.instanceLabel.y = height - 2; attrs.detailLabel.text = "";
  } else if (kind === "input" || kind === "output" || kind === "bidir") {
    const rightFacing = kind !== "output";
    attrs.portShape = { points: rightFacing ? `0,8 ${width - 14},8 ${width},${height / 2} ${width - 14},${height - 8} 0,${height - 8}` : `${width},8 14,8 0,${height / 2} 14,${height - 8} ${width},${height - 8}`, fill: "var(--schematic-port-fill, #f5f9fd)", stroke: `var(--schematic-port-stroke, ${VIRTUOSO_LIGHT_TERMINAL})`, strokeWidth: 1.1 };
    attrs.instanceLabel.y = height / 2 + 3;
    attrs.instanceLabel.fontSize = 9;
    attrs.instanceLabel.text = visiblePortText(node);
    attrs.detailLabel.text = "";
  } else if (kind === "netlabel") {
    const hidden = node.properties.displayHidden === "true";
    const text = node.properties.netName ?? node.instanceName;
    const anchor = netLabelTextAnchor(node);
    attrs.body = { ...attrs.body, width: width + 80, fill: "transparent", stroke: "transparent", pointerEvents: hidden ? "none" : "visiblePainted" };
    attrs.symbolGroup.opacity = hidden ? 0 : 1;
    attrs.labelGroup.opacity = hidden ? 0 : 1;
    attrs.labelLead = { d: "", fill: "none", stroke: "transparent", strokeWidth: 0 };
    attrs.instanceLabel = {
      x: anchor === "end" ? -4 : anchor === "middle" ? 0 : 4,
      y: height / 2 + 3,
      text,
      fill: netTextColor(text),
      fontSize: 10.5,
      fontFamily: "Cascadia Mono, Consolas, monospace",
      fontWeight: 700,
      textAnchor: anchor,
      textVerticalAnchor: "middle",
      pointerEvents: "none",
      paintOrder: "stroke fill",
      stroke: textHalo,
      strokeWidth: 1.8,
      strokeLinejoin: "round",
    };
    attrs.detailLabel.text = "";
  } else if (kind === "junction") {
    attrs.junction = { cx: width / 2, cy: height / 2, r: 3, fill: `var(--schematic-junction-fill, ${VIRTUOSO_LIGHT_WIRE})`, stroke: "none", strokeWidth: 0 };
  }
  return attrs;
}

export function createX6NodeMetadata(node: SchematicNode): NodeMetadata {
  const definition = getDeviceDefinition(node.kind);
  const canvasPosition = documentOriginToCanvasPosition(node);
  const utilityTextNode = node.kind === "junction" || node.kind === "netlabel";
  return {
    id: node.id,
    shape: "rect",
    x: canvasPosition.x,
    y: canvasPosition.y,
    width: node.width,
    height: node.height,
    angle: node.rotation,
    markup: symbolMarkup(node.kind),
    attrs: symbolAttrs(node),
    data: node,
    zIndex: node.kind === "junction" ? 5 : 2,
    ports: {
      groups: {
        pin: {
          position: { name: "absolute" },
          markup: [{
            tagName: utilityTextNode ? "circle" : "rect",
            selector: "portBody",
            className: utilityTextNode ? "junction-port-hit" : "terminal-port",
          }],
          attrs: {
            portBody: utilityTextNode
              ? {
                  r: 6,
                  magnet: true,
                  fill: "transparent",
                  stroke: "transparent",
                  strokeWidth: 0,
                }
              : {
                  x: -2.5,
                  y: -2.5,
                  width: 5,
                  height: 5,
                  rx: 0,
                  ry: 0,
                  magnet: true,
                  fill: `var(--schematic-terminal-fill, ${VIRTUOSO_LIGHT_TERMINAL})`,
                  stroke: `var(--schematic-terminal-fill, ${VIRTUOSO_LIGHT_TERMINAL})`,
                  strokeWidth: 0.8,
                },
          },
        },
      },
      items: definition.pins.map((pin) => {
        const position = getPinPosition(pin, node);
        return {
          id: pin.id,
          group: "pin",
          args: { x: position.x, y: position.y },
        };
      }),
    },
  };
}

export function getNodeVisualAttrs(node: SchematicNode) {
  return symbolAttrs(node);
}
