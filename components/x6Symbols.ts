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
const standardSymbolNames: Partial<Record<SchematicNode["kind"], string>> = {
  resistor: "resistor_right",
  capacitor: "capacitor_right",
  inductor: "inductor_right",
  isource: "current_source_up",
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
    .replaceAll("black", "#484644");
  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  standardSymbolUris.set(kind, uri);
  return uri;
}

const path = (selector: string): SymbolMarkup => ({ tagName: "path", selector });
const line = (selector: string): SymbolMarkup => ({ tagName: "line", selector });
const circle = (selector: string): SymbolMarkup => ({ tagName: "circle", selector });
const polygon = (selector: string): SymbolMarkup => ({ tagName: "polygon", selector });
const textNode = (selector: string): SymbolMarkup => ({ tagName: "text", selector });

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
    case "resistor":
    case "capacitor":
    case "inductor":
    case "isource":
      symbolChildren.push({ tagName: "image", selector: "librarySymbol" });
      break;
    case "vsource":
      symbolChildren.push(line("sourceLeadTop"), circle("sourceCircle"), line("sourceLeadBottom"), path("sourceMark"));
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
      symbolChildren.push(path("labelLead"), polygon("labelShape"));
      break;
  }
  return common;
}

function detailText(node: SchematicNode) {
  if (node.kind === "resistor" || node.kind === "capacitor" || node.kind === "inductor") {
    return node.properties.value ?? "";
  }
  if (node.kind === "vsource" || node.kind === "isource") return `dc=${node.properties.dc ?? "0"}`;
  if (["vdd", "gnd", "input", "output", "bidir", "netlabel"].includes(node.kind)) {
    return node.properties.netName ?? "";
  }
  return "";
}

