"use client";

import { getSvg, symbols, type SchSymbol } from "schematic-symbols";
import type { DeviceKind } from "../lib/schematic";

const symbolMap = symbols as unknown as Record<string, SchSymbol | undefined>;
const symbolNames: Partial<Record<DeviceKind, string>> = {
  diode: "diode_right",
  npn3: "npn_bipolar_transistor_vert",
  pnp3: "pnp_bipolar_transistor_vert",
  resistor: "resistor_right",
  capacitor: "capacitor_right",
  inductor: "inductor_right",
  isource: "current_source_up",
  switch4: "spst_switch_right",
  opamp3: "opamp_no_power_right",
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
  if (kind === "vcvs" || kind === "vccs") {
    return <svg viewBox="0 0 38 30" aria-hidden="true"><line x1="19" y1="1" x2="19" y2="7" /><path d="M19 7l12 8-12 8-12-8z" /><line x1="19" y1="23" x2="19" y2="29" /><line x1="1" y1="15" x2="7" y2="15" /><line x1="31" y1="15" x2="37" y2="15" /><text x="19" y="18">{kind === "vcvs" ? "E" : "G"}</text></svg>;
  }
  if (kind === "transmission_gate") {
    return (
      <svg viewBox="0 0 38 30" aria-hidden="true">
        <line x1="1" y1="15" x2="10" y2="15" />
        <line x1="28" y1="15" x2="37" y2="15" />
        <path d="M10 11l17-4M10 19l17 4" />
        <line x1="19" y1="2" x2="19" y2="9" />
        <line x1="19" y1="21" x2="19" y2="28" />
        <circle cx="28" cy="23" r="1.8" />
      </svg>
    );
  }
  if (kind === "sampling_switch") {
    return (
      <svg viewBox="0 0 38 30" aria-hidden="true">
        <line x1="1" y1="13" x2="10" y2="13" />
        <path d="M10 13l13-6" />
        <circle cx="25" cy="13" r="2" />
        <line x1="27" y1="13" x2="37" y2="13" />
        <line x1="30" y1="13" x2="30" y2="20" />
        <line x1="24" y1="20" x2="36" y2="20" />
        <line x1="24" y1="23" x2="36" y2="23" />
        <line x1="30" y1="23" x2="30" y2="29" />
      </svg>
    );
  }
  if (kind === "cdac_array") {
    return (
      <svg viewBox="0 0 38 30" aria-hidden="true">
        <line x1="5" y1="7" x2="33" y2="7" />
        <line x1="5" y1="24" x2="33" y2="24" />
        {[12, 19, 26].map((x) => (
          <g key={x}>
            <line x1={x} y1="7" x2={x} y2="13" />
            <line x1={x - 4} y1="13" x2={x + 4} y2="13" />
            <line x1={x - 4} y1="17" x2={x + 4} y2="17" />
            <line x1={x} y1="17" x2={x} y2="24" />
          </g>
        ))}
      </svg>
    );
  }
  if (kind === "dynamic_comparator") {
    return (
      <svg viewBox="0 0 38 30" aria-hidden="true">
        <polygon points="9,6 29,15 9,24" />
        <text x="6" y="13">+</text>
        <text x="6" y="22">-</text>
        <line x1="20" y1="10" x2="27" y2="20" />
        <line x1="20" y1="20" x2="27" y2="10" />
        <line x1="19" y1="1" x2="19" y2="6" />
        <line x1="29" y1="12" x2="37" y2="12" />
        <line x1="29" y1="18" x2="37" y2="18" />
      </svg>
    );
  }
  if (kind === "sar_logic") {
    return (
      <svg viewBox="0 0 38 30" aria-hidden="true">
        <rect x="8" y="6" width="22" height="18" rx="1" />
        <line x1="12" y1="11" x2="26" y2="11" />
        <line x1="12" y1="15" x2="26" y2="15" />
        <line x1="12" y1="19" x2="26" y2="19" />
        <path d="M1 23h6l2-4 3 4h5" />
        <line x1="30" y1="19" x2="37" y2="19" />
        <text x="19" y="18">SAR</text>
      </svg>
    );
  }
  if ([
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
  ].includes(kind)) {
    const title = kind === "diff_pair" ? "DI"
      : kind === "current_mirror" ? "MI"
        : kind === "bias_current" ? "IB"
          : kind === "gain_stage" ? "A"
            : kind === "latch" ? "LT"
              : kind === "subckt4" ? "X4"
                : kind === "subckt5" ? "X5"
                  : kind === "subckt6" ? "X6"
                    : kind === "subckt7" ? "X7"
                      : kind === "subckt8" ? "X8"
                        : kind === "subckt9" ? "X9"
                          : kind === "subckt10" ? "X10"
                            : kind === "subckt11" ? "X11"
                              : kind === "subckt12" ? "X12"
                                : "X";
    return <svg viewBox="0 0 38 30" aria-hidden="true"><rect x="5" y="5" width="28" height="20" rx="1" /><line x1="1" y1="12" x2="5" y2="12" /><line x1="1" y1="18" x2="5" y2="18" /><line x1="33" y1="12" x2="37" y2="12" /><line x1="33" y1="18" x2="37" y2="18" /><text x="19" y="18">{title}</text></svg>;
  }
  if (kind === "input") return <svg viewBox="0 0 38 30" aria-hidden="true"><path d="M2 8h24l9 7-9 7H2z" /><line x1="35" y1="15" x2="38" y2="15" /></svg>;
  if (kind === "output") return <svg viewBox="0 0 38 30" aria-hidden="true"><path d="M36 8H12l-9 7 9 7h24z" /><line x1="0" y1="15" x2="3" y2="15" /></svg>;
  if (kind === "bidir") return <svg viewBox="0 0 38 30" aria-hidden="true"><path d="M8 8h22l6 7-6 7H8l-6-7z" /></svg>;
  if (kind === "netlabel") return <svg viewBox="0 0 38 30" aria-hidden="true"><line x1="1" y1="15" x2="10" y2="15" /><text x="13" y="18" textAnchor="start">NET</text></svg>;
  if (kind === "junction") return <svg viewBox="0 0 38 30" aria-hidden="true"><line x1="2" y1="15" x2="36" y2="15" /><line x1="19" y1="2" x2="19" y2="28" /><circle className="filled" cx="19" cy="15" r="4" /></svg>;
  return <svg viewBox="0 0 38 30" aria-hidden="true"><path d="M19 29V10M12 17l7-7 7 7" /></svg>;
}

export function DeviceSymbolPreview({ kind }: { kind: DeviceKind }) {
  const svg = existingSvg(kind);
  return svg
    ? <span className={`device-symbol-preview kind-${kind}`} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />
    : <span className={`device-symbol-preview local kind-${kind}`} aria-hidden="true"><LocalSymbol kind={kind} /></span>;
}
