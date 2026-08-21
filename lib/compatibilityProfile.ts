import profileJson from "../config/vse-core-1.json";

export type WireDrawMode = "route" | "horizontal-first" | "vertical-first";
export type StretchRouteMethod = "full" | "simple" | "flight";

export interface CompatibilityProfile {
  name: "VSE-Core-1";
  keymap: Record<string, string>;
  mouse: Record<string, string>;
  grid: {
    snap: number;
    display: number;
    major: number;
    temporaryDisableModifier: string;
  };
  wire: {
    defaultDrawMode: WireDrawMode;
    defaultStretchRouteMethod: StretchRouteMethod;
    normalWidth: number;
    hitTolerancePixels: number;
    snapTolerancePixels: number;
  };
  selection: {
    partialSelection: boolean;
    hitTestPriority: string[];
  };
  naming: {
    instanceStartIndex: number;
    netNameCaseSensitive: boolean;
    globalNetSuffix: string;
  };
  text: {
    keepReadable: boolean;
    fontFamily: string;
  };
  colors: Record<string, string>;
}

export const VSE_CORE_PROFILE = profileJson as CompatibilityProfile;
