"use client";

import { getSvg, symbols, type SchSymbol } from "schematic-symbols";
import type { DeviceKind } from "../lib/schematic";

const symbolMap = symbols as unknown as Record<string, SchSymbol | undefined>;
const symbolNames: Partial<Record<DeviceKind, string>> = {
  resistor: "resistor_right",
  capacitor: "capacitor_right",
  inductor: "inductor_right",
  isource: "current_source_up",
  gnd: "ground_up",
  vdd: "vcc_up",
};

const svgCache = new Map<DeviceKind, string>();

function existingSvg(kind: DeviceKind) {
  if (svgCache.has(kind)) return svgCache.get(kind) ?? null;
  const symbolName = symbolNames[kind];
  const symbol = symbolName ? symbolMap[symbolName] : undefined;
  if (!symbol) return null;
  const svg = getSvg(symbol, { width: 38, height: 30 }).replace(/<text\b[^>]*>[\s\S]*?<\/text>/g, "");
  svgCache.set(kind, svg);
  return svg;
}

function LocalSymbol({ kind }: { kind: DeviceKind }) {
  if (kind === "nmos4" || kind === "pmos4") {
    const sourceY = kind === "pmos4" ? 7 : 23;
    const sourcePinY = kind === "pmos4" ? 1 : 29;
    const drainY = kind === "pmos4" ? 23 : 7;
    const drainPinY = kind === "pmos4" ? 29 : 1;
    const arrow = kind === "pmos4"
      ? `M 27 ${sourceY - 3} L 22 ${sourceY} L 27 ${sourceY + 3}`
      : `M 23 ${sourceY - 3} L 28 ${sourceY} L 23 ${sourceY + 3}`;
    return (
      <svg viewBox="0 0 38 30" aria-hidden="true">
        <path d="M20 7V23" />
        <path d="M2 15H13M15 7V23" />
        <path d={`M20 ${drainY} H29 V${drainPinY}`} />
        <path d={`M20 ${sourceY} H29 V${sourcePinY}`} />
        <path d="M20 15H36" />
        <path d={arrow} />
      </svg>
    );
  }
  if (kind === "vsource") {
    return <svg viewBox="0 0 38 30" aria-hidden="true"><line x1="19" y1="1" x2="19" y2="6" /><circle cx="19" cy="15" r="9" /><line x1="19" y1="24" x2="19" y2="29" /><path d="M15 11h8M19 8v6M15 19h8" /></svg>;
  }
  if (kind === "input") return <svg viewBox="0 0 38 30" aria-hidden="true"><path d="M2 8h24l9 7-9 7H2z" /><line x1="35" y1="15" x2="38" y2="15" /></svg>;
  if (kind === "output") return <svg viewBox="0 0 38 30" aria-hidden="true"><path d="M36 8H12l-9 7 9 7h24z" /><line x1="0" y1="15" x2="3" y2="15" /></svg>;
  if (kind === "bidir") return <svg viewBox="0 0 38 30" aria-hidden="true"><path d="M8 8h22l6 7-6 7H8l-6-7z" /></svg>;
  if (kind === "netlabel") return <svg viewBox="0 0 38 30" aria-hidden="true"><line x1="1" y1="15" x2="8" y2="15" /><path d="M8 7h28v16H8l-6-8z" /><text x="22" y="18">#</text></svg>;
  if (kind === "junction") return <svg viewBox="0 0 38 30" aria-hidden="true"><line x1="2" y1="15" x2="36" y2="15" /><line x1="19" y1="2" x2="19" y2="28" /><circle className="filled" cx="19" cy="15" r="4" /></svg>;
  return <svg viewBox="0 0 38 30" aria-hidden="true"><path d="M19 29V10M12 17l7-7 7 7" /></svg>;
}

export function DeviceSymbolPreview({ kind }: { kind: DeviceKind }) {
  const svg = existingSvg(kind);
  return svg
    ? <span className={`device-symbol-preview kind-${kind}`} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />
    : <span className={`device-symbol-preview local kind-${kind}`} aria-hidden="true"><LocalSymbol kind={kind} /></span>;
}
