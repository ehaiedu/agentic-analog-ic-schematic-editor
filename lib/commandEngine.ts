import type { Point, WireEndpoint } from "./schematic";
import type { StretchRouteMethod, WireDrawMode } from "./compatibilityProfile";

export type CommandId =
  | "select"
  | "create-instance"
  | "create-pin"
  | "create-wire"
  | "add-wire-name"
  | "add-junction"
  | "add-no-connect"
  | "add-note"
  | "move"
  | "stretch"
  | "copy"
  | "rotate"
  | "mirror-x"
  | "mirror-y"
  | "delete"
  | "properties"
  | "direct-text-edit";

export type CommandPhase =
  | "IDLE"
  | "COMMAND_ARMED"
  | "ACQUIRE_TARGETS"
  | "ACQUIRE_REFERENCE"
  | "DYNAMIC_PREVIEW"
  | "COMMIT"
  | "REPEAT"
  | "COMPLETE";

export interface CommandOptions {
  wireDrawMode: WireDrawMode;
  stretchRouteMethod: StretchRouteMethod;
  continuous: boolean;
  snapEnabled: boolean;
  remember: boolean;
}

export interface WireCommandData {
  source: WireEndpoint | null;
  fixedPoints: Point[];
  cursorPoint: Point | null;
  previewPoints: Point[];
  candidateKind: "pin" | "wire-endpoint" | "junction" | "wire-segment" | "grid" | null;
}

export interface CommandSession {
  commandId: CommandId | null;
  phase: CommandPhase;
  targets: string[];
  referencePoint: Point | null;
  prompt: string;
  options: CommandOptions;
  optionsOpen: boolean;
  partialSelection: boolean;
  wire: WireCommandData | null;
}

export type CommandInput =
  | { type: "INVOKE"; commandId: CommandId; hasPreselection?: boolean }
  | { type: "SET_TARGETS"; targets: string[] }
  | { type: "SET_REFERENCE"; point: Point }
  | { type: "POINTER_PREVIEW"; point: Point; previewPoints?: Point[]; candidateKind?: WireCommandData["candidateKind"] }
  | { type: "WIRE_START"; source: WireEndpoint; point: Point }
  | { type: "WIRE_FIX_POINT"; point: Point }
  | { type: "WIRE_REMOVE_LAST_POINT" }
  | { type: "COMMIT" }
  | { type: "FINISH" }
  | { type: "CANCEL" }
  | { type: "OPEN_OPTIONS" }
  | { type: "CLOSE_OPTIONS" }
  | { type: "UPDATE_OPTIONS"; patch: Partial<CommandOptions> }
  | { type: "TOGGLE_PARTIAL_SELECTION" }
  | { type: "RESET" };

export const DEFAULT_COMMAND_OPTIONS: CommandOptions = {
  wireDrawMode: "route",
  stretchRouteMethod: "full",
  continuous: true,
  snapEnabled: true,
  remember: false,
};

export function createIdleCommandSession(
  options: CommandOptions = DEFAULT_COMMAND_OPTIONS,
): CommandSession {
  return {
    commandId: null,
    phase: "IDLE",
    targets: [],
    referencePoint: null,
    prompt: "Ready",
    options,
    optionsOpen: false,
    partialSelection: false,
    wire: null,
  };
}

function promptFor(commandId: CommandId, phase: CommandPhase): string {
  if (commandId === "create-wire") {
    if (phase === "COMMAND_ARMED" || phase === "REPEAT") return "Create Wire: Select start point";
    if (phase === "DYNAMIC_PREVIEW") return "Create Wire: Click to add corner; Enter or double-click to finish";
  }
  if (phase === "ACQUIRE_TARGETS") return `${commandId}: Select objects; Enter to continue`;
  if (phase === "ACQUIRE_REFERENCE") return `${commandId}: Select reference point`;
  if (phase === "DYNAMIC_PREVIEW") return `${commandId}: Select destination point`;
  return commandId;
}

function invoke(session: CommandSession, commandId: CommandId, hasPreselection: boolean): CommandSession {
  if (commandId === "select") return createIdleCommandSession(session.options);
  if (commandId === "create-wire") {
    return {
      ...session,
      commandId,
      phase: "COMMAND_ARMED",
      targets: [],
      referencePoint: null,
      prompt: promptFor(commandId, "COMMAND_ARMED"),
      optionsOpen: false,
      wire: {
        source: null,
        fixedPoints: [],
        cursorPoint: null,
        previewPoints: [],
        candidateKind: null,
      },
    };
  }
  const createCommand = commandId.startsWith("create-") || commandId.startsWith("add-");
  const phase: CommandPhase = createCommand
    ? "COMMAND_ARMED"
    : hasPreselection
      ? "ACQUIRE_REFERENCE"
      : "ACQUIRE_TARGETS";
  return {
    ...session,
    commandId,
    phase,
    targets: hasPreselection ? session.targets : [],
    referencePoint: null,
    prompt: promptFor(commandId, phase),
    optionsOpen: false,
    wire: null,
  };
}

