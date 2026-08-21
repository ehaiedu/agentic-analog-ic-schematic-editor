"use client";

import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Bot,
  Box,
  Cable,
  Scissors,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Copy,
  Download,
  FileDown,
  FilePlus2,
  FlipHorizontal2,
  FolderOpen,
  FolderTree,
  Grid3X3,
  Library,
  Maximize2,
  MessageSquare,
  Mic,
  MoreHorizontal,
  MousePointer2,
  Play,
  Plus,
  Redo2,
  RotateCw,
  Save,
  Search,
  Send,
  Settings2,
  Trash2,
  Undo2,
  Upload,
  Waves,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import Image from "next/image";
import {
  ChangeEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createDemoDocument,
  getDeviceDefinition,
  withSavedRevision,
  type DeviceKind,
  type Point,
  type SchematicDocument,
  type SchematicNode,
} from "../lib/schematic";
import { compileNetlist, type NetlistDialect } from "../lib/netlist";
import { runSchematicCheck } from "../lib/checkEngine";
import { parseSchematicDocument } from "../lib/schematicValidation";
import { serializeSchematic } from "../lib/persistence";
import {
  SchematicCanvas,
  type CanvasCommandState,
  type CanvasViewport,
  type SchematicCanvasHandle,
  type GridMode,
  type ToolMode,
} from "./SchematicCanvas";
import { VSE_CORE_PROFILE, type WireDrawMode } from "../lib/compatibilityProfile";
import { DeviceSymbolPreview } from "./DeviceSymbolPreview";
import {
  FlexibleScreenshotOverlay,
  type ScreenshotCapture,
} from "./FlexibleScreenshotOverlay";

type BottomTab = "netlist" | "markers" | "simulation" | "console";
type ResizeTarget = "left" | "right" | "bottom";
type LayoutState = {
  leftWidth: number;
  rightWidth: number;
  bottomHeight: number;
};
type AgentAttachment = {
  id: string;
  name: string;
  blob: Blob;
  previewUrl: string;
  width: number;
  height: number;
};
type AgentMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  attachments?: AgentAttachment[];
};
type AgentSession = {
  id: string;
  title: string;
  input: string;
  messages: AgentMessage[];
  attachments: AgentAttachment[];
};
type PaletteDrag = {
  kind: DeviceKind;
  label: string;
  symbol: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
  moved: boolean;
};

type PropertyDraft = {
  nodeId: string;
  instanceName: string;
  properties: Record<string, string>;
};

const IDLE_COMMAND_STATE: CanvasCommandState = {
  command: "select",
  phase: "IDLE",
  prompt: "就绪",
  fixedPointCount: 0,
  snapCandidate: null,
  partialSelection: VSE_CORE_PROFILE.selection.partialSelection,
};

type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";

export interface AnalogWorkbenchProps {
  initialDocument?: SchematicDocument;
  projectId?: string;
  projectName?: string;
  projectRevision?: number;
  username?: string;
}

const DEFAULT_LAYOUT: LayoutState = {
  leftWidth: 236,
  rightWidth: 360,
  bottomHeight: 176,
};

const EMPTY_VIEWPORT: CanvasViewport = {
  originX: 0,
  originY: 0,
  scale: 1,
  width: 0,
  height: 0,
};

function chooseRulerStep(scale: number): number {
  const desiredDocumentStep = 90 / Math.max(scale, 0.01);
  const magnitude = 10 ** Math.floor(Math.log10(desiredDocumentStep));
  const normalized = desiredDocumentStep / magnitude;
  const multiple = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return multiple * magnitude;
}

function rulerValues(
  origin: number,
  length: number,
  scale: number,
  step: number,
  overlayStart: number,
): number[] {
  if (length <= overlayStart || scale <= 0) return [];
  const minimum = (overlayStart - origin) / scale;
  const maximum = (length - origin) / scale;
  const first = Math.ceil(minimum / step) * step;
  const values: number[] = [];
  for (let value = first; value <= maximum && values.length < 200; value += step) {
    values.push(Object.is(value, -0) ? 0 : Number(value.toPrecision(12)));
  }
  return values;
}

const DEVICE_GROUPS: Array<{
  title: string;
  items: Array<{ kind: DeviceKind; label: string; symbol: string; hint: string }>;
}> = [
  {
    title: "MOS 晶体管",
    items: [
      { kind: "nmos4", label: "NMOS 4端", symbol: "NM", hint: "D/G/S/B" },
      { kind: "pmos4", label: "PMOS 4端", symbol: "PM", hint: "D/G/S/B" },
    ],
  },
  {
    title: "无源器件",
    items: [
      { kind: "resistor", label: "电阻", symbol: "R", hint: "res" },
      { kind: "capacitor", label: "电容", symbol: "C", hint: "cap" },
      { kind: "inductor", label: "电感", symbol: "L", hint: "ind" },
    ],
  },
  {
    title: "激励与端口",
    items: [
      { kind: "vsource", label: "电压源", symbol: "V", hint: "vdc" },
      { kind: "isource", label: "电流源", symbol: "I", hint: "idc" },
      { kind: "input", label: "输入端口", symbol: "IN", hint: "pin" },
      { kind: "output", label: "输出端口", symbol: "OUT", hint: "pin" },
      { kind: "bidir", label: "双向端口", symbol: "IO", hint: "pin" },
    ],
  },
  {
    title: "网络标识",
    items: [
      { kind: "vdd", label: "VDD", symbol: "VDD", hint: "global" },
      { kind: "gnd", label: "VSS / GND", symbol: "0", hint: "global" },
      { kind: "netlabel", label: "网络标签", symbol: "#", hint: "name" },
      { kind: "junction", label: "连接点", symbol: "•", hint: "join" },
    ],
  },
];

const PROPERTY_LABELS: Record<string, string> = {
  name: "实例名",
  instanceName: "实例名",
  model: "模型",
  w: "沟道宽度 W",
  l: "沟道长度 L",
  m: "并联倍数 M",
  nf: "栅指数 NF",
  W: "沟道宽度 W",
  L: "沟道长度 L",
  M: "并联倍数 M",
  NF: "栅指数 NF",
  value: "器件值",
  dc: "直流值",
  netName: "网络名",
  label: "显示名称",
  library: "Library",
  cell: "Cell",
  view: "View",
};