function symbolAttrs(node: SchematicNode) {
  const { width, height, kind } = node;
  const ink = "#323130";
  const wire = "#484644";
  const labelY = Math.max(11, height - 4);
  const attrs: Record<string, Record<string, string | number | boolean>> = {
    body: { x: 1, y: 1, width: width - 2, height: height - 2, rx: 2, ry: 2, fill: "transparent", stroke: "transparent", strokeWidth: 1 },
    symbolGroup: { transform: node.mirrored ? `translate(${width} 0) scale(-1 1)` : "" },
    labelGroup: { transform: node.rotation ? `rotate(${-node.rotation} ${width / 2} ${height / 2})` : "" },
    instanceLabel: { x: width / 2, y: 11, refX: 0, refY: 0, text: node.instanceName, fill: ink, fontSize: 10, fontFamily: "Cascadia Mono, Consolas, monospace", fontWeight: 700, textAnchor: "middle", textVerticalAnchor: "middle", pointerEvents: "none" },
    detailLabel: { x: width / 2, y: labelY, refX: 0, refY: 0, text: detailText(node), fill: "#605e5c", fontSize: 8, fontFamily: "Cascadia Mono, Consolas, monospace", textAnchor: "middle", textVerticalAnchor: "middle", pointerEvents: "none" },
  };

  if (kind === "nmos4" || kind === "pmos4") {
    const centerY = height / 2;
    const terminalX = width - 10;
    const channelX = terminalX - 10;
    const gateX = channelX - 10;
    const channelTop = 20;
    const channelBottom = height - 20;
    const sourceY = kind === "pmos4" ? channelTop : channelBottom;
    const sourcePinY = kind === "pmos4" ? 0 : height;
    const drainY = kind === "pmos4" ? channelBottom : channelTop;
    const drainPinY = kind === "pmos4" ? height : 0;
    attrs.mosChannel = { d: `M ${channelX} ${channelTop} L ${channelX} ${channelBottom}`, fill: "none", stroke: wire, strokeWidth: 1.8 };
    attrs.mosGate = { d: `M 0 ${centerY} L ${gateX - 5} ${centerY} M ${gateX} ${channelTop} L ${gateX} ${channelBottom}`, fill: "none", stroke: wire, strokeWidth: 1.6 };
    attrs.mosDrain = { d: `M ${channelX} ${drainY} L ${terminalX} ${drainY} L ${terminalX} ${drainPinY}`, fill: "none", stroke: wire, strokeWidth: 1.6 };
    attrs.mosSource = { d: `M ${channelX} ${sourceY} L ${terminalX} ${sourceY} L ${terminalX} ${sourcePinY}`, fill: "none", stroke: wire, strokeWidth: 1.6 };
    attrs.mosBulk = { d: `M ${channelX} ${centerY} L ${terminalX} ${centerY}`, fill: "none", stroke: wire, strokeWidth: 1.4 };
    attrs.mosArrow = {
      d: kind === "nmos4"
        ? `M ${channelX + 2} ${sourceY - 4} L ${terminalX - 1} ${sourceY} L ${channelX + 2} ${sourceY + 4}`
        : `M ${terminalX - 2} ${sourceY - 4} L ${channelX + 1} ${sourceY} L ${terminalX - 2} ${sourceY + 4}`,
      fill: "none",
      stroke: wire,
      strokeWidth: 1.4,
      strokeLinejoin: "miter",
      strokeLinecap: "square",
    };
    const visibleRightEdge = node.rotation % 180 === 0
      ? (node.rotation === 180 || node.mirrored ? width : terminalX)
      : width / 2 + height / 2;
    const annotationX = visibleRightEdge + 4;
    const annotationTop = 10;
    const annotationLineHeight = 11;
    const annotationStyle = {
      x: annotationX,
      refX: 0,
      refY: 0,
      fill: "#605e5c",
      fontSize: 8,
      fontFamily: "Cascadia Mono, Consolas, monospace",
      textAnchor: "start",
      textVerticalAnchor: "middle",
      pointerEvents: "none",
      paintOrder: "stroke fill",
      stroke: "#ffffff",
      strokeWidth: 1,
      strokeLinejoin: "round",
    };
    attrs.instanceLabel = {
      ...annotationStyle,
      y: annotationTop,
      text: node.instanceName,
      fill: ink,
      fontSize: 9,
      fontWeight: 700,
    };
    attrs.detailLabel.text = "";
    attrs.mosModelLabel = {
      ...annotationStyle,
      y: annotationTop + annotationLineHeight,
      text: `"${node.properties.model ?? (kind === "pmos4" ? "pmos" : "nmos")}"`,
    };
    attrs.mosWidthLabel = {
      ...annotationStyle,
      y: annotationTop + annotationLineHeight * 2,
      text: `w:${node.properties.W ?? "—"}`,
    };
    attrs.mosLengthLabel = {
      ...annotationStyle,
      y: annotationTop + annotationLineHeight * 3,
      text: `l:${node.properties.L ?? "—"}`,
    };
    attrs.mosFingerLabel = {
      ...annotationStyle,
      y: annotationTop + annotationLineHeight * 4,
      text: `fingers:${node.properties.NF ?? "1"}`,
    };
    attrs.mosMultiplierLabel = {
      ...annotationStyle,
      y: annotationTop + annotationLineHeight * 5,
      text: `m:${node.properties.M ?? "1"}`,
    };
  } else if (kind === "resistor" || kind === "capacitor" || kind === "inductor" || kind === "isource") {
    const uri = standardSymbolUri(kind);
    attrs.librarySymbol = {
      x: kind === "isource" ? 13 : 5,
      y: kind === "isource" ? 14 : 11,
      width: kind === "isource" ? width - 26 : width - 10,
      height: kind === "isource" ? height - 28 : height - 22,
      href: uri ?? "",
      xlinkHref: uri ?? "",
      preserveAspectRatio: "xMidYMid meet",
      pointerEvents: "none",
    };
  } else if (kind === "vsource") {
    attrs.sourceLeadTop = { x1: width / 2, y1: 0, x2: width / 2, y2: 22, stroke: wire, strokeWidth: 1.7 };
    attrs.sourceCircle = { cx: width / 2, cy: height / 2, r: 22, fill: "#ffffff", stroke: wire, strokeWidth: 1.7 };
    attrs.sourceLeadBottom = { x1: width / 2, y1: height - 22, x2: width / 2, y2: height, stroke: wire, strokeWidth: 1.7 };
    attrs.sourceMark = { d: `M ${width / 2 - 6} ${height / 2 - 8} L ${width / 2 + 6} ${height / 2 - 8} M ${width / 2} ${height / 2 - 14} L ${width / 2} ${height / 2 - 2} M ${width / 2 - 6} ${height / 2 + 9} L ${width / 2 + 6} ${height / 2 + 9}`, fill: "none", stroke: wire, strokeWidth: 1.5 };
  } else if (kind === "vdd") {
    attrs.powerPath = { d: `M ${width / 2} ${height} L ${width / 2} 20 M ${width / 2} 20 L ${width / 2 - 8} 30 M ${width / 2} 20 L ${width / 2 + 8} 30`, fill: "none", stroke: "#3c8467", strokeWidth: 1.7 };
    attrs.instanceLabel.y = 13; attrs.detailLabel.text = "";
  } else if (kind === "gnd") {
    attrs.groundPath = { d: `M ${width / 2} 0 L ${width / 2} 20 M ${width / 2 - 13} 20 L ${width / 2 + 13} 20 M ${width / 2 - 8} 26 L ${width / 2 + 8} 26 M ${width / 2 - 3} 32 L ${width / 2 + 3} 32`, fill: "none", stroke: "#3c8467", strokeWidth: 1.6 };
    attrs.instanceLabel.y = height - 2; attrs.detailLabel.text = "";
  } else if (kind === "input" || kind === "output" || kind === "bidir") {
    const rightFacing = kind !== "output";
    attrs.portShape = { points: rightFacing ? `0,8 ${width - 14},8 ${width},${height / 2} ${width - 14},${height - 8} 0,${height - 8}` : `${width},8 14,8 0,${height / 2} 14,${height - 8} ${width},${height - 8}`, fill: "#f5f9fd", stroke: "#2b579a", strokeWidth: 1.3 };
    attrs.instanceLabel.y = height / 2 + 3; attrs.instanceLabel.fontSize = 9; attrs.detailLabel.text = "";
  } else if (kind === "netlabel") {
    attrs.labelLead = { d: `M 0 ${height / 2} L 12 ${height / 2}`, fill: "none", stroke: "#3c8467", strokeWidth: 1.4 };
    attrs.labelShape = { points: `12,6 ${width},6 ${width},${height - 6} 12,${height - 6} 5,${height / 2}`, fill: "#f3faf6", stroke: "#63a488", strokeWidth: 1.2 };
    attrs.instanceLabel.text = node.properties.netName ?? node.instanceName; attrs.instanceLabel.y = height / 2 + 3; attrs.instanceLabel.fontSize = 9; attrs.detailLabel.text = "";
  } else if (kind === "junction") {
    attrs.junction = { cx: width / 2, cy: height / 2, r: 3.5, fill: "#2b579a", stroke: "none", strokeWidth: 0 };
  }
  return attrs;
}

export function createX6NodeMetadata(node: SchematicNode): NodeMetadata {
  const definition = getDeviceDefinition(node.kind);
  const canvasPosition = documentOriginToCanvasPosition(node);
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
            tagName: node.kind === "junction" ? "circle" : "rect",
            selector: "portBody",
            className: node.kind === "junction" ? "junction-port-hit" : "terminal-port",
          }],
          attrs: {
            portBody: node.kind === "junction"
              ? {
                  r: 6,
                  magnet: true,
                  fill: "transparent",
                  stroke: "transparent",
                  strokeWidth: 0,
                }
              : {
                  x: -3,
                  y: -3,
                  width: 6,
                  height: 6,
                  rx: 0,
                  ry: 0,
                  magnet: true,
                  fill: "#d13438",
                  stroke: "#d13438",
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