export function reduceCommandSession(
  session: CommandSession,
  input: CommandInput,
): CommandSession {
  if (input.type === "RESET") return createIdleCommandSession(session.options);
  if (input.type === "INVOKE") return invoke(session, input.commandId, Boolean(input.hasPreselection));
  if (input.type === "OPEN_OPTIONS") {
    return session.commandId ? { ...session, optionsOpen: true } : session;
  }
  if (input.type === "CLOSE_OPTIONS") return { ...session, optionsOpen: false };
  if (input.type === "UPDATE_OPTIONS") {
    return { ...session, options: { ...session.options, ...input.patch } };
  }
  if (input.type === "TOGGLE_PARTIAL_SELECTION") {
    return { ...session, partialSelection: !session.partialSelection };
  }
  if (!session.commandId) return session;

  if (input.type === "SET_TARGETS") {
    const phase: CommandPhase = input.targets.length ? "ACQUIRE_REFERENCE" : "ACQUIRE_TARGETS";
    return {
      ...session,
      targets: [...input.targets],
      phase,
      prompt: promptFor(session.commandId, phase),
    };
  }
  if (input.type === "SET_REFERENCE") {
    return {
      ...session,
      referencePoint: input.point,
      phase: "DYNAMIC_PREVIEW",
      prompt: promptFor(session.commandId, "DYNAMIC_PREVIEW"),
    };
  }
  if (input.type === "POINTER_PREVIEW") {
    if (!session.wire) return session.phase === "DYNAMIC_PREVIEW" ? session : session;
    return {
      ...session,
      phase: session.wire.source ? "DYNAMIC_PREVIEW" : session.phase,
      wire: {
        ...session.wire,
        cursorPoint: input.point,
        previewPoints: input.previewPoints ?? session.wire.previewPoints,
        candidateKind: input.candidateKind ?? null,
      },
    };
  }
  if (input.type === "WIRE_START" && session.commandId === "create-wire" && session.wire) {
    return {
      ...session,
      phase: "DYNAMIC_PREVIEW",
      prompt: promptFor("create-wire", "DYNAMIC_PREVIEW"),
      wire: {
        ...session.wire,
        source: input.source,
        fixedPoints: [input.point],
        cursorPoint: input.point,
        previewPoints: [input.point],
      },
    };
  }
  if (input.type === "WIRE_FIX_POINT" && session.wire?.source) {
    const last = session.wire.fixedPoints[session.wire.fixedPoints.length - 1];
    if (last?.x === input.point.x && last.y === input.point.y) return session;
    return {
      ...session,
      wire: {
        ...session.wire,
        fixedPoints: [...session.wire.fixedPoints, input.point],
        cursorPoint: input.point,
        previewPoints: [...session.wire.fixedPoints, input.point],
      },
    };
  }
  if (input.type === "WIRE_REMOVE_LAST_POINT" && session.wire?.source) {
    if (session.wire.fixedPoints.length <= 1) {
      return {
        ...session,
        phase: "COMMAND_ARMED",
        prompt: promptFor("create-wire", "COMMAND_ARMED"),
        wire: { ...session.wire, source: null, fixedPoints: [], cursorPoint: null, previewPoints: [] },
      };
    }
    const fixedPoints = session.wire.fixedPoints.slice(0, -1);
    return {
      ...session,
      wire: {
        ...session.wire,
        fixedPoints,
        cursorPoint: fixedPoints[fixedPoints.length - 1],
        previewPoints: fixedPoints,
      },
    };
  }
  if (input.type === "COMMIT") {
    const phase: CommandPhase = session.options.continuous ? "REPEAT" : "COMPLETE";
    return {
      ...session,
      phase,
      prompt: promptFor(session.commandId, phase),
      referencePoint: null,
      wire: session.commandId === "create-wire"
        ? { source: null, fixedPoints: [], cursorPoint: null, previewPoints: [], candidateKind: null }
        : session.wire,
    };
  }
  if (input.type === "FINISH") return createIdleCommandSession(session.options);
  if (input.type === "CANCEL") {
    if (session.commandId === "create-wire" && session.wire?.source) {
      if (session.wire.fixedPoints.length > 1) {
        const fixedPoints = session.wire.fixedPoints.slice(0, -1);
        return {
          ...session,
          wire: { ...session.wire, fixedPoints, previewPoints: fixedPoints },
        };
      }
      return {
        ...session,
        phase: "COMMAND_ARMED",
        prompt: promptFor("create-wire", "COMMAND_ARMED"),
        wire: { ...session.wire, source: null, fixedPoints: [], cursorPoint: null, previewPoints: [] },
      };
    }
    if (session.targets.length) {
      return {
        ...session,
        phase: "ACQUIRE_TARGETS",
        targets: [],
        referencePoint: null,
        prompt: promptFor(session.commandId, "ACQUIRE_TARGETS"),
      };
    }
    return createIdleCommandSession(session.options);
  }
  return session;
}