function downloadText(filename: string, text: string, mime = "text/plain") {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function readIssueMessage(issue: unknown) {
  if (typeof issue === "string") return issue;
  if (issue && typeof issue === "object" && "message" in issue) {
    return String((issue as { message: unknown }).message);
  }
  return "未知 ERC 提示";
}

export function AnalogWorkbench({
  initialDocument,
  projectId,
  projectName,
  projectRevision = 1,
  username = "",
}: AnalogWorkbenchProps = {}) {
  const editorRef = useRef<SchematicCanvasHandle>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const paletteDragRef = useRef<PaletteDrag | null>(null);
  const paletteDragCleanupRef = useRef<(() => void) | null>(null);
  const panelResizeCleanupRef = useRef<(() => void) | null>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const centerRef = useRef<HTMLElement>(null);
  const agentTabsRef = useRef<HTMLDivElement>(null);
  const agentScreenshotButtonRef = useRef<HTMLButtonElement>(null);
  const agentSessionCounterRef = useRef(1);
  const suppressPaletteClickRef = useRef(false);
  const [document, setDocument] = useState<SchematicDocument>(() => initialDocument ?? createDemoDocument());
  const documentRef = useRef(document);
  const lastSavedDocumentRef = useRef(serializeSchematic(document));
  const projectRevisionRef = useRef(projectRevision);
  const activeSaveRef = useRef<Promise<boolean> | null>(null);
  const saveProjectRef = useRef<() => Promise<boolean>>(async () => false);
  const saveRecoveryRef = useRef<() => Promise<void>>(async () => undefined);
  const [selected, setSelected] = useState<SchematicNode | null>(null);
  const [dialect, setDialect] = useState<NetlistDialect>("spectre");
  const [bottomTab, setBottomTab] = useState<BottomTab>("netlist");
  const [leftMode, setLeftMode] = useState<"library" | "project">("library");
  const [search, setSearch] = useState("");
  const [agentOpen, setAgentOpen] = useState(true);
  const [agentSessions, setAgentSessions] = useState<AgentSession[]>([
    { id: "agent-1", title: "New Agent", input: "", messages: [], attachments: [] },
  ]);
  const [activeAgentId, setActiveAgentId] = useState("agent-1");
  const [screenshotOpen, setScreenshotOpen] = useState(false);
  const [screenshotTargetAgentId, setScreenshotTargetAgentId] = useState<string | null>(null);
  const [agentAttachmentNotices, setAgentAttachmentNotices] = useState<Record<string, string>>({});
  const [propertyOpen, setPropertyOpen] = useState(false);
  const [propertyPosition, setPropertyPosition] = useState({ x: 520, y: 176 });
  const [propertyDraft, setPropertyDraft] = useState<PropertyDraft | null>(null);
  const [layout, setLayout] = useState<LayoutState>(DEFAULT_LAYOUT);
  const [savedAt, setSavedAt] = useState<string>(projectId ? "已从项目载入" : "未保存");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [paletteDrag, setPaletteDrag] = useState<PaletteDrag | null>(null);
  const [gridMode, setGridMode] = useState<GridMode>("dot");
  const [toolMode, setToolMode] = useState<ToolMode>("select");
  const [wireDrawMode, setWireDrawMode] = useState<WireDrawMode>(VSE_CORE_PROFILE.wire.defaultDrawMode);
  const [commandState, setCommandState] = useState<CanvasCommandState>(IDLE_COMMAND_STATE);
  const [commandOptionsOpen, setCommandOptionsOpen] = useState(false);
  const [canvasViewport, setCanvasViewport] = useState<CanvasViewport>(EMPTY_VIEWPORT);
  const [cursorPosition, setCursorPosition] = useState<Point | null>(null);
  const layoutRef = useRef(layout);
  const agentSessionsRef = useRef(agentSessions);
  const activeAgent = agentSessions.find((session) => session.id === activeAgentId) ?? agentSessions[0];
  const agentHasDraft = Boolean(activeAgent?.input.trim() || activeAgent?.attachments.length);

  const ruler = useMemo(() => {
    const step = chooseRulerStep(canvasViewport.scale);
    return {
      step,
      horizontal: rulerValues(
        canvasViewport.originX,
        canvasViewport.width,
        canvasViewport.scale,
        step,
        21,
      ),
      vertical: rulerValues(
        canvasViewport.originY,
        canvasViewport.height,
        canvasViewport.scale,
        step,
        21,
      ),
    };
  }, [canvasViewport]);

  const compiled = useMemo(() => compileNetlist(document, dialect), [document, dialect]);
  const selectedConnections = useMemo(() => {
    if (!selected) return [];
    return getDeviceDefinition(selected.kind).pins.map((pin) => {
      const net = compiled.nets.find((candidate) =>
        candidate.terminals.some((terminal) => terminal.nodeId === selected.id && terminal.portId === pin.id),
      );
      const open = compiled.issues.some((issue) =>
        issue.code === "UNCONNECTED_REQUIRED_TERMINAL" && issue.nodeId === selected.id && issue.portId === pin.id,
      );
      return { pin: pin.id, label: pin.label, net: net?.name ?? "—", open };
    });
  }, [compiled, selected]);

  useEffect(() => {
    agentSessionsRef.current = agentSessions;
  }, [agentSessions]);
  const filteredGroups = useMemo(
    () =>
      DEVICE_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter((item) =>
          `${item.label} ${item.kind} ${item.hint}`.toLowerCase().includes(search.toLowerCase()),
        ),
      })).filter((group) => group.items.length > 0),
    [search],
  );

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const stored = localStorage.getItem("analog-studio.layout.v1");
      if (!stored) return;
      try {
        const parsed = JSON.parse(stored) as Partial<LayoutState>;
        const restored = {
          leftWidth: Math.min(420, Math.max(180, parsed.leftWidth ?? DEFAULT_LAYOUT.leftWidth)),
          rightWidth: Math.min(560, Math.max(280, parsed.rightWidth ?? DEFAULT_LAYOUT.rightWidth)),
          bottomHeight: Math.min(420, Math.max(96, parsed.bottomHeight ?? DEFAULT_LAYOUT.bottomHeight)),
        };
        layoutRef.current = restored;
        setLayout(restored);
      } catch {
        localStorage.removeItem("analog-studio.layout.v1");
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      agentTabsRef.current
        ?.querySelector<HTMLElement>('.agent-session-tab[aria-selected="true"]')
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeAgentId]);

  useEffect(() => () => {
    paletteDragCleanupRef.current?.();
    panelResizeCleanupRef.current?.();
  }, []);

  const loadIntoEditor = (next: SchematicDocument) => {
    documentRef.current = next;
    setDocument(next);
    setSelected(null);
    setPropertyOpen(false);
    setPropertyDraft(null);
    editorRef.current?.loadDocument(next);
  };

  const saveProject = useCallback(async (): Promise<boolean> => {
    const inFlight = activeSaveRef.current;
    if (inFlight) {
      const succeeded = await inFlight;
      if (!succeeded) return false;
      return serializeSchematic(documentRef.current) === lastSavedDocumentRef.current
        ? true
        : saveProjectRef.current();
    }

    const current = editorRef.current?.getDocument() ?? documentRef.current;
    documentRef.current = current;
    const currentSerialized = serializeSchematic(current);
    if (currentSerialized === lastSavedDocumentRef.current) {
      setSaveState("saved");
      return true;
    }
    const saveCandidate = withSavedRevision(current);
    const serialized = serializeSchematic(saveCandidate);

    if (!projectId) {
      localStorage.setItem("analog-studio.unsynced", serialized);
      localStorage.removeItem("analog-studio.recovery.v1");
      documentRef.current = saveCandidate;
      setDocument(saveCandidate);
      editorRef.current?.setDocumentMetadata(saveCandidate);
      lastSavedDocumentRef.current = serialized;
      setSavedAt(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
      setSaveState("saved");
      return true;
    }

    const operation = (async (): Promise<boolean> => {
      setSaveState("saving");
      setSavedAt("正在保存…");
      try {
        const response = await fetch(`/api/projects/${projectId}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ document: saveCandidate, revision: projectRevisionRef.current }),
          keepalive: true,
        });
        if (response.status === 401) {
          window.location.replace("/login");
          return false;
        }
        const payload = await response.json().catch(() => null) as {
          error?: string;
          project?: { revision?: number };
        } | null;
        if (response.status === 409) {
          setSaveState("conflict");
          setSavedAt(payload?.error ?? "项目已在其他页面修改，请刷新");
          return false;
        }
        if (!response.ok || !payload?.project?.revision) throw new Error("save_failed");
        projectRevisionRef.current = payload.project.revision;
        lastSavedDocumentRef.current = serialized;
        const hasNewerChanges = serializeSchematic(documentRef.current) !== currentSerialized;
        if (!hasNewerChanges) {
          documentRef.current = saveCandidate;
          setDocument(saveCandidate);
          editorRef.current?.setDocumentMetadata(saveCandidate);
        }
        void fetch(`/api/projects/${projectId}/recovery`, { method: "DELETE", keepalive: true });
        setSaveState(hasNewerChanges ? "dirty" : "saved");
        setSavedAt(`已保存 ${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`);
        return true;
      } catch {
        setSaveState("error");
        setSavedAt("保存失败，点击保存重试");
        return false;
      }
    })();

    activeSaveRef.current = operation;
    const succeeded = await operation;
    if (activeSaveRef.current === operation) activeSaveRef.current = null;
    if (succeeded && serializeSchematic(documentRef.current) !== lastSavedDocumentRef.current) {
      return saveProjectRef.current();
    }
    return succeeded;
  }, [projectId]);

  const saveRecovery = useCallback(async (): Promise<void> => {
    const current = editorRef.current?.getDocument() ?? documentRef.current;
    const serialized = serializeSchematic(current);
    if (serialized === lastSavedDocumentRef.current) return;
    if (!projectId) {
      localStorage.setItem("analog-studio.recovery.v1", serialized);
      setSavedAt("已写入本机恢复副本");
      return;
    }
    try {
      const response = await fetch(`/api/projects/${projectId}/recovery`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          document: current,
          baseStorageRevision: projectRevisionRef.current,
        }),
        keepalive: true,
      });
      if (response.ok) setSavedAt("修改未正式保存 · 已自动备份恢复副本");
    } catch {
      // Formal save state remains dirty; a recovery failure must never make a
      // valid document look saved or overwrite the project head.
    }
  }, [projectId]);

  const runCheck = () => {
    const current = editorRef.current?.getDocument() ?? documentRef.current;
    const result = runSchematicCheck(current);
    documentRef.current = result.document;
    setDocument(result.document);
    editorRef.current?.setDocumentMetadata(result.document);
    setBottomTab("markers");
    setSavedAt(`检查完成：${result.errorCount} 错误 / ${result.warningCount} 警告`);
    return result;
  };

  const checkAndSave = async () => {
    runCheck();
    await saveProjectRef.current();
  };

  useEffect(() => {
    saveProjectRef.current = saveProject;
  }, [saveProject]);

  useEffect(() => {
    saveRecoveryRef.current = saveRecovery;
  }, [saveRecovery]);

  useEffect(() => {
    documentRef.current = document;
    const serialized = serializeSchematic(document);
    if (serialized === lastSavedDocumentRef.current) return;
    setSaveState("dirty");
    setSavedAt("有未保存修改");
    const timer = window.setTimeout(() => void saveRecoveryRef.current(), 1600);
    return () => window.clearTimeout(timer);
  }, [document]);

  useEffect(() => {
    const hasUnsavedChanges = () =>
      serializeSchematic(editorRef.current?.getDocument() ?? documentRef.current) !== lastSavedDocumentRef.current ||
      activeSaveRef.current !== null;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const handlePageHide = () => {
      if (hasUnsavedChanges()) void saveRecoveryRef.current();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, []);

  const returnToProjects = async () => {
    const saved = await saveProject();
    if (saved || window.confirm("当前修改尚未保存。仍然返回项目列表吗？")) {
      window.location.assign("/projects");
    }
  };

  const importJson = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = parseSchematicDocument(JSON.parse(await file.text()));
      loadIntoEditor(parsed);
      setSavedAt("已导入 JSON");
    } catch {
      setSavedAt("导入失败：格式不正确");
    } finally {
      event.target.value = "";
    }
  };

  const updatePropertyDraft = (key: string, value: string) => {
    setPropertyDraft((draft) => {
      if (!draft) return draft;
      return key === "instanceName"
        ? { ...draft, instanceName: value }
        : { ...draft, properties: { ...draft.properties, [key]: value } };
    });
  };

  const applyPropertyDraft = () => {
    if (!selected || !propertyDraft || propertyDraft.nodeId !== selected.id) return;
    editorRef.current?.updateSelectedProperties({
      instanceName: propertyDraft.instanceName,
      ...propertyDraft.properties,
    });
    setSelected({
      ...selected,
      instanceName: propertyDraft.instanceName,
      properties: propertyDraft.properties,
    });
    setPropertyOpen(false);
    setPropertyDraft(null);
  };

  const closePropertyEditor = () => {
    setPropertyOpen(false);
    setPropertyDraft(null);
  };

  const sendAgentPlaceholder = () => {
    const prompt = activeAgent?.input.trim();
    const attachments = activeAgent?.attachments ?? [];
    if (!prompt && !attachments.length) return;
    const messageSeed = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setAgentSessions((sessions) => sessions.map((session) => session.id === activeAgentId
      ? {
          ...session,
          input: "",
          attachments: [],
          messages: [
            ...session.messages,
            {
              id: `user-${messageSeed}`,
              role: "user",
              text: prompt || `已添加 ${attachments.length} 张截图`,
              ...(attachments.length ? { attachments } : {}),
            },
            {
              id: `assistant-${messageSeed}`,
              role: "assistant",
              text: "已记录这次输入和截图。AI 对原理图的执行能力暂未启用。",
            },
          ],
        }
      : session));
  };

  const updateAgentInput = (value: string) => {
    setAgentSessions((sessions) => sessions.map((session) => session.id === activeAgentId
      ? { ...session, input: value }
      : session));
  };

  const startAgentScreenshot = () => {
    if (!activeAgent) return;
    if (activeAgent.attachments.length >= 4) {
      setAgentAttachmentNotices((notices) => ({
        ...notices,
        [activeAgent.id]: "每个会话最多保留 4 张待发送截图，请先删除一张。",
      }));
      return;
    }
    setAgentAttachmentNotices((notices) => ({ ...notices, [activeAgent.id]: "" }));
    setScreenshotTargetAgentId(activeAgent.id);
    setScreenshotOpen(true);
  };

  const completeAgentScreenshot = (capture: ScreenshotCapture) => {
    const targetId = screenshotTargetAgentId;
    if (targetId) {
      const targetSession = agentSessions.find((session) => session.id === targetId);
      if (targetSession && targetSession.attachments.length >= 4) {
        setAgentAttachmentNotices((notices) => ({
          ...notices,
          [targetId]: "每个会话最多保留 4 张待发送截图，请先删除一张。",
        }));
      } else if (targetSession) {
        const attachment: AgentAttachment = {
          id: `capture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          blob: capture.blob,
          previewUrl: URL.createObjectURL(capture.blob),
          name: capture.name,
          width: capture.width,
          height: capture.height,
        };
        setAgentSessions((sessions) => sessions.map((session) => session.id === targetId
          ? { ...session, attachments: [...session.attachments, attachment] }
          : session));
      }
    }
    setScreenshotOpen(false);
    setScreenshotTargetAgentId(null);
    window.requestAnimationFrame(() => agentScreenshotButtonRef.current?.focus({ preventScroll: true }));
  };

  const cancelAgentScreenshot = () => {
    setScreenshotOpen(false);
    setScreenshotTargetAgentId(null);
    window.requestAnimationFrame(() => agentScreenshotButtonRef.current?.focus({ preventScroll: true }));
  };

  const removeAgentAttachment = (attachmentId: string) => {
    const attachment = activeAgent?.attachments.find((candidate) => candidate.id === attachmentId);
    if (attachment) URL.revokeObjectURL(attachment.previewUrl);
    setAgentSessions((sessions) => sessions.map((session) => session.id === activeAgentId
      ? { ...session, attachments: session.attachments.filter((attachment) => attachment.id !== attachmentId) }
      : session));
    setAgentAttachmentNotices((notices) => ({ ...notices, [activeAgentId]: "" }));
  };

  const createAgentSession = () => {
    const number = agentSessionCounterRef.current + 1;
    agentSessionCounterRef.current = number;
    const session: AgentSession = {
      id: `agent-${number}`,
      title: `New Agent ${number}`,
      input: "",
      messages: [],
      attachments: [],
    };
    setAgentSessions((sessions) => [...sessions, session]);
    setActiveAgentId(session.id);
    setAgentOpen(true);
  };

  const closeAgentSession = (id: string) => {
    if (agentSessions.length === 1) {
      setAgentOpen(false);
      return;
    }
    const closingSession = agentSessions.find((session) => session.id === id);
    if (closingSession) {
      const previewUrls = new Set([
        ...closingSession.attachments.map((attachment) => attachment.previewUrl),
        ...closingSession.messages.flatMap((message) => message.attachments?.map((attachment) => attachment.previewUrl) ?? []),
      ]);
      previewUrls.forEach((previewUrl) => URL.revokeObjectURL(previewUrl));
    }
    const closingIndex = agentSessions.findIndex((session) => session.id === id);
    const remaining = agentSessions.filter((session) => session.id !== id);
    setAgentSessions(remaining);
    setAgentAttachmentNotices((notices) => {
      const next = { ...notices };
      delete next[id];
      return next;
    });
    if (activeAgentId === id) {
      setActiveAgentId(remaining[Math.max(0, closingIndex - 1)]?.id ?? remaining[0].id);
    }
  };

  useEffect(() => () => {
    const previewUrls = new Set(agentSessionsRef.current.flatMap((session) => [
      ...session.attachments.map((attachment) => attachment.previewUrl),
      ...session.messages.flatMap((message) => message.attachments?.map((attachment) => attachment.previewUrl) ?? []),
    ]));
    previewUrls.forEach((previewUrl) => URL.revokeObjectURL(previewUrl));
  }, []);

  const openPropertyEditor = (node: SchematicNode) => {
    setSelected(node);
    setPropertyDraft({
      nodeId: node.id,
      instanceName: node.instanceName,
      properties: { ...node.properties },
    });
    setPropertyPosition({
      x: Math.max(12, Math.min(window.innerWidth - 372, window.innerWidth / 2 - 180)),
      y: Math.max(152, Math.min(window.innerHeight - 490, window.innerHeight / 2 - 210)),
    });
    setPropertyOpen(true);
  };

  const startPropertyDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = propertyPosition;
    const handleMove = (moveEvent: PointerEvent) => {
      setPropertyPosition({
        x: Math.max(8, Math.min(window.innerWidth - 368, origin.x + moveEvent.clientX - startX)),
        y: Math.max(32, Math.min(window.innerHeight - 96, origin.y + moveEvent.clientY - startY)),
      });
    };
    const stop = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  const persistLayout = (next: LayoutState) => {
    localStorage.setItem("analog-studio.layout.v1", JSON.stringify(next));
  };

  const setPanelSize = (target: ResizeTarget, value: number, persist = false) => {
    const workspaceWidth = workspaceRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    const centerHeight = centerRef.current?.getBoundingClientRect().height ?? window.innerHeight;
    const current = layoutRef.current;
    let next: LayoutState;
    if (target === "left") {
      const max = Math.max(180, Math.min(420, workspaceWidth - current.rightWidth - 490));
      next = { ...current, leftWidth: Math.min(max, Math.max(180, value)) };
    } else if (target === "right") {
      const max = Math.max(280, Math.min(560, workspaceWidth - current.leftWidth - 490));
      next = { ...current, rightWidth: Math.min(max, Math.max(280, value)) };
    } else {
      const max = Math.max(96, Math.min(420, centerHeight - 245));
      next = { ...current, bottomHeight: Math.min(max, Math.max(96, value)) };
    }
    layoutRef.current = next;
    setLayout(next);
    if (persist) persistLayout(next);
  };

  const startPanelResize = (event: ReactPointerEvent<HTMLDivElement>, target: ResizeTarget) => {
    if (event.button !== 0) return;
    event.preventDefault();
    panelResizeCleanupRef.current?.();
    const startX = event.clientX;
    const startY = event.clientY;
    const initial = { ...layoutRef.current };
    window.document.body.classList.add("pane-resizing", target === "bottom" ? "row-resizing" : "column-resizing");
    const handleMove = (moveEvent: PointerEvent) => {
      if (target === "left") setPanelSize(target, initial.leftWidth + moveEvent.clientX - startX);
      if (target === "right") setPanelSize(target, initial.rightWidth - moveEvent.clientX + startX);
      if (target === "bottom") setPanelSize(target, initial.bottomHeight - moveEvent.clientY + startY);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
      window.document.body.classList.remove("pane-resizing", "row-resizing", "column-resizing");
      panelResizeCleanupRef.current = null;
      persistLayout(layoutRef.current);
    };
    panelResizeCleanupRef.current = cleanup;
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", cleanup);
    window.addEventListener("pointercancel", cleanup);
  };

  const handleSeparatorKey = (event: ReactKeyboardEvent<HTMLDivElement>, target: ResizeTarget) => {
    const step = event.shiftKey ? 32 : 8;
    if (target === "left" && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      setPanelSize(target, layoutRef.current.leftWidth + (event.key === "ArrowRight" ? step : -step), true);
    }
    if (target === "right" && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      setPanelSize(target, layoutRef.current.rightWidth + (event.key === "ArrowLeft" ? step : -step), true);
    }
    if (target === "bottom" && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      setPanelSize(target, layoutRef.current.bottomHeight + (event.key === "ArrowUp" ? step : -step), true);
    }
  };

  const resetPanelSize = (target: ResizeTarget) => {
    setPanelSize(target, DEFAULT_LAYOUT[target === "left" ? "leftWidth" : target === "right" ? "rightWidth" : "bottomHeight"], true);
  };

  const startPaletteDrag = (
    event: ReactMouseEvent<HTMLButtonElement>,
    item: { kind: DeviceKind; label: string; symbol: string },
  ) => {
    if (event.button !== 0) return;
    const next: PaletteDrag = {
      ...item,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
    paletteDragRef.current = next;
    setPaletteDrag(next);
    paletteDragCleanupRef.current?.();
    const handleMove = (moveEvent: MouseEvent) => {
      const current = paletteDragRef.current;
      if (!current) return;
      const distance = Math.hypot(moveEvent.clientX - current.startX, moveEvent.clientY - current.startY);
      const moved = current.moved || distance > 5;
      const updated = { ...current, x: moveEvent.clientX, y: moveEvent.clientY, moved };
      paletteDragRef.current = updated;
      setPaletteDrag(updated);
      if (moved) moveEvent.preventDefault();
    };
    const handleUp = (upEvent: MouseEvent) => {
      const current = paletteDragRef.current;
      paletteDragCleanupRef.current?.();
      if (current?.moved) {
        suppressPaletteClickRef.current = true;
        editorRef.current?.addDeviceAtClient(current.kind, upEvent.clientX, upEvent.clientY);
      }
      paletteDragRef.current = null;
      setPaletteDrag(null);
    };
    const cleanup = () => {
      window.removeEventListener("mousemove", handleMove, true);
      window.removeEventListener("mouseup", handleUp, true);
      paletteDragCleanupRef.current = null;
    };
    paletteDragCleanupRef.current = cleanup;
    window.addEventListener("mousemove", handleMove, true);
    window.addEventListener("mouseup", handleUp, true);
  };

  const netlistExt = dialect === "spectre" ? "scs" : "cir";
  const issueCount = compiled.issues.length;
  const cycleGridMode = () => {
    const next: GridMode = gridMode === "dot" ? "mesh" : gridMode === "mesh" ? "off" : "dot";
    setGridMode(next);
    editorRef.current?.setGridMode(next);
  };
  const activateToolMode = (mode: ToolMode) => {
    setToolMode(mode);
    editorRef.current?.setToolMode(mode);
  };
  const chooseWireDrawMode = (mode: WireDrawMode) => {
    setWireDrawMode(mode);
    editorRef.current?.setWireDrawMode(mode);
    setCommandOptionsOpen(false);
  };
  const gridModeLabel = gridMode === "dot" ? "格点" : gridMode === "mesh" ? "网格" : "关闭";

  return (
    <main
      className="workbench-shell"
      style={{
        "--left-pane-width": `${layout.leftWidth}px`,
        "--right-pane-width": `${layout.rightWidth}px`,
        "--bottom-pane-height": `${layout.bottomHeight}px`,
      } as CSSProperties}
    >
      <header className="app-header">
        <div className="quick-access" aria-label="快速访问工具栏">
          <div className="app-symbol" title="Analog Studio"><Waves size={16} /></div>
          <button title="保存并返回项目列表" onClick={() => void returnToProjects()}><ArrowLeft size={16} /></button>
          <button title="保存项目" onClick={() => void saveProject()}><Save size={16} /></button>
          <button title="撤销" onClick={() => editorRef.current?.undo()}><Undo2 size={16} /></button>
          <button title="重做" onClick={() => editorRef.current?.redo()}><Redo2 size={16} /></button>
        </div>
        <div className="window-title"><strong>{document.cell}</strong><span>— {projectName ?? document.project} · Analog Studio</span></div>
        <div className="window-tools">
          <span className={`local-state save-${saveState}`}><span className="status-dot" />{projectName ?? document.project}</span>
          <button className="header-action" onClick={() => setAgentOpen((value) => !value)}><Bot size={15} /> New Agent</button>
          <span className="user-avatar" aria-label={username || "账户"} title={username || "账户"}>{username.slice(0, 2).toUpperCase() || "AS"}</span>
        </div>
      </header>

      {saveState === "conflict" && <div className="save-conflict-banner" role="alert">
        <span><AlertTriangle size={14} />项目已在其他页面修改。本页内容尚未覆盖服务器版本。</span>
        <div>
          <button onClick={() => downloadText(`${document.cell}.local-conflict.schematic.json`, serializeSchematic(documentRef.current, true), "application/json")}>导出本地副本</button>
          <button onClick={() => window.location.reload()}>重新载入服务器版本</button>
        </div>
      </div>}

      <div className="primary-toolbar">
        <div className="tool-group" data-group="文件">
          <button className="tool-button" title="清空当前原理图" onClick={() => editorRef.current?.clear()}><FilePlus2 size={20} /><span>清空</span></button>
          <button className="tool-button" title="保存到账户项目" onClick={() => void saveProject()}><Save size={20} /><span>保存</span></button>
          <button className="tool-button" title="提取连接、运行规则检查并保存" onClick={() => void checkAndSave()}><CheckCircle2 size={20} /><span>检查保存</span></button>
          <button className="tool-button" title="保存并返回项目列表" onClick={() => void returnToProjects()}><FolderOpen size={20} /><span>项目</span></button>
          <button className="tool-button" title="导入 JSON" onClick={() => importRef.current?.click()}><Upload size={20} /><span>导入</span></button>
          <button className="tool-button" title="导出工程 JSON" onClick={() => downloadText(`${document.cell}.schematic.json`, serializeSchematic(document, true), "application/json")}><Download size={20} /><span>导出</span></button>
          <input ref={importRef} className="sr-only" type="file" accept="application/json,.json" onChange={importJson} />
        </div>
        <div className="toolbar-divider" />
        <div className="tool-group" data-group="历史记录">
          <button className="tool-button" title="撤销 Ctrl+Z" onClick={() => editorRef.current?.undo()}><Undo2 size={20} /><span>撤销</span></button>
          <button className="tool-button" title="重做 Ctrl+Y" onClick={() => editorRef.current?.redo()}><Redo2 size={20} /><span>重做</span></button>
        </div>
        <div className="toolbar-divider" />
        <div className="tool-group" data-group="工具">
          <button
            className={`tool-button ${toolMode === "select" ? "selected" : ""}`}
            title="选择模式（Esc）"
            aria-pressed={toolMode === "select"}
            onClick={() => activateToolMode("select")}
          ><MousePointer2 size={20} /><span>选择</span></button>
          <button
            className={`tool-button ${toolMode === "wire" ? "selected" : ""}`}
            title="连线模式（W）"
            aria-pressed={toolMode === "wire"}
            onClick={() => activateToolMode("wire")}
          ><Cable size={20} /><span>连线</span></button>
          <button
            className={`tool-button ${commandOptionsOpen ? "selected" : ""}`}
            title="当前命令选项（F3）"
            onClick={() => setCommandOptionsOpen((open) => !open)}
          ><Settings2 size={20} /><span>选项</span></button>
          <button
            className={`tool-button ${toolMode === "no-connect" ? "selected" : ""}`}
            title="添加/移除 No Connect 标记（N）"
            aria-pressed={toolMode === "no-connect"}
            onClick={() => activateToolMode("no-connect")}
          ><X size={20} /><span>不连接</span></button>
          <button className="tool-button" title="旋转 R" onClick={() => editorRef.current?.rotateSelected()}><RotateCw size={20} /><span>旋转</span></button>
          <button className="tool-button" title="镜像 X" onClick={() => editorRef.current?.mirrorSelected()}><FlipHorizontal2 size={20} /><span>镜像</span></button>
          <button className="tool-button danger-hover" title="删除" onClick={() => editorRef.current?.deleteSelected()}><Trash2 size={20} /><span>删除</span></button>
        </div>
        <div className="toolbar-divider" />
        <div className="tool-group" data-group="视图">
          <button className="tool-button" title="放大" onClick={() => editorRef.current?.zoomIn()}><ZoomIn size={20} /><span>放大</span></button>
          <button className="tool-button" title="缩小" onClick={() => editorRef.current?.zoomOut()}><ZoomOut size={20} /><span>缩小</span></button>
          <button className="tool-button" title="适合窗口" onClick={() => editorRef.current?.fit()}><Maximize2 size={20} /><span>适合</span></button>
          <button className={`tool-button grid-button ${gridMode !== "off" ? "selected" : ""}`} title="切换格点 / 网格 / 关闭" onClick={cycleGridMode}><Grid3X3 size={20} /><span>{gridModeLabel}</span></button>
        </div>
        <div className="header-spacer" />
        <button className="run-button"><Play size={21} fill="currentColor" /><span>运行仿真</span></button>
      </div>

      <section ref={workspaceRef} className={`workspace-grid ${agentOpen ? "" : "agent-closed"}`}>
        <aside className="left-sidebar panel-surface">
          <div className="sidebar-heading"><strong>器件</strong><span>Shapes</span></div>
          <div className="segmented-tabs compact-tabs">
            <button className={leftMode === "library" ? "active" : ""} onClick={() => setLeftMode("library")}><Library size={14} />器件库</button>
            <button className={leftMode === "project" ? "active" : ""} onClick={() => setLeftMode("project")}><FolderTree size={14} />工程</button>
          </div>
          {leftMode === "library" ? (
            <>
              <label className="search-box"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索器件 / PDK" /></label>
              <div className="library-breadcrumb"><span>analogLib</span><ChevronDown size={13} /></div>
              <div className="device-groups">
                {filteredGroups.map((group) => (
                  <section className="device-group" key={group.title}>
                    <h3>{group.title}<span>{group.items.length}</span></h3>
                    <div className="device-list">
                      {group.items.map((item) => (
                        <button
                          className="device-row"
                          key={item.kind}
                          onMouseDown={(event) => startPaletteDrag(event, item)}
                          onClick={() => {
                            if (suppressPaletteClickRef.current) {
                              suppressPaletteClickRef.current = false;
                              return;
                            }
                            editorRef.current?.addDevice(item.kind);
                          }}
                          title="点击或拖到画布"
                        >
                          <DeviceSymbolPreview kind={item.kind} />
                          <span className="device-copy"><strong>{item.label}</strong><small>{item.hint}</small></span>
                          <span className="drag-hint">⋮⋮</span>
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </>
          ) : (
            <div className="project-tree">
              <div className="tree-line root"><FolderTree size={15} /> {projectName ?? document.project}</div>
              <div className="tree-line"><Box size={14} /> schematic</div>
              <div className="tree-line active"><span className="tree-leaf">S</span> {document.cell} / schematic</div>
            </div>
          )}
          <div className="library-footer"><Settings2 size={14} /> PDK: generic_180nm <span>已加载</span></div>
        </aside>

        <div
          className="pane-splitter vertical"
          role="separator"
          aria-label="调节器件库宽度"
          aria-orientation="vertical"
          aria-valuemin={180}
          aria-valuemax={420}
          aria-valuenow={layout.leftWidth}
          tabIndex={0}
          onPointerDown={(event) => startPanelResize(event, "left")}
          onKeyDown={(event) => handleSeparatorKey(event, "left")}
          onDoubleClick={() => resetPanelSize("left")}
        />

        <section ref={centerRef} className="center-stack">
          <div className="document-tabs">
            <button className="document-tab active"><span className="tab-type">S</span> {document.cell} {saveState !== "saved" && <span className="tab-dirty">●</span>}</button>
            <button className="new-tab">+</button>
            <div className="canvas-context">Library: {document.project} · Cell: {document.cell} · View: schematic</div>
          </div>
          <div className={paletteDrag?.moved ? "canvas-frame drop-ready" : "canvas-frame"}>
            <SchematicCanvas
              ref={editorRef}
              initialDocument={document}
              toolMode={toolMode}
              wireDrawMode={wireDrawMode}
              onDocumentChange={(nextDocument) => {
                documentRef.current = nextDocument;
                setDocument(nextDocument);
              }}
              onSelectionChange={(node) => {
                setSelected(node);
                if (!node) closePropertyEditor();
              }}
              onNodeDoubleClick={openPropertyEditor}
              onToolModeChange={setToolMode}
              onWireDrawModeChange={setWireDrawMode}
              onCommandStateChange={setCommandState}
              onCommandOptionsRequest={() => setCommandOptionsOpen(true)}
              onViewportChange={setCanvasViewport}
              onCursorPositionChange={setCursorPosition}
            />
            {commandOptionsOpen && (
              <section className="command-options-popover" role="dialog" aria-label="连线命令选项">
                <header><strong>Command Options</strong><button title="关闭" onClick={() => setCommandOptionsOpen(false)}><X size={14} /></button></header>
                <span>正交连线路由方式</span>
                <div className="command-option-list">
                  {([
                    ["route", "自动正交"],
                    ["horizontal-first", "水平优先"],
                    ["vertical-first", "垂直优先"],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      className={wireDrawMode === value ? "active" : ""}
                      onClick={() => chooseWireDrawMode(value)}
                    >{label}</button>
                  ))}
                </div>
                <small>F3 打开 · Enter / 双击完成 · Backspace 撤回上一拐点 · Esc 分层取消</small>
              </section>
            )}
            <div className="ruler-corner" aria-hidden="true" />
            <div
              className="canvas-ruler horizontal"
              aria-hidden="true"
              style={{
                backgroundSize: `${ruler.step * canvasViewport.scale}px 8px, ${ruler.step * canvasViewport.scale / 5}px 4px`,
                backgroundPosition: `${canvasViewport.originX - 21}px 100%, ${canvasViewport.originX - 21}px 100%`,
              }}
            >
              {ruler.horizontal.map((value) => (
                <span
                  key={value}
                  style={{ left: canvasViewport.originX + value * canvasViewport.scale - 21 + 2 }}
                >
                  {value}
                </span>
              ))}
            </div>
            <div
              className="canvas-ruler vertical"
              aria-hidden="true"
              style={{
                backgroundSize: `8px ${ruler.step * canvasViewport.scale}px, 4px ${ruler.step * canvasViewport.scale / 5}px`,
                backgroundPosition: `100% ${canvasViewport.originY - 21}px, 100% ${canvasViewport.originY - 21}px`,
              }}
            >
              {ruler.vertical.map((value) => (
                <span
                  key={value}
                  style={{ top: canvasViewport.originY + value * canvasViewport.scale - 21 + 2 }}
                >
                  {value}
                </span>
              ))}
            </div>
            {toolMode === "wire" && <div className="wire-mode-hint"><Cable size={13} />{commandState.prompt} · Enter/双击完成 · Backspace 回退 · F3 选项 · F4 选择模式</div>}
            {toolMode === "no-connect" && <div className="wire-mode-hint"><X size={13} />{commandState.prompt} · N 进入 · Esc 退出</div>}
          </div>
          <div
            className="pane-splitter horizontal"
            role="separator"
            aria-label="调节底部面板高度"
            aria-orientation="horizontal"
            aria-valuemin={96}
            aria-valuemax={420}
            aria-valuenow={layout.bottomHeight}
            tabIndex={0}
            onPointerDown={(event) => startPanelResize(event, "bottom")}
            onKeyDown={(event) => handleSeparatorKey(event, "bottom")}
            onDoubleClick={() => resetPanelSize("bottom")}
          />
          <section className="bottom-panel panel-surface">
            <div className="bottom-panel-head">
              <div className="bottom-tabs">
                <button className={bottomTab === "netlist" ? "active" : ""} onClick={() => setBottomTab("netlist")}><FileDown size={14} />网表预览</button>
                <button className={bottomTab === "markers" ? "active" : ""} onClick={() => setBottomTab("markers")}><AlertTriangle size={14} />检查标记</button>
                <button className={bottomTab === "simulation" ? "active" : ""} onClick={() => setBottomTab("simulation")}><Activity size={14} />仿真结果</button>
                <button className={bottomTab === "console" ? "active" : ""} onClick={() => setBottomTab("console")}><Waves size={14} />控制台</button>
              </div>
              {bottomTab === "netlist" && (
                <div className="netlist-actions">
                  <div className="dialect-toggle">
                    <button className={dialect === "spectre" ? "active" : ""} onClick={() => setDialect("spectre")}>Spectre</button>
                    <button className={dialect === "spice" ? "active" : ""} onClick={() => setDialect("spice")}>SPICE</button>
                  </div>
                  <button className="mini-action" title="复制" onClick={() => navigator.clipboard.writeText(compiled.text)}><Copy size={14} /></button>
                  <button className="mini-action" title="下载" onClick={() => downloadText(`${document.cell}.${netlistExt}`, compiled.text)}><Download size={14} /></button>
                </div>
              )}
            </div>
            {bottomTab === "netlist" && (
              <div className="netlist-body">
                <div className="code-gutter">{compiled.text.split("\n").map((_, index) => <span key={index}>{index + 1}</span>)}</div>
                <pre>{compiled.text}</pre>
                <div className={`erc-summary ${issueCount ? "warning" : "ok"}`}>
                  {issueCount ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
                  {issueCount ? `${issueCount} 条 ERC 提示` : "ERC 通过"}
                  {issueCount > 0 && <span title={compiled.issues.map(readIssueMessage).join("\n")}>查看</span>}
                </div>
              </div>
            )}
            {bottomTab === "markers" && (
              <div className="marker-panel">
                <div className="marker-toolbar">
                  <button onClick={runCheck}><CheckCircle2 size={14} />运行检查</button>
                  <span>{document.markers.filter((marker) => marker.severity === "error").length} 错误 · {document.markers.filter((marker) => marker.severity === "warning").length} 警告</span>
                </div>
                <div className="marker-list" role="table" aria-label="原理图检查标记">
                  <div className="marker-row header" role="row"><span>Severity</span><span>Rule</span><span>Message</span><span>Object</span><span>Location</span></div>
                  {document.markers.length === 0 ? (
                    <div className="marker-empty"><CheckCircle2 size={18} />当前没有检查标记</div>
                  ) : document.markers.map((marker) => (
                    <button
                      className={`marker-row ${marker.severity}`}
                      role="row"
                      key={marker.id}
                      title="双击定位到画布标记"
                      onDoubleClick={() => editorRef.current?.focusMarker(marker.id)}
                    >
                      <span>{marker.severity}</span>
                      <code>{marker.ruleId}</code>
                      <span>{marker.message}</span>
                      <span>{marker.objectRefs.join(", ") || "—"}</span>
                      <span>{marker.boundingBox.x}, {marker.boundingBox.y}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {bottomTab === "simulation" && (
              <div className="simulation-placeholder">
                <div className="plot-area">
                  <span className="y-label">Gain (dB)</span><span className="x-label">Frequency (Hz)</span>
                  <svg viewBox="0 0 700 100" role="img" aria-label="仿真结果占位曲线"><polyline points="0,18 95,18 180,19 265,21 330,30 400,51 485,69 590,78 700,82" /></svg>
                </div>
                <div className="placeholder-copy"><Activity size={22} /><strong>仿真后端将在下一阶段接入</strong><span>预留 AC / DC / Transient 波形区域</span></div>
              </div>
            )}
            {bottomTab === "console" && <div className="console-lines"><span className="console-time">[19:42:08]</span> Schematic document loaded<br /><span className="console-time">[19:42:08]</span> Connectivity engine ready<br /><span className="console-time">[19:42:09]</span> Netlist compiled: {dialect}</div>}
          </section>
        </section>

        {agentOpen && (
          <>
            <div
              className="pane-splitter vertical dark"
              role="separator"
              aria-label="调节 New Agent 面板宽度"
              aria-orientation="vertical"
              aria-valuemin={280}
              aria-valuemax={560}
              aria-valuenow={layout.rightWidth}
              tabIndex={0}
              onPointerDown={(event) => startPanelResize(event, "right")}
              onKeyDown={(event) => handleSeparatorKey(event, "right")}
              onDoubleClick={() => resetPanelSize("right")}
            />
            <aside className="agent-sidebar" aria-label="New Agent">
              <div className="agent-tabbar">
                <div ref={agentTabsRef} className="agent-tabs-scroll" role="tablist" aria-label="Agent 会话">
                  {agentSessions.map((session) => (
                    <div
                      className={`agent-session-tab ${session.id === activeAgentId ? "active" : ""}`}
                      role="tab"
                      aria-selected={session.id === activeAgentId}
                      tabIndex={session.id === activeAgentId ? 0 : -1}
                      key={session.id}
                      onClick={() => setActiveAgentId(session.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setActiveAgentId(session.id);
                        }
                      }}
                    >
                      <MessageSquare size={15} />
                      <span>{session.title}</span>
                      <button
                        title={`关闭 ${session.title}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          closeAgentSession(session.id);
                        }}
                      ><X size={15} /></button>
                    </div>
                  ))}
                </div>
                <div className="agent-tab-actions">
                  <button title="新建 Agent 会话" onClick={createAgentSession}><Plus size={17} /></button>
                  <button title="历史记录"><Clock3 size={16} /></button>
                  <button title="更多"><MoreHorizontal size={17} /></button>
                </div>
              </div>
              <div className={`agent-composer ${activeAgent?.attachments.length ? "has-attachments" : ""}`}>
                {!!activeAgent?.attachments.length && (
                  <div className="agent-attachment-strip" aria-label="待发送的截图">
                    {activeAgent.attachments.map((attachment) => (
                      <figure className="agent-attachment" key={attachment.id}>
                        <Image
                          src={attachment.previewUrl}
                          alt={`截图附件 ${attachment.name}`}
                          width={attachment.width}
                          height={attachment.height}
                          draggable={false}
                          unoptimized
                        />
                        <figcaption>{attachment.width} × {attachment.height}</figcaption>
                        <button
                          type="button"
                          title="删除这张截图"
                          aria-label={`删除截图 ${attachment.name}`}
                          onClick={() => removeAgentAttachment(attachment.id)}
                        ><X size={12} /></button>
                      </figure>
                    ))}
                  </div>
                )}
                {!!agentAttachmentNotices[activeAgentId] && (
                  <div className="agent-composer-notice" role="status">{agentAttachmentNotices[activeAgentId]}</div>
                )}
                <textarea
                  value={activeAgent?.input ?? ""}
                  onChange={(event) => updateAgentInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      sendAgentPlaceholder();
                    }
                  }}
                  placeholder="Plan, Build, / for commands, @ for context"
                  aria-label={`向 ${activeAgent?.title ?? "New Agent"} 输入任务`}
                />
                <div className="agent-composer-footer">
                  <div className="agent-composer-modes">
                    <button className="agent-mode"><Bot size={14} /> Agent <ChevronDown size={12} /></button>
                    <button className="agent-model">Auto <ChevronDown size={12} /></button>
                  </div>
                  <div className="agent-composer-actions">
                    <button
                      ref={agentScreenshotButtonRef}
                      type="button"
                      title="自由框选截图"
                      aria-label="自由框选截图"
                      onClick={startAgentScreenshot}
                    >
                      <Scissors size={15} />
                    </button>
                    <button
                      className={agentHasDraft ? "agent-submit ready" : "agent-submit"}
                      title={agentHasDraft ? "发送" : "语音输入"}
                      onClick={agentHasDraft ? sendAgentPlaceholder : undefined}
                    >
                      {agentHasDraft ? <Send size={15} /> : <Mic size={16} />}
                    </button>
                  </div>
                </div>
              </div>
              <div className="agent-thread">
                {(activeAgent?.messages ?? []).map((message) => (
                  <div className={message.role === "user" ? "agent-message user" : "agent-message"} key={message.id}>
                    <span>{message.text}</span>
                    {!!message.attachments?.length && (
                      <div className="agent-message-attachments">
                        {message.attachments.map((attachment) => (
                          <Image
                            src={attachment.previewUrl}
                            alt={`已发送截图 ${attachment.name}`}
                            width={attachment.width}
                            height={attachment.height}
                            key={attachment.id}
                            unoptimized
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="agent-status"><span />截图工具可用 · AI 接管待规划</div>
            </aside>
          </>
        )}
      </section>

      <footer className="status-bar">
        <div className="status-ready"><span className="ready-dot" />{commandState.prompt} · ERC {issueCount ? `${issueCount} 提示` : "通过"}</div>
        <div>模式：{toolMode === "select" ? "选择" : toolMode === "wire" ? `连线 · ${wireDrawMode}` : "No Connect"}</div><div>选择：{commandState.partialSelection ? "部分" : "完全包含"}</div><div>主网格：{gridModeLabel} · {document.displayGrid} DBU</div><div>吸附：{document.snapGrid} DBU</div><div>Objects: {document.nodes.length + document.edges.length + document.noConnects.length}</div><div>Nets: {compiled.nets.length}</div><div>{document.revisions.connectivityRevision === document.revisions.designRevision ? "Connectivity: Current" : "Connectivity: Stale"}</div>
        <div className="status-spacer" />
        <div className="status-coordinate">
          {cursorPosition
            ? `x: ${cursorPosition.x.toFixed(0)}   y: ${cursorPosition.y.toFixed(0)}`
            : "x: —   y: —"}
        </div>
        <div className="status-saved">保存：{savedAt}</div>
        <div className="status-zoom">
          <button title="缩小" onClick={() => editorRef.current?.zoomOut()}>−</button>
          <span className="zoom-track"><i /></span>
          <button title="放大" onClick={() => editorRef.current?.zoomIn()}>+</button>
          <button className="zoom-fit" title="适合窗口" onClick={() => editorRef.current?.fit()}>适合</button>
        </div>
      </footer>

      {propertyOpen && selected && propertyDraft && propertyDraft.nodeId === selected.id && (
        <section
          className="property-float"
          role="dialog"
          aria-modal="false"
          aria-label={`${selected.instanceName} 器件属性`}
          style={{
            left: propertyPosition.x,
            top: propertyPosition.y,
            maxHeight: `calc(100vh - ${propertyPosition.y + 8}px)`,
          }}
        >
          <div className="property-float-titlebar" onPointerDown={startPropertyDrag}>
            <span className={`large-device-glyph kind-${selected.kind}`}>{selected.kind.slice(0, 2).toUpperCase()}</span>
            <div><strong>器件属性</strong><span>{selected.instanceName} · {selected.kind}</span></div>
            <button title="关闭属性窗口并放弃未应用修改" onClick={closePropertyEditor}><X size={16} /></button>
          </div>
          <div className="property-float-body">
            <section className="property-section">
              <h3>器件参数 <ChevronDown size={13} /></h3>
              <div className="property-grid">
                <label>
                  <span>实例名</span>
                  <input value={propertyDraft.instanceName} onChange={(event) => updatePropertyDraft("instanceName", event.target.value)} />
                </label>
                {Object.entries(propertyDraft.properties).map(([key, value]) => (
                  <label key={key}>
                    <span>{PROPERTY_LABELS[key] ?? key}</span>
                    <input value={String(value)} onChange={(event) => updatePropertyDraft(key, event.target.value)} />
                  </label>
                ))}
              </div>
            </section>
            <section className="property-section">
              <h3>放置 <ChevronDown size={13} /></h3>
              <div className="placement-grid">
                <label><span>{selected.kind === "nmos4" || selected.kind === "pmos4" ? "X（G 原点）" : "X"}</span><input readOnly value={Math.round(selected.x)} /></label>
                <label><span>{selected.kind === "nmos4" || selected.kind === "pmos4" ? "Y（G 原点）" : "Y"}</span><input readOnly value={Math.round(selected.y)} /></label>
                <button onClick={() => editorRef.current?.rotateSelected()}><RotateCw size={14} /> {selected.rotation ?? 0}°</button>
                <button onClick={() => editorRef.current?.mirrorSelected()}><FlipHorizontal2 size={14} /> 镜像</button>
              </div>
            </section>
            <section className="property-section">
              <h3>连接网络 <ChevronDown size={13} /></h3>
              <div className="pin-list">
                {selectedConnections.map((connection) => (
                  <div className={connection.open ? "pin-row open" : "pin-row"} key={connection.pin}>
                    <b>{connection.pin}</b><span>{connection.label}</span><code>{connection.open ? "未连接" : connection.net}</code>
                  </div>
                ))}
                <small>MOS 网表固定引脚顺序 D / G / S / B</small>
              </div>
            </section>
          </div>
          <div className="property-float-footer"><span>点击应用后作为一次事务写入</span><div><button className="secondary" onClick={closePropertyEditor}>取消</button><button onClick={applyPropertyDraft}>应用</button></div></div>
        </section>
      )}
      {paletteDrag?.moved && (
        <div className="device-drag-ghost" style={{ left: paletteDrag.x + 12, top: paletteDrag.y + 12 }}>
          <DeviceSymbolPreview kind={paletteDrag.kind} /><strong>{paletteDrag.label}</strong>
        </div>
      )}
      {screenshotOpen && (
        <FlexibleScreenshotOverlay onCancel={cancelAgentScreenshot} onComplete={completeAgentScreenshot} />
      )}
    </main>
  );
}
