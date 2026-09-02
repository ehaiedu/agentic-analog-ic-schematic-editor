"use client";

import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowUp,
  Bot,
  Box,
  Cable,
  Scissors,
  CheckCircle2,
  ChevronDown,
  CircleStop,
  Clock3,
  Copy,
  Download,
  FileCode2,
  FileDown,
  FileText,
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
  Paperclip,
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
import katex from "katex";
import "katex/dist/katex.min.css";
import {
  ChangeEvent,
  Fragment,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
  type CSSProperties,
  type ReactNode,
  useEffect,
  useId,
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
import { compileHierarchicalNetlist, compileNetlist, type NetlistDialect } from "../lib/netlist";
import { buildAnnotatedNetlistPreview, highlightNetlistLine } from "../lib/netlistPreview";
import { importNetlistAsSchematic } from "../lib/netlistImport";
import {
  buildPvtMetricMatrix,
  defaultOptimizationMetricsForFlavor,
  inferMetricFlavor,
  metricProfileForFlavor,
  optimizationMetricsFromDocument,
  parsePerRoundMetrics,
  summarizeOptimizationMetrics,
  waveformPanelsForRound,
  withOptimizationMetricsExtension,
  type CircuitMetricFlavor,
  type OptimizationMetricSummary,
  type OptimizationRoundMetric,
  type PvtMetricMatrixSummary,
  type WaveformPanel,
  type WaveformTrace,
} from "../lib/optimizationMetrics";
import {
  agentTimeline,
  metricsFromAgentTrace,
  parseAgentTrace,
  type ReleaseFamily,
} from "../lib/analogweaveAgent";
import {
  appendAgentMessage,
  createPersistedConversation,
  deleteUnboundAgentFile,
  listAgentConversations,
  listAgentModels,
  loadAgentConversation,
  requestProjectModelResponse,
  uploadAgentFile,
  updatePersistedConversation,
  type PersistedAgentAttachment,
  type PersistedAgentMessage,
} from "../lib/agentHistory";
import {
  AGENT_MODEL_LABELS,
  AGENT_MODEL_ROUTES,
  type AgentModelCatalogItem,
  type AgentModelRoute,
} from "../lib/agentModels";
import { inferReleaseFamily, release1Targets, requestsSpegExecution } from "../lib/release1Intent";
import {
  defaultSimulationSession,
  simulationParameters,
  simulationOperation,
  simulationSessionPrompt,
  type SimulationSessionConfig,
} from "../lib/simulationSession";
import { cancelSpegJob, getSpegResult, submitSpegJob, waitForSpegJob } from "../lib/spegClient";
import {
  buildCadenceSchematicConvertorRequest,
  parseCadenceConvertorReport,
  type CadenceConvertorReportSummary,
  type CadenceSchematicConvertorRequest,
} from "../lib/schematicConvertor";
import { inspectSchematicProvenance } from "../lib/schematicProvenance";
import { buildCadenceOaExportPackage } from "../lib/cadenceOaExport";
import {
  importCadenceBuildPlanAsSchematic,
  isCadenceBuildPlan,
} from "../lib/cadenceBuildPlanImport";
import {
  DEFAULT_PDK_PROFILE_ID,
  buildPdkRequestContract,
  pdkRegistrySummary,
  pdkStatusLabel,
  resolvePdkRegistryEntry,
  selectablePdkEntries,
} from "../lib/pdkRegistry";
import {
  buildOptimizationRunRequest,
  type OptimizationRunRequest,
  type OptimizationWorkflowMode,
} from "../lib/optimizationWorkflow";
import {
  CANVAS_MAX_SCALE,
  CANVAS_MIN_SCALE,
  normalizeCanvasRotation,
} from "../lib/canvasViewport";
import {
  SUBCIRCUIT_TEMPLATES,
  type SubcircuitTemplateKind,
} from "../lib/subcircuitTemplates";
import {
  hierarchyCellView,
  resolveHierarchyCellView,
  rootCellKey,
  withHierarchyCellView,
  type HierarchyFrame,
} from "../lib/hierarchy";
import {
  buildHierarchicalSchematicExchange,
  isHierarchicalSchematicExchange,
  parseHierarchicalSchematicExchange,
} from "../lib/hierarchicalExchange";
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
import { SubcircuitTemplatePreview } from "./SubcircuitTemplatePreview";
import {
  FlexibleScreenshotOverlay,
  type ScreenshotCapture,
} from "./FlexibleScreenshotOverlay";

type BottomTab = "setup" | "netlist" | "markers" | "simulation" | "waveforms" | "statistics" | "console";
type CenterViewTab = "schematic" | "waveform";
type ResizeTarget = "left" | "right" | "bottom";
type LayoutState = {
  leftWidth: number;
  rightWidth: number;
  bottomHeight: number;
};
type AgentAttachment = {
  id: string;
  name: string;
  blob?: Blob;
  previewUrl: string;
  width: number;
  height: number;
  mediaType?: string;
  sizeBytes?: number;
  sha256?: string;
  direction?: "input" | "output";
};

const AGENT_FILE_ACCEPT = ".png,.jpg,.jpeg,.webp,.pdf,.txt,.md,.py,.json,.csv,.yaml,.yml,.sp,.scs,.cir,.cdl,.va,.vams,.il,.skill";
const AGENT_FILE_EXTENSIONS: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
  pdf: "application/pdf", txt: "text/plain", md: "text/markdown", py: "text/x-python",
  json: "application/json", csv: "text/csv", yaml: "text/plain", yml: "text/plain",
  sp: "text/plain", scs: "text/plain", cir: "text/plain", cdl: "text/plain", va: "text/plain",
  vams: "text/plain", il: "text/plain", skill: "text/plain",
};

function agentFileMediaType(file: File): string {
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  if (file.type === "application/octet-stream" || !file.type) return AGENT_FILE_EXTENSIONS[extension] ?? "application/octet-stream";
  return file.type;
}

function isAgentImage(attachment: Pick<AgentAttachment, "mediaType" | "name">): boolean {
  return Boolean(attachment.mediaType?.startsWith("image/")) || /\.(?:png|jpe?g|webp)$/iu.test(attachment.name);
}

function formatAttachmentSize(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
type AgentMessage = {
  id: string;
  sequence?: number;
  role: "user" | "assistant";
  text: string;
  attachments?: AgentAttachment[];
  kind?: string;
  title?: string;
  status?: "info" | "proposed" | "approved" | "running" | "passed" | "failed";
  code?: string;
  metrics?: Record<string, unknown>;
  evidenceLevel?: string;
  modelId?: string;
  jobId?: string;
};

function formatAgentMetric(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function renderAgentFormula(value: string, displayMode: boolean): ReactNode {
  const html = katex.renderToString(value.trim(), {
    displayMode,
    throwOnError: false,
    trust: false,
    strict: "ignore",
    output: "htmlAndMathml",
  });
  return displayMode
    ? <div className="agent-message-formula" dangerouslySetInnerHTML={{ __html: html }} />
    : <span className="agent-inline-formula" dangerouslySetInnerHTML={{ __html: html }} />;
}

function renderInlineAgentText(value: string, keyPrefix: string): ReactNode[] {
  const parts = value.split(/(`[^`]+`|\*\*[^*]+\*\*|\$\$[^$]+\$\$|\$[^$\n]+\$|\\\([^\n]+\\\))/g);
  return parts.filter(Boolean).map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code className="agent-inline-code" key={key}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if ((part.startsWith("$") && part.endsWith("$")) || (part.startsWith("\\(") && part.endsWith("\\)"))) {
      return <Fragment key={key}>{renderAgentFormula(part.replace(/^\$|\$$/g, "").replace(/^\\\(|\\\)$/g, ""), false)}</Fragment>;
    }
    return <span key={key}>{part}</span>;
  });
}

function renderAgentText(text: string): ReactNode {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (line.trim().startsWith("```")) {
      const language = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(<pre className="agent-message-inline-code-block" key={`fenced-code-${index}`}><code data-language={language || undefined}>{codeLines.join("\n")}</code></pre>);
      continue;
    }
    if (line.trim().startsWith("$$") || line.trim().startsWith("\\[")) {
      const opening = line.trim().startsWith("\\[") ? "\\]" : "$$";
      const formulaLines = [line.trim().replace(/^\$\$|^\\\[|\$\$$|\\\]$/g, "")];
      index += 1;
      while (index < lines.length && !lines[index].trim().endsWith(opening)) {
        formulaLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        formulaLines.push(lines[index].trim().replace(/\$\$$|\\\]$/g, ""));
        index += 1;
      }
      blocks.push(<Fragment key={`formula-${index}`}>{renderAgentFormula(formulaLines.join("\n").trim(), true)}</Fragment>);
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      blocks.push(<h4 className={`agent-message-heading level-${heading[1].length}`} key={`heading-${index}`}>{renderInlineAgentText(heading[2], `heading-${index}`)}</h4>);
      index += 1;
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const match = lines[index].match(/^\s*[-*]\s+(.+)$/);
        if (!match) break;
        items.push(<li key={`bullet-${index}`}>{renderInlineAgentText(match[1], `bullet-${index}`)}</li>);
        index += 1;
      }
      blocks.push(<ul className="agent-message-list" key={`list-${index}`}>{items}</ul>);
      continue;
    }
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (numbered) {
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const match = lines[index].match(/^\s*\d+[.)]\s+(.+)$/);
        if (!match) break;
        items.push(<li key={`number-${index}`}>{renderInlineAgentText(match[1], `number-${index}`)}</li>);
        index += 1;
      }
      blocks.push(<ol className="agent-message-list" key={`ordered-${index}`}>{items}</ol>);
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim()) {
      if (paragraph.length && (/^(#{1,3})\s+/.test(lines[index]) || /^\s*[-*]\s+/.test(lines[index]) || /^\s*\d+[.)]\s+/.test(lines[index]))) break;
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(<p key={`paragraph-${index}`}>{paragraph.map((part, partIndex) => <Fragment key={`${index}-${partIndex}`}>{partIndex ? <br /> : null}{renderInlineAgentText(part, `paragraph-${index}-${partIndex}`)}</Fragment>)}</p>);
  }
  return blocks;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function liveResultDetails(result: unknown): {
  metrics: Record<string, unknown>;
  evidenceLevel: string;
  summary: string;
  passed: boolean;
} {
  const root = objectRecord(result);
  const round = objectRecord(root.round_00 ?? root);
  const assessment = objectRecord(round.assessment);
  const passed = assessment.full_metric_targets_passed === true;
  const blockers = Array.isArray(assessment.blockers) ? assessment.blockers.map(String).filter(Boolean) : [];
  return {
    metrics: objectRecord(round.metrics ?? root.metrics),
    evidenceLevel: typeof assessment.evidence_level === "string" ? assessment.evidence_level : "transistor_nominal",
    summary: passed
      ? "Spectre nominal targets passed."
      : `Spectre nominal run is valid but requires repair${blockers.length ? `: ${blockers.join("; ")}` : "."}`,
    passed,
  };
}
type AgentSession = {
  id: string;
  title: string;
  input: string;
  messages: AgentMessage[];
  attachments: AgentAttachment[];
  modelRoute: AgentModelRoute;
  persisted?: boolean;
  loaded?: boolean;
  updatedAt?: number;
};

const INITIAL_AGENT_MODELS: AgentModelCatalogItem[] = AGENT_MODEL_ROUTES.map((route) => ({
  route,
  label: AGENT_MODEL_LABELS[route],
  description: route === "auto" ? "自动选择可用模型" : "等待服务状态",
  configured: route === "auto",
}));

function persistedAttachment(value: PersistedAgentAttachment): AgentAttachment {
  return {
    id: value.id,
    name: value.name,
    previewUrl: value.url,
    width: value.width || 640,
    height: value.height || 480,
    mediaType: value.mediaType,
    sizeBytes: value.sizeBytes,
    sha256: value.sha256,
    direction: value.direction,
  };
}

function persistedMessage(value: PersistedAgentMessage): AgentMessage {
  return {
    id: value.id,
    sequence: value.sequence,
    role: value.role,
    text: value.text,
    kind: value.kind,
    title: value.title,
    status: value.status,
    code: value.code,
    metrics: value.metrics,
    evidenceLevel: value.evidenceLevel,
    modelId: value.modelId,
    attachments: value.attachments.map(persistedAttachment),
  };
}

function persistedMessageInput(message: AgentMessage) {
  return {
    id: message.id,
    role: message.role,
    kind: message.kind ?? "",
    status: message.status ?? "info",
    title: message.title ?? "",
    text: message.text,
    code: message.code,
    metrics: message.metrics,
    evidenceLevel: message.evidenceLevel,
    modelId: message.modelId,
  };
}
type PaletteDeviceItem = {
  type: "device";
  kind: DeviceKind;
  label: string;
  symbol: string;
  hint: string;
};
type PaletteTemplateItem = {
  type: "template";
  kind: SubcircuitTemplateKind;
  label: string;
  symbol: string;
  hint: string;
};
type PaletteItem = PaletteDeviceItem | PaletteTemplateItem;
type PaletteDrag = {
  item: PaletteItem;
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
  rotation: 0,
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

function deviceItem(kind: DeviceKind, label: string, symbol: string, hint: string): PaletteDeviceItem {
  return { type: "device", kind, label, symbol, hint };
}

function templateItem(kind: SubcircuitTemplateKind): PaletteTemplateItem {
  const definition = SUBCIRCUIT_TEMPLATES.find((candidate) => candidate.kind === kind);
  if (!definition) throw new Error(`Unknown template ${kind}`);
  return {
    type: "template",
    kind,
    label: definition.label,
    symbol: definition.shortLabel,
    hint: definition.hint,
  };
}

function PaletteSymbolPreview({ item }: { item: PaletteItem }) {
  if (item.type === "device") return <DeviceSymbolPreview kind={item.kind} />;
  const definition = SUBCIRCUIT_TEMPLATES.find((candidate) => candidate.kind === item.kind);
  return <SubcircuitTemplatePreview kind={definition?.preview ?? "transmission-gate"} />;
}

const DEVICE_GROUPS: Array<{
  title: string;
  items: PaletteItem[];
}> = [
  {
    title: "MOS 晶体管",
    items: [
      deviceItem("nmos4", "NMOS 4端", "NM", "D/G/S/B"),
      deviceItem("pmos4", "PMOS 4端", "PM", "D/G/S/B"),
      deviceItem("diode", "二极管", "D", "A/K"),
      deviceItem("npn3", "NPN BJT", "QN", "C/B/E"),
      deviceItem("pnp3", "PNP BJT", "QP", "C/B/E"),
    ],
  },
  {
    title: "无源器件",
    items: [
      deviceItem("resistor", "电阻", "R", "res"),
      deviceItem("capacitor", "电容", "C", "cap"),
      deviceItem("inductor", "电感", "L", "ind"),
    ],
  },
  {
    title: "激励与端口",
    items: [
      deviceItem("vsource", "电压源", "V", "vdc"),
      deviceItem("isource", "电流源", "I", "idc"),
      deviceItem("vcvs", "VCVS", "E", "gain"),
      deviceItem("vccs", "VCCS", "G", "gm"),
      deviceItem("switch4", "理想开关", "S", "ctrl"),
      deviceItem("input", "输入端口", "IN", "pin"),
      deviceItem("output", "输出端口", "OUT", "pin"),
      deviceItem("bidir", "双向端口", "IO", "pin"),
    ],
  },
  {
    title: "ADC MOS 级子电路",
    items: [
      templateItem("sample_hold_cmos"),
      templateItem("transmission_gate_cmos"),
      templateItem("cdac_bit_slice_cmos"),
      templateItem("strongarm_comparator_cmos"),
    ],
  },
  {
    title: "运放 / 比较器 MOS 级",
    items: [
      templateItem("nmos_diff_pair_cmos"),
      templateItem("pmos_current_mirror_cmos"),
      templateItem("ota_5t_cmos"),
      templateItem("strongarm_comparator_cmos"),
    ],
  },
  {
    title: "层次实例 / 可自定义宏",
    items: [
      deviceItem("subckt4", "子电路 4端", "X4", "cell / editable master"),
      deviceItem("subckt5", "子电路 5端", "X5", "cell / editable master"),
      deviceItem("subckt6", "子电路 6端", "X6", "cell / editable master"),
      deviceItem("subckt7", "子电路 7端", "X7", "cell / editable master"),
      deviceItem("subckt8", "子电路 8端", "X8", "cell / editable master"),
      deviceItem("subckt11", "子电路 11端", "X11", "cell / generated hierarchy"),
      deviceItem("subckt12", "子电路 12端", "X12", "cell / generated hierarchy"),
      deviceItem("sar_logic", "SAR 逻辑接口", "SAR", "digital ctrl / subckt"),
    ],
  },
  {
    title: "网络标识",
    items: [
      deviceItem("vdd", "VDD", "VDD", "global"),
      deviceItem("gnd", "VSS / GND", "0", "global"),
      deviceItem("netlabel", "网络标签", "#", "name"),
      deviceItem("junction", "连接点", "•", "join"),
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
  gain: "增益",
  gm: "跨导",
  ron: "导通电阻",
  roff: "关断电阻",
  vt: "阈值",
  vh: "迟滞",
  area: "面积因子",
  ratio: "镜像比例",
  bits: "位数",
  unitCap: "单位电容",
  current: "偏置电流",
  master: "Master Cell",
  templateKind: "模板类型",
  templateLabel: "模板名称",
  templateInstance: "模板实例名",
  templateRole: "模板内角色",
  editablePrimitive: "可编辑 Primitive",
  hierarchyChildKey: "下钻 CellView",
  hierarchyCell: "子电路 Cell",
  hierarchyLibrary: "子电路 Library",
  hierarchyView: "子电路 View",
  hierarchyEditable: "可下钻编辑",
  portOrder: "端口顺序",
  port_A: "端口 A",
  port_B: "端口 B",
  port_C: "端口 C",
  port_D: "端口 D",
  port_E: "端口 E",
  port_F: "端口 F",
  port_G: "端口 G",
  port_H: "端口 H",
  port_I: "端口 I",
  port_J: "端口 J",
  port_K: "端口 K",
  port_L: "端口 L",
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

const NETLIST_EXPORTS: Array<{ value: NetlistDialect; label: string; extension: string; mime: string }> = [
  { value: "spectre", label: "Spectre", extension: "scs", mime: "text/plain" },
  { value: "spice", label: "SPICE", extension: "cir", mime: "text/plain" },
  { value: "cdl", label: "CDL", extension: "cdl", mime: "text/plain" },
  { value: "empyrean_cdl", label: "Empyrean", extension: "empyrean.cdl", mime: "text/plain" },
  { value: "oa_exchange", label: "OA Exchange", extension: "oa.json", mime: "application/json" },
  { value: "cadence_skill", label: "SKILL", extension: "il", mime: "text/plain" },
];

function readIssueMessage(issue: unknown) {
  if (typeof issue === "string") return issue;
  if (issue && typeof issue === "object" && "message" in issue) {
    return String((issue as { message: unknown }).message);
  }
  return "未知 ERC 提示";
}

function cellNameFromFile(filename: string): string {
  const stem = filename
    .replace(/\.[^.]+$/, "")
    .replace(/\.(schematic|netlist|spectre|spice|cdl|cir|scs|spi)$/i, "");
  const cleaned = stem.replace(/[^A-Za-z0-9_]/g, "_");
  const identifier = /^[A-Za-z_]/.test(cleaned) ? cleaned : `_${cleaned}`;
  return (identifier || "imported_netlist").slice(0, 48);
}

function shouldImportAsJson(filename: string, text: string): boolean {
  return filename.toLowerCase().endsWith(".json") || text.trimStart().startsWith("{");
}

const WORKFLOW_MODE_LABELS: Record<OptimizationWorkflowMode, string> = {
  auto: "Auto",
  end_to_end_generate_optimize: "End-to-End",
  prompt_directed_modify_optimize: "Patch",
};

type MetricDisplayColumn = {
  key: keyof OptimizationRoundMetric & string;
  label: string;
  unit: string;
  digits: number;
  lowerIsBetter?: boolean;
};

const SAR_DIAGNOSTIC_COLUMNS: MetricDisplayColumn[] = [
  { key: "validEdgeCount", label: "Valid edges", unit: "", digits: 0 },
  { key: "codeTransitionCount", label: "Code trans.", unit: "", digits: 0 },
  { key: "missingCodeCount", label: "Missing code", unit: "", digits: 0, lowerIsBetter: true },
  { key: "dnlLsbP2p", label: "DNL p2p", unit: "LSB", digits: 1, lowerIsBetter: true },
  { key: "inlLsbP2p", label: "INL p2p", unit: "LSB", digits: 1, lowerIsBetter: true },
];

function formatMetricValue(value: number | undefined, suffix: string, digits = 2): string {
  if (value === undefined) return "—";
  const formatted = value.toFixed(digits);
  return suffix ? `${formatted} ${suffix}` : formatted;
}

function formatDeltaValue(value: number | undefined, suffix: string, digits = 2): string {
  if (value === undefined || Math.abs(value) < 1e-9) return "—";
  const formatted = `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
  return suffix ? `${formatted} ${suffix}` : formatted;
}

function metricClass(value: number | undefined, lowerIsBetter = false): string {
  if (value === undefined || Math.abs(value) < 1e-9) return "";
  const good = lowerIsBetter ? value < 0 : value > 0;
  return good ? "positive" : "negative";
}

function metricValue(metric: OptimizationRoundMetric | undefined, column: MetricDisplayColumn): number | undefined {
  const value = metric?.[column.key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function metricDeltaValue(row: OptimizationRoundMetric & {
  deltaFromPrevious: Record<string, number | undefined>;
}, column: MetricDisplayColumn): number | undefined {
  return row.deltaFromPrevious[column.key];
}

function metricInitialDeltaValue(row: OptimizationRoundMetric & {
  deltaFromInitial: Record<string, number | undefined>;
}, column: MetricDisplayColumn): number | undefined {
  return row.deltaFromInitial[column.key];
}

function bestMetric(summary: OptimizationMetricSummary, column: MetricDisplayColumn): OptimizationRoundMetric | undefined {
  const knownBest = (summary.best as Record<string, OptimizationRoundMetric | undefined>)[column.key];
  if (knownBest) return knownBest;
  return summary.rows
    .filter((row) => metricValue(row, column) !== undefined)
    .reduce<OptimizationRoundMetric | undefined>((best, row) => {
      if (!best) return row;
      const value = metricValue(row, column)!;
      const bestValue = metricValue(best, column)!;
      return column.lowerIsBetter ? value < bestValue ? row : best : value > bestValue ? row : best;
    }, undefined);
}

function metricSeries(
  metrics: readonly OptimizationRoundMetric[],
  column: MetricDisplayColumn,
): Array<{ round: number; value: number }> {
  return [...metrics]
    .sort((left, right) => left.round - right.round)
    .flatMap((metric) => {
      const value = metricValue(metric, column);
      return value === undefined ? [] : [{ round: metric.round, value }];
    });
}

function metricProgressText(metrics: readonly OptimizationRoundMetric[], column: MetricDisplayColumn): string {
  const series = metricSeries(metrics, column);
  if (series.length < 2) return "需要更多 round";
  const first = series[0];
  const last = series.at(-1)!;
  const change = last.value - first.value;
  return `R${first.round}->R${last.round} ${formatDeltaValue(change, column.unit, column.digits)}`;
}

function metricProgressClass(metrics: readonly OptimizationRoundMetric[], column: MetricDisplayColumn): string {
  const series = metricSeries(metrics, column);
  if (series.length < 2) return "";
  const change = series.at(-1)!.value - series[0].value;
  return metricClass(change, column.lowerIsBetter);
}

function MetricTrendSparkline({
  metrics,
  column,
}: {
  metrics: readonly OptimizationRoundMetric[];
  column: MetricDisplayColumn;
}) {
  const series = metricSeries(metrics, column);
  if (!series.length) return <span className="metric-sparkline empty" />;
  const width = 320;
  const height = 64;
  const padX = 10;
  const padY = 9;
  const minRound = Math.min(...series.map((point) => point.round));
  const maxRound = Math.max(...series.map((point) => point.round));
  const minValue = Math.min(...series.map((point) => point.value));
  const maxValue = Math.max(...series.map((point) => point.value));
  const xRange = Math.max(1, maxRound - minRound);
  const yRange = Math.max(1e-9, maxValue - minValue);
  const points = series.map((point) => {
    const x = padX + ((point.round - minRound) / xRange) * (width - padX * 2);
    const y = height - padY - ((point.value - minValue) / yRange) * (height - padY * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const trendClass = metricProgressClass(metrics, column) || "flat";
  return (
    <svg className={`metric-sparkline ${trendClass}`} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${column.label} enlarged optimization trend`}>
      <line x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} />
      {series.length === 1 ? (
        <circle cx={width / 2} cy={height / 2} r={3.6} />
      ) : (
        <polyline points={points} />
      )}
      {series.map((point) => {
        const x = padX + ((point.round - minRound) / xRange) * (width - padX * 2);
        const y = height - padY - ((point.value - minValue) / yRange) * (height - padY * 2);
        return <circle key={`${column.key}-${point.round}`} cx={x} cy={y} r={2.8} />;
      })}
    </svg>
  );
}

function rowHasExplicitFallback(row: OptimizationRoundMetric): boolean {
  return /fallback/i.test([
    row.candidateId,
    row.status,
    row.metricSourceFile,
    ...row.notes,
  ].filter(Boolean).join(" "));
}

function roundStatusLabel(row: OptimizationRoundMetric): string {
  if (rowHasExplicitFallback(row)) return row.specPassed ? "fallback" : "repair";
  if (row.specPassed) return "pass";
  if (row.status && !/candidate_evaluated|needs_repair/i.test(row.status)) return row.status;
  return "search";
}

function roundStatusClass(row: OptimizationRoundMetric): string {
  if (rowHasExplicitFallback(row)) return row.specPassed ? "status-fallback" : "status-run";
  return row.specPassed ? "status-pass" : "status-run";
}

function hasMetricValues(metrics: readonly OptimizationRoundMetric[], columns: readonly MetricDisplayColumn[]): boolean {
  return metrics.some((metric) => columns.some((column) => metricValue(metric, column) !== undefined));
}

function formatPvtTemperature(value: number | undefined): string {
  return value === undefined ? "-" : `${Number.isInteger(value) ? value : value.toFixed(1)} C`;
}

function formatPvtVddScale(value: number | undefined): string {
  if (value === undefined) return "-";
  return `${value.toFixed(2).replace(/\.?0+$/, "")}x`;
}

function pvtStatusLabel(matrix: PvtMetricMatrixSummary, passed: boolean): string {
  if (matrix.mode === "pending") return "pending";
  if (matrix.mode === "nominal") return passed ? "nominal" : "needs PVT";
  return passed ? "pass" : "fail";
}

function pvtCellClass(matrix: PvtMetricMatrixSummary, rowId: string, column: MetricDisplayColumn, value: number | undefined): string {
  if (value === undefined) return "empty";
  if (matrix.mode !== "pvt") return "nominal";
  const isWorst = matrix.worst.some((item) => item.column.key === column.key && item.row.id === rowId);
  return isWorst ? "worst" : "pass";
}

function compactPvtEvidence(row: PvtMetricMatrixSummary["rows"][number]): { label: string; title: string } {
  const source = row.sourceMetric.metricSourceFile?.trim();
  const signoff = row.sourceMetric.signoffLevel?.trim();
  const status = row.status?.trim();
  const title = [source, signoff, status].filter(Boolean).join(" · ") || "-";
  const raw = title.toLowerCase();
  if (raw.includes("surrogate") && raw.includes("fft")) return { label: "surrogate FFT", title };
  if (raw.includes("fft") && raw.includes("density")) return { label: "FFT+density", title };
  if (raw.includes("comparator")) return { label: "cmp product", title };
  if (raw.includes("opamp")) return { label: "opamp spec", title };
  if (raw.includes("spectre105")) return { label: "spectre105", title };
  return { label: source || signoff || status || "-", title };
}

function diagnosticTone(row: OptimizationRoundMetric | undefined, column: MetricDisplayColumn): "positive" | "negative" | "warning" | undefined {
  const value = metricValue(row, column);
  if (value === undefined) return undefined;
  if (column.key === "validEdgeCount") return value > 0 ? "positive" : "negative";
  if (column.key === "codeTransitionCount") return value > 0 ? "positive" : "negative";
  if (column.lowerIsBetter) return value <= 0 ? "positive" : "negative";
  return undefined;
}

function MetricCard({
  label,
  value,
  sub,
  progress,
  trend,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  progress?: string;
  trend?: ReactNode;
  tone?: "positive" | "negative" | "warning";
}) {
  return (
    <div className={`metric-card ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {progress && <em>{progress}</em>}
      {trend}
      <small>{sub}</small>
    </div>
  );
}

function PvtMatrixPanel({
  matrix,
  onSelectRound,
}: {
  matrix: PvtMetricMatrixSummary;
  onSelectRound: (round: number) => void;
}) {
  const gridTemplate = `minmax(118px, 1.2fr) 46px 58px 54px ${matrix.columns.map(() => "minmax(74px, 1fr)").join(" ")} 92px 70px`;
  const worstItems = matrix.worst.slice(0, 4);
  return (
    <section className={`pvt-matrix-panel ${matrix.mode}`} aria-label="PVT signoff matrix">
      <div className="pvt-matrix-summary">
        <strong>{matrix.title}</strong>
        <span className={matrix.mode === "pvt" && matrix.passCount === matrix.totalCount ? "pass" : matrix.mode === "pending" ? "pending" : "warn"}>
          {matrix.totalCount ? `${matrix.passCount}/${matrix.totalCount} pass` : "0/0"}
        </span>
        <small>{matrix.subtitle}</small>
        <div className="pvt-worst-list">
          {worstItems.length ? worstItems.map((item) => (
            <span key={`${item.column.key}-${item.row.id}`}>
              {item.column.label} worst {formatMetricValue(item.value, item.column.unit, item.column.digits)} @ {item.row.label}
            </span>
          )) : <span>No corner metric values</span>}
        </div>
      </div>
      <div className="pvt-matrix-table" role="table" aria-label={`${matrix.title} details`}>
        <div className="pvt-row header" role="row" style={{ gridTemplateColumns: gridTemplate }}>
          <span>Corner</span><span>P</span><span>Temp</span><span>VDD</span>
          {matrix.columns.map((column) => <span key={column.key}>{column.label}</span>)}
          <span>Evidence</span>
          <span>Status</span>
        </div>
        {matrix.rows.length ? matrix.rows.map((row) => (
          <button
            className={`pvt-row selectable ${row.specPassed ? "passed" : "failed"}`}
            key={row.id}
            role="row"
            style={{ gridTemplateColumns: gridTemplate }}
            onClick={() => onSelectRound(row.round)}
          >
            <span><b>{row.label}</b><small>R{row.round}</small></span>
            <span>{row.process ?? "-"}</span>
            <span>{formatPvtTemperature(row.temperatureC)}</span>
            <span>{formatPvtVddScale(row.vddScale)}</span>
            {matrix.columns.map((column) => {
              const value = metricValue(row.sourceMetric, column);
              return (
                <span className={pvtCellClass(matrix, row.id, column, value)} key={column.key}>
                  {formatMetricValue(value, column.unit, column.digits)}
                </span>
              );
            })}
            <span className="evidence" title={compactPvtEvidence(row).title}>{compactPvtEvidence(row).label}</span>
            <span className={row.specPassed ? "status-pass" : "status-run"}>{pvtStatusLabel(matrix, row.specPassed)}</span>
          </button>
        )) : (
          <div className="pvt-row empty" role="row" style={{ gridTemplateColumns: gridTemplate }}>
            <span>No imported PVT rows</span>
          </div>
        )}
      </div>
    </section>
  );
}

function OptimizationResultsPanel({
  metrics,
  summary,
  metricFlavor,
  demo,
  activeRound,
  optimizationRequest,
  convertorRequest,
  convertorReport,
  onImportMetrics,
  onDownloadOptimizationRequest,
  onDownloadConvertorRequest,
  onOpenWaveform,
  onSelectRound,
}: {
  metrics: OptimizationRoundMetric[];
  summary: OptimizationMetricSummary;
  metricFlavor: CircuitMetricFlavor;
  demo: boolean;
  activeRound: number | null;
  optimizationRequest: OptimizationRunRequest | null;
  convertorRequest: CadenceSchematicConvertorRequest | null;
  convertorReport: CadenceConvertorReportSummary | null;
  onImportMetrics: () => void;
  onDownloadOptimizationRequest: () => void;
  onDownloadConvertorRequest: () => void;
  onOpenWaveform: () => void;
  onSelectRound: (round: number) => void;
}) {
  const gateValues = convertorReport ? Object.values(convertorReport.gates) : [];
  const passedGates = gateValues.filter(Boolean).length;
  const profile = metricProfileForFlavor(metricFlavor);
  const selectedRow = summary.rows.find((row) => row.round === activeRound) ?? summary.rows.at(-1);
  const primaryColumns: MetricDisplayColumn[] = profile.columns;
  const sarDiagnosticMode = metricFlavor === "sar_adc"
    && !hasMetricValues(summary.rows, primaryColumns)
    && hasMetricValues(summary.rows, SAR_DIAGNOSTIC_COLUMNS);
  const displayColumns = sarDiagnosticMode ? SAR_DIAGNOSTIC_COLUMNS : primaryColumns;
  const pvtMatrix = buildPvtMetricMatrix(metrics, metricFlavor);
  const tableGridTemplate = `90px ${displayColumns.map(() => "minmax(95px, 115px)").join(" ")} minmax(190px, 1fr) 78px`;
  const waveformRoundCount = summary.rows.filter((row) => row.waveforms.length).length;
  const evidenceText = !demo && summary.rows.length
    ? `${profile.familyLabel}${sarDiagnosticMode ? " diagnostics" : ""} · ${summary.rows.length} rounds · ${waveformRoundCount} waveform rounds`
    : `${profile.familyLabel} · 等待 Design Prompt 提交后生成优化任务`;
  const selectedWaveformState = selectedRow?.waveforms.length
    ? `${selectedRow.waveforms.length} real traces`
    : selectedRow?.waveformArtifactStatus
      ? selectedRow.waveformArtifactStatus
      : "metric preview";
  return (
    <div className="optimization-panel">
      <div className="optimization-toolbar">
        <div>
          <strong>SPEG Closed Loop</strong>
          <span>
            {optimizationRequest
              ? `${optimizationRequest.resource_id} · ${optimizationRequest.workflow_kind} · ${optimizationRequest.simulator_engine}`
              : evidenceText}
          </span>
        </div>
        <div className="optimization-actions">
          <button onClick={onImportMetrics}><Upload size={13} />导入指标</button>
          <button onClick={onOpenWaveform}><Waves size={13} />波形查看</button>
          <button disabled={!optimizationRequest} onClick={onDownloadOptimizationRequest}><Download size={13} />优化请求</button>
          <button disabled={!convertorRequest} onClick={onDownloadConvertorRequest}><FileDown size={13} />转图请求</button>
        </div>
      </div>
      {demo && (
        <div className="optimization-notice">
          当前展示示例优化轨迹；导入后端返回的 per_round_metrics.json 后会替换为真实 Spectre 指标。
        </div>
      )}
      <div className="metric-cards">
        {sarDiagnosticMode ? displayColumns.map((column, index) => (
          <MetricCard
            key={column.key}
            label={column.label}
            value={formatMetricValue(metricValue(selectedRow, column), column.unit, column.digits)}
            progress={metricProgressText(summary.rows, column)}
            trend={<MetricTrendSparkline metrics={summary.rows} column={column} />}
            tone={diagnosticTone(selectedRow, column)}
            sub={index === 0 ? summary.improvementText : selectedRow ? `round ${selectedRow.round}` : "pending"}
          />
        )) : profile.columns.map((column, index) => {
          const best = bestMetric(summary, column);
          return (
            <MetricCard
              key={column.key}
              label={`${column.lowerIsBetter ? "Min" : "Best"} ${column.label}`}
              value={formatMetricValue(metricValue(best, column), column.unit, column.digits)}
              progress={metricProgressText(summary.rows, column)}
              trend={<MetricTrendSparkline metrics={summary.rows} column={column} />}
              sub={index === 0 ? summary.improvementText : best ? `round ${best.round}` : "pending"}
            />
          );
        })}
        <MetricCard
          label="Cadence Convert"
          value={convertorReport?.status ?? (convertorRequest ? "queued" : "idle")}
          sub={convertorReport ? `${passedGates}/${gateValues.length} gates` : convertorRequest?.resource_id ?? "backend ready"}
        />
      </div>
      <PvtMatrixPanel matrix={pvtMatrix} onSelectRound={onSelectRound} />
      <div className="optimization-grid">
        <div className="optimization-table" role="table" aria-label="优化指标变化">
          <div className="optimization-row header" role="row" style={{ gridTemplateColumns: tableGridTemplate }}>
            <span>Round</span>
            {displayColumns.map((column) => <span key={column.key}>{column.label}</span>)}
            <span>Trade-off</span><span>Status</span>
          </div>
          {summary.rows.map((row) => (
            <div
              className={`optimization-row selectable ${row.round === selectedRow?.round ? "selected" : ""}`}
              role="row"
              tabIndex={0}
              key={`${row.round}-${row.candidateId ?? "candidate"}`}
              style={{ gridTemplateColumns: tableGridTemplate }}
              onClick={() => onSelectRound(row.round)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectRound(row.round);
                }
              }}
            >
              <span>R{row.round}<small>{row.candidateId ?? "candidate"}</small></span>
              {displayColumns.map((column) => {
                const delta = metricDeltaValue(row, column);
                const initialDelta = metricInitialDeltaValue(row, column);
                return (
                  <span key={column.key}>
                    {formatMetricValue(metricValue(row, column), column.unit, column.digits)}
                    <b className={metricClass(delta, column.lowerIsBetter)}>
                      {formatDeltaValue(delta, column.unit, column.digits)}
                    </b>
                    <small className={metricClass(initialDelta, column.lowerIsBetter)}>
                      R0 {formatDeltaValue(initialDelta, column.unit, column.digits)}
                    </small>
                  </span>
                );
              })}
              <span>{row.tradeoff}</span>
              <span className={roundStatusClass(row)}>{roundStatusLabel(row)}</span>
            </div>
          ))}
        </div>
        <div className="tradeoff-list">
          <strong>Trade-off Trace</strong>
          {summary.tradeoffs.map((item) => <span key={item}>{item}</span>)}
          {selectedRow && (
            <>
              <strong>Selected Round</strong>
              <span>R{selectedRow.round} · {roundStatusLabel(selectedRow)} · {selectedRow.failureSignature || selectedRow.status || "metric available"}</span>
              <span>waveform: {selectedWaveformState}</span>
              {selectedRow.metricSourceFile && <span>metric: {selectedRow.metricSourceFile}</span>}
              {sarDiagnosticMode && (
                <>
                  <span>loop: {selectedRow.transistorClosedLoopPassed ? "passed" : "blocked"} · {selectedRow.loopClaimLevel ?? "no claim level"}</span>
                  <span>activity: cmp {selectedRow.comparatorActivityObserved ? "yes" : "no"} · phase {selectedRow.phaseActivityObserved ? "yes" : "no"} · dout {selectedRow.doutActivityObserved ? "yes" : "no"}</span>
                  <span>negative control: {selectedRow.negativeControlPassed ? "passed" : "failed"}</span>
                </>
              )}
            </>
          )}
          {convertorRequest && (
            <>
              <strong>Code to Schematic</strong>
              <span>{convertorRequest.resource_id} · {convertorRequest.converter_project}</span>
              <span>{convertorRequest.command_profile.entrypoint} · {convertorRequest.target.pdk_profile}</span>
            </>
          )}
          {convertorReport && (
            <>
              <strong>Cadence Evidence</strong>
              <span>visual: {convertorReport.visualQuality?.status ?? "unknown"}</span>
              <span>export CDL: {convertorReport.exportedNetlist?.status ?? "unknown"}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

type WaveformAxisMode = "xy" | "x" | "y";

interface WaveformBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface WaveformDragState {
  clientX: number;
  clientY: number;
  viewport: WaveformBounds;
}

const WAVEFORM_VIEWBOX_WIDTH = 900;
const WAVEFORM_VIEWBOX_HEIGHT = 360;
const WAVEFORM_MARGIN = { left: 54, right: 22, top: 24, bottom: 38 };
const WAVEFORM_PLOT_WIDTH = WAVEFORM_VIEWBOX_WIDTH - WAVEFORM_MARGIN.left - WAVEFORM_MARGIN.right;
const WAVEFORM_PLOT_HEIGHT = WAVEFORM_VIEWBOX_HEIGHT - WAVEFORM_MARGIN.top - WAVEFORM_MARGIN.bottom;
const WAVEFORM_TRACE_PALETTE = ["#0048b8", "#008000", "#c00000", "#7a2ca0", "#b87500", "#4d4d4d"];

function waveformTraceColor(trace: Pick<WaveformTrace, "color">, index: number): string {
  return trace.color ?? WAVEFORM_TRACE_PALETTE[index % WAVEFORM_TRACE_PALETTE.length];
}

function waveformTracePath(
  trace: WaveformTrace,
  xScale: (x: number) => number,
  yScale: (y: number) => number,
): string {
  const [first, ...rest] = trace.points;
  if (!first) return "";
  let path = `M ${xScale(first.x).toFixed(2)} ${yScale(first.y).toFixed(2)}`;
  for (const point of rest) {
    const x = xScale(point.x).toFixed(2);
    const y = yScale(point.y).toFixed(2);
    path += trace.renderStyle === "step" ? ` H ${x} V ${y}` : ` L ${x} ${y}`;
  }
  return path;
}

function paddedRange(min: number, max: number, ratio: number, minimumPad: number): { min: number; max: number } {
  if (max === min) return { min: min - minimumPad, max: max + minimumPad };
  const pad = Math.max((max - min) * ratio, minimumPad);
  return { min: min - pad, max: max + pad };
}

function boundsFromYValues(values: readonly number[]): Pick<WaveformBounds, "minY" | "maxY"> {
  if (!values.length) return { minY: 0, maxY: 1 };
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const padded = paddedRange(rawMin, rawMax, 0.08, 0.05);
  return { minY: padded.min, maxY: padded.max };
}

function traceBounds(traces: readonly WaveformTrace[]): WaveformBounds {
  const points = traces.flatMap((trace) => trace.points);
  if (!points.length) return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const xRange = paddedRange(minX, maxX, 0.02, 0.001);
  const yRange = boundsFromYValues(points.map((point) => point.y));
  return {
    minX: xRange.min,
    maxX: xRange.max,
    minY: yRange.minY,
    maxY: yRange.maxY,
  };
}

const CORE_WAVEFORM_TRACE_NAMES = [
  "/vip",
  "/vin",
  "/valid",
  "/eoc",
  "/comp_p",
  "/comp_n",
  "/cdac_p",
  "/cdac_n",
  "/tb_inp",
  "/tb_inn",
  "/tb_out",
  "OUTP",
  "OUTN",
  "input_diff_mV",
];

function defaultWaveformTraceSelection(panel: WaveformPanel | undefined): string[] {
  const traces = panel?.traces ?? [];
  if (traces.length <= 6) return traces.map((trace) => trace.name);
  const available = new Set(traces.map((trace) => trace.name));
  const preferred = CORE_WAVEFORM_TRACE_NAMES.filter((name) => available.has(name));
  if (preferred.length >= 2) return preferred.slice(0, 6);
  const analogFirst = traces.filter((trace) => trace.renderStyle !== "step").slice(0, 4).map((trace) => trace.name);
  const digitalFirst = traces.filter((trace) => trace.renderStyle === "step").slice(0, 2).map((trace) => trace.name);
  return [...analogFirst, ...digitalFirst].slice(0, 6);
}

function validTraceSelection(panel: WaveformPanel | undefined, requested: readonly string[] | undefined): string[] {
  const traces = panel?.traces ?? [];
  if (!requested) return defaultWaveformTraceSelection(panel);
  const available = new Set(traces.map((trace) => trace.name));
  return requested.filter((name) => available.has(name));
}

function waveformSpan(value: number): number {
  return Math.max(Math.abs(value), 1e-9);
}

function interpolateY(
  left: { x: number; y: number },
  right: { x: number; y: number },
  x: number,
): number {
  const span = right.x - left.x;
  if (Math.abs(span) < 1e-12) return left.y;
  const ratio = (x - left.x) / span;
  return left.y + ratio * (right.y - left.y);
}

function visibleYBoundsForX(traces: readonly WaveformTrace[], minX: number, maxX: number): Pick<WaveformBounds, "minY" | "maxY"> {
  const values: number[] = [];
  for (const trace of traces) {
    const points = [...trace.points].sort((left, right) => left.x - right.x);
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      if (point.x >= minX && point.x <= maxX) values.push(point.y);
      const next = points[index + 1];
      if (!next) continue;
      const segmentMinX = Math.min(point.x, next.x);
      const segmentMaxX = Math.max(point.x, next.x);
      if (segmentMinX <= minX && segmentMaxX >= minX) values.push(interpolateY(point, next, minX));
      if (segmentMinX <= maxX && segmentMaxX >= maxX) values.push(interpolateY(point, next, maxX));
    }
  }
  if (values.length) return boundsFromYValues(values);
  return boundsFromYValues(traces.flatMap((trace) => trace.points.map((point) => point.y)));
}

function autoScaleWaveformY(traces: readonly WaveformTrace[], viewport: WaveformBounds): WaveformBounds {
  const yRange = visibleYBoundsForX(traces, Math.min(viewport.minX, viewport.maxX), Math.max(viewport.minX, viewport.maxX));
  return { ...viewport, ...yRange };
}

function sameWaveformBounds(left: WaveformBounds, right: WaveformBounds): boolean {
  return left.minX === right.minX
    && left.maxX === right.maxX
    && left.minY === right.minY
    && left.maxY === right.maxY;
}

function zoomWaveformBounds(
  viewport: WaveformBounds,
  factor: number,
  center: { x: number; y: number } | null,
  axisMode: WaveformAxisMode,
): WaveformBounds {
  const xSpan = waveformSpan(viewport.maxX - viewport.minX);
  const ySpan = waveformSpan(viewport.maxY - viewport.minY);
  const centerX = center?.x ?? (viewport.minX + viewport.maxX) / 2;
  const centerY = center?.y ?? (viewport.minY + viewport.maxY) / 2;
  const xRatio = (centerX - viewport.minX) / xSpan;
  const yRatio = (centerY - viewport.minY) / ySpan;
  const nextXSpan = Math.max(xSpan * factor, 1e-9);
  const nextYSpan = Math.max(ySpan * factor, 1e-9);
  return {
    minX: axisMode === "y" ? viewport.minX : centerX - xRatio * nextXSpan,
    maxX: axisMode === "y" ? viewport.maxX : centerX + (1 - xRatio) * nextXSpan,
    minY: axisMode === "x" ? viewport.minY : centerY - yRatio * nextYSpan,
    maxY: axisMode === "x" ? viewport.maxY : centerY + (1 - yRatio) * nextYSpan,
  };
}

function niceStep(rawStep: number): number {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;
  const exponent = Math.floor(Math.log10(rawStep));
  const base = rawStep / (10 ** exponent);
  const niceBase = base <= 1 ? 1 : base <= 2 ? 2 : base <= 5 ? 5 : 10;
  return niceBase * (10 ** exponent);
}

function niceTicks(min: number, max: number, targetCount = 6): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (max < min) return niceTicks(max, min, targetCount).reverse();
  if (max === min) return [min];
  const step = niceStep((max - min) / Math.max(1, targetCount - 1));
  const first = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let value = first; value <= max + step * 0.5; value += step) {
    if (value >= min - step * 0.5) ticks.push(Number(value.toPrecision(12)));
  }
  if (ticks.length < 2) return [min, max];
  return ticks;
}

function formatWaveformTick(value: number): string {
  const absolute = Math.abs(value);
  if (absolute > 0 && (absolute >= 10_000 || absolute < 0.001)) return value.toExponential(2);
  if (absolute >= 100) return value.toFixed(0);
  if (absolute >= 10) return value.toFixed(1);
  if (absolute >= 1) return value.toFixed(2);
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function panWaveformBounds(
  viewport: WaveformBounds,
  dx: number,
  dy: number,
  axisMode: WaveformAxisMode,
): WaveformBounds {
  const xDelta = axisMode === "y" ? 0 : -(dx / WAVEFORM_PLOT_WIDTH) * (viewport.maxX - viewport.minX);
  const yDelta = axisMode === "x" ? 0 : (dy / WAVEFORM_PLOT_HEIGHT) * (viewport.maxY - viewport.minY);
  return {
    minX: viewport.minX + xDelta,
    maxX: viewport.maxX + xDelta,
    minY: viewport.minY + yDelta,
    maxY: viewport.maxY + yDelta,
  };
}

function waveformPointFromClient(
  svg: SVGSVGElement | null,
  clientX: number,
  clientY: number,
  viewport: WaveformBounds,
): { x: number; y: number } {
  if (!svg) return {
    x: (viewport.minX + viewport.maxX) / 2,
    y: (viewport.minY + viewport.maxY) / 2,
  };
  const rect = svg.getBoundingClientRect();
  const svgX = ((clientX - rect.left) / Math.max(rect.width, 1)) * WAVEFORM_VIEWBOX_WIDTH;
  const svgY = ((clientY - rect.top) / Math.max(rect.height, 1)) * WAVEFORM_VIEWBOX_HEIGHT;
  const xRatio = Math.max(0, Math.min(1, (svgX - WAVEFORM_MARGIN.left) / WAVEFORM_PLOT_WIDTH));
  const yRatio = Math.max(0, Math.min(1, (svgY - WAVEFORM_MARGIN.top) / WAVEFORM_PLOT_HEIGHT));
  return {
    x: viewport.minX + xRatio * (viewport.maxX - viewport.minX),
    y: viewport.maxY - yRatio * (viewport.maxY - viewport.minY),
  };
}

function WaveformPlot({
  traces,
  viewport,
  axisMode,
  xLabel,
  yLabel,
  onViewportChange,
  onReset,
}: {
  traces: WaveformTrace[];
  viewport: WaveformBounds;
  axisMode: WaveformAxisMode;
  xLabel: string;
  yLabel: string;
  onViewportChange: (viewport: WaveformBounds) => void;
  onReset: () => void;
}) {
  const clipId = useId().replace(/:/g, "");
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<WaveformDragState | null>(null);
  const xScale = (x: number) => WAVEFORM_MARGIN.left
    + ((x - viewport.minX) / (viewport.maxX - viewport.minX)) * WAVEFORM_PLOT_WIDTH;
  const yScale = (y: number) => WAVEFORM_MARGIN.top + WAVEFORM_PLOT_HEIGHT
    - ((y - viewport.minY) / (viewport.maxY - viewport.minY)) * WAVEFORM_PLOT_HEIGHT;
  const xTicks = niceTicks(viewport.minX, viewport.maxX, 6);
  const yTicks = niceTicks(viewport.minY, viewport.maxY, 6);
  const handleWheel = (event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const center = waveformPointFromClient(svgRef.current, event.clientX, event.clientY, viewport);
      onViewportChange(zoomWaveformBounds(viewport, event.deltaY < 0 ? 0.82 : 1.22, center, axisMode));
      return;
    }
    const dx = event.shiftKey ? event.deltaY : event.deltaX;
    const dy = event.shiftKey ? 0 : event.deltaY;
    onViewportChange(panWaveformBounds(viewport, dx, dy, axisMode));
  };
  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    event.preventDefault();
    onViewportChange(panWaveformBounds(
      drag.viewport,
      event.clientX - drag.clientX,
      event.clientY - drag.clientY,
      axisMode,
    ));
  };
  const stopDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }
  };
  return (
    <svg
      ref={svgRef}
      className="waveform-plot"
      viewBox={`0 0 ${WAVEFORM_VIEWBOX_WIDTH} ${WAVEFORM_VIEWBOX_HEIGHT}`}
      role="img"
      aria-label="Cadence 风格波形"
      onWheel={handleWheel}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { clientX: event.clientX, clientY: event.clientY, viewport };
      }}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
      onDoubleClick={onReset}
    >
      <rect className="plot-surface" x={0} y={0} width={WAVEFORM_VIEWBOX_WIDTH} height={WAVEFORM_VIEWBOX_HEIGHT} />
      <rect
        className="plot-area"
        x={WAVEFORM_MARGIN.left}
        y={WAVEFORM_MARGIN.top}
        width={WAVEFORM_PLOT_WIDTH}
        height={WAVEFORM_PLOT_HEIGHT}
      />
      <defs>
        <clipPath id={`waveform-clip-${clipId}`}>
          <rect
            x={WAVEFORM_MARGIN.left}
            y={WAVEFORM_MARGIN.top}
            width={WAVEFORM_PLOT_WIDTH}
            height={WAVEFORM_PLOT_HEIGHT}
          />
        </clipPath>
      </defs>
      {xTicks.map((tick) => {
        const x = xScale(tick);
        return (
          <g key={`x-${tick}`}>
            <line className="grid" x1={x} y1={WAVEFORM_MARGIN.top} x2={x} y2={WAVEFORM_MARGIN.top + WAVEFORM_PLOT_HEIGHT} />
            <line className="tick-mark" x1={x} y1={WAVEFORM_MARGIN.top + WAVEFORM_PLOT_HEIGHT} x2={x} y2={WAVEFORM_MARGIN.top + WAVEFORM_PLOT_HEIGHT + 5} />
            <text className="x-tick" x={x} y={WAVEFORM_VIEWBOX_HEIGHT - 14}>{formatWaveformTick(tick)}</text>
          </g>
        );
      })}
      {yTicks.map((tick) => {
        const y = yScale(tick);
        return (
          <g key={`y-${tick}`}>
            <line className="grid" x1={WAVEFORM_MARGIN.left} y1={y} x2={WAVEFORM_MARGIN.left + WAVEFORM_PLOT_WIDTH} y2={y} />
            <line className="tick-mark" x1={WAVEFORM_MARGIN.left - 5} y1={y} x2={WAVEFORM_MARGIN.left} y2={y} />
            <text className="y-tick" x={WAVEFORM_MARGIN.left - 8} y={y + 3}>{formatWaveformTick(tick)}</text>
          </g>
        );
      })}
      <line className="axis" x1={WAVEFORM_MARGIN.left} y1={WAVEFORM_MARGIN.top + WAVEFORM_PLOT_HEIGHT} x2={WAVEFORM_MARGIN.left + WAVEFORM_PLOT_WIDTH} y2={WAVEFORM_MARGIN.top + WAVEFORM_PLOT_HEIGHT} />
      <line className="axis" x1={WAVEFORM_MARGIN.left} y1={WAVEFORM_MARGIN.top} x2={WAVEFORM_MARGIN.left} y2={WAVEFORM_MARGIN.top + WAVEFORM_PLOT_HEIGHT} />
      <g clipPath={`url(#waveform-clip-${clipId})`}>
        {traces.map((trace, index) => {
          const stroke = waveformTraceColor(trace, index);
          if (trace.renderStyle === "stem") {
            const baseY = yScale(viewport.minY);
            return (
              <g className="stem-trace" key={trace.name}>
                {trace.points.map((point, pointIndex) => {
                  const x = xScale(point.x);
                  return (
                    <line
                      key={`${trace.name}-${pointIndex}`}
                      x1={x}
                      y1={baseY}
                      x2={x}
                      y2={yScale(point.y)}
                      stroke={stroke}
                    />
                  );
                })}
              </g>
            );
          }
          return (
            <path
              className={trace.renderStyle === "step" ? "step-trace" : "line-trace"}
              d={waveformTracePath(trace, xScale, yScale)}
              key={trace.name}
              stroke={stroke}
            />
          );
        })}
      </g>
      <rect
        className="plot-frame"
        x={WAVEFORM_MARGIN.left}
        y={WAVEFORM_MARGIN.top}
        width={WAVEFORM_PLOT_WIDTH}
        height={WAVEFORM_PLOT_HEIGHT}
      />
      <text className="x-title" x={WAVEFORM_VIEWBOX_WIDTH / 2} y={WAVEFORM_VIEWBOX_HEIGHT - 4}>{xLabel}</text>
      <text className="y-title" x={15} y={18}>{yLabel}</text>
    </svg>
  );
}

function WaveformViewer({
  panels,
  activeMetric,
  summary,
  metricFlavor,
  demo,
}: {
  panels: WaveformPanel[];
  activeMetric?: OptimizationRoundMetric;
  summary: OptimizationMetricSummary;
  metricFlavor: CircuitMetricFlavor;
  demo: boolean;
}) {
  const viewerRef = useRef<HTMLElement>(null);
  const [activePanelId, setActivePanelId] = useState(() => panels[0]?.id ?? "sar_transient");
  const [traceSelections, setTraceSelections] = useState<Record<string, string[]>>({});
  const activePanel = panels.find((panel) => panel.id === activePanelId) ?? panels[0];
  const hasWaveformEvidence = panels.length > 0;
  const traces = activePanel?.traces ?? [];
  const activePanelKey = activePanel?.id ?? "__none";
  const selectedTraceNames = useMemo(
    () => validTraceSelection(activePanel, traceSelections[activePanelKey]),
    [activePanel, activePanelKey, traceSelections],
  );
  const selectedTraceNameSet = useMemo(() => new Set(selectedTraceNames), [selectedTraceNames]);
  const stableTraceColors = useMemo(
    () => new Map(traces.map((trace, index) => [trace.name, waveformTraceColor(trace, index)])),
    [traces],
  );
  const visibleTraces = useMemo(
    () => traces
      .filter((trace) => selectedTraceNameSet.has(trace.name))
      .map((trace) => ({ ...trace, color: stableTraceColors.get(trace.name) ?? trace.color })),
    [selectedTraceNameSet, stableTraceColors, traces],
  );
  const autoBounds = useMemo(() => traceBounds(visibleTraces), [visibleTraces]);
  const [viewport, setViewport] = useState<WaveformBounds>(() => autoBounds);
  const [axisMode, setAxisMode] = useState<WaveformAxisMode>("xy");
  const [autoScaleY, setAutoScaleY] = useState(true);
  const artifactBound = Boolean(activePanel?.imageUrl || activePanel?.kind === "imported");
  const sourceLabel = !hasWaveformEvidence
    ? "no waveform artifact attached"
    : artifactBound
      ? "Cadence PSF/ViVA artifact"
      : "generated preview - waiting PSF/ViVA artifact";
  useEffect(() => {
    if (panels.some((panel) => panel.id === activePanelId)) return;
    // The selected panel must follow externally supplied waveform evidence.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActivePanelId(panels[0]?.id ?? "sar_transient");
  }, [activePanelId, panels]);
  useEffect(() => {
    // Imported traces replace the viewport domain as one atomic UI update.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setViewport((current) => sameWaveformBounds(current, autoBounds) ? current : autoBounds);
  }, [autoBounds]);
  useEffect(() => {
    if (autoScaleY) {
      // Auto-scale is derived from the currently selected trace set.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setViewport((current) => {
        const next = autoScaleWaveformY(visibleTraces, current);
        return sameWaveformBounds(current, next) ? current : next;
      });
    }
  }, [autoScaleY, visibleTraces]);
  const setWaveformViewport = (next: WaveformBounds | ((current: WaveformBounds) => WaveformBounds)) => {
    setViewport((current) => {
      const raw = typeof next === "function" ? next(current) : next;
      return autoScaleY ? autoScaleWaveformY(visibleTraces, raw) : raw;
    });
  };
  const setActivePanelTraceNames = (names: string[]) => {
    setTraceSelections((current) => ({ ...current, [activePanelKey]: names }));
  };
  const toggleTrace = (name: string) => {
    setActivePanelTraceNames(
      selectedTraceNameSet.has(name)
        ? selectedTraceNames.filter((selectedName) => selectedName !== name)
        : [...selectedTraceNames, name],
    );
  };
  const resetViewport = () => setViewport(autoBounds);
  const zoomAtCenter = (factor: number) => {
    setWaveformViewport((current) => zoomWaveformBounds(current, factor, null, axisMode));
  };
  const panByFraction = (xFraction: number, yFraction: number) => {
    setWaveformViewport((current) => panWaveformBounds(
      current,
      -xFraction * WAVEFORM_PLOT_WIDTH,
      yFraction * WAVEFORM_PLOT_HEIGHT,
      axisMode,
    ));
  };
  const xZoom = waveformSpan(autoBounds.maxX - autoBounds.minX) / waveformSpan(viewport.maxX - viewport.minX);
  const yZoom = waveformSpan(autoBounds.maxY - autoBounds.minY) / waveformSpan(viewport.maxY - viewport.minY);
  const zoomLabel = `${Math.round(((xZoom + yZoom) / 2) * 100)}%`;
  const profile = metricProfileForFlavor(metricFlavor);
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const modified = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (modified && (event.key === "+" || event.key === "=" || event.code === "NumpadAdd")) {
      event.preventDefault();
      zoomAtCenter(0.82);
      return;
    }
    if (modified && (event.key === "-" || event.key === "_" || event.code === "NumpadSubtract")) {
      event.preventDefault();
      zoomAtCenter(1.22);
      return;
    }
    if ((modified && (event.key === "0" || event.code === "Numpad0")) || (!modified && key === "f")) {
      event.preventDefault();
      resetViewport();
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      panByFraction(-0.08, 0);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      panByFraction(0.08, 0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      panByFraction(0, -0.08);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      panByFraction(0, 0.08);
    }
  };
  return (
    <section
      ref={viewerRef}
      className="waveform-viewer"
      aria-label="Waveform Viewer"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPointerDown={() => viewerRef.current?.focus({ preventScroll: true })}
    >
      <div className="waveform-head">
        <div><strong>{activePanel?.label ?? "Waveform Viewer"}</strong><span>{activePanel?.description ?? "spectre"} · {sourceLabel} · round {activeMetric?.round ?? "—"}</span></div>
        <div className="waveform-head-metrics">
          {profile.columns.slice(0, 3).map((column) => (
            <span key={column.key}>{column.label} {formatMetricValue(metricValue(activeMetric, column), column.unit, column.digits)}</span>
          ))}
        </div>
        <div className="waveform-view-actions">
          {(["xy", "x", "y"] as const).map((mode) => (
            <button
              key={mode}
              className={axisMode === mode ? "active" : ""}
              title={`缩放轴 ${mode.toUpperCase()}`}
              onClick={() => setAxisMode(mode)}
            >{mode.toUpperCase()}</button>
          ))}
          <button
            className={autoScaleY ? "active" : ""}
            title="按当前可见曲线自动缩放 Y 轴"
            onClick={() => setAutoScaleY((enabled) => !enabled)}
          >AUTO Y</button>
          <button title="放大 Ctrl++" onClick={() => zoomAtCenter(0.82)}><ZoomIn size={13} /></button>
          <button title="缩小 Ctrl+-" onClick={() => zoomAtCenter(1.22)}><ZoomOut size={13} /></button>
          <button title="适配 Ctrl+0 / F / 双击波形" onClick={resetViewport}><Maximize2 size={13} /></button>
          <span>{zoomLabel}</span>
        </div>
      </div>
      <div className="waveform-workarea">
        <aside className="waveform-trace-list">
          <strong>Metric Panels</strong>
          {hasWaveformEvidence ? panels.map((panel) => (
            <button
              className={`waveform-panel-button ${panel.id === activePanel?.id ? "active" : ""}`}
              key={panel.id}
              onClick={() => setActivePanelId(panel.id)}
            >
              <span>{panel.label}</span>
              <small>{panel.traces.length} traces</small>
            </button>
          )) : <small>当前 round 没有真实波形 artifact</small>}
          <strong>Signals</strong>
          {traces.length > 0 && (
            <div className="waveform-trace-tools">
              <button type="button" onClick={() => setActivePanelTraceNames(defaultWaveformTraceSelection(activePanel))}>核心</button>
              <button type="button" onClick={() => setActivePanelTraceNames(traces.map((trace) => trace.name))}>全选</button>
              <button type="button" onClick={() => setActivePanelTraceNames([])}>清空</button>
            </div>
          )}
          {traces.map((trace, index) => (
            <label
              className={`waveform-trace-toggle ${selectedTraceNameSet.has(trace.name) ? "active" : ""}`}
              key={trace.name}
              title="勾选后在右侧波形中显示"
            >
              <input
                type="checkbox"
                checked={selectedTraceNameSet.has(trace.name)}
                onChange={() => toggleTrace(trace.name)}
              />
              <i style={{ borderColor: waveformTraceColor(trace, index) }} />
              <span>{trace.name}</span>
            </label>
          ))}
          <small>{!hasWaveformEvidence ? "仅显示 Spectre 指标；未生成合成波形" : artifactBound ? `真实 Cadence 波形 artifact · ${selectedTraceNames.length}/${traces.length} signals` : `Preview · ${selectedTraceNames.length}/${traces.length} signals`}</small>
        </aside>
        <div className="waveform-plot-wrap">
          {!hasWaveformEvidence ? (
            <div className="waveform-empty">No waveform artifact for this run</div>
          ) : activePanel?.imageUrl ? (
            <img className="waveform-screenshot" src={activePanel.imageUrl} alt="Cadence waveform screenshot" />
          ) : visibleTraces.length === 0 ? (
            <div className="waveform-empty">No signal selected</div>
          ) : (
            <WaveformPlot
              traces={visibleTraces}
              viewport={viewport}
              axisMode={axisMode}
              xLabel={activePanel?.xLabel ?? traces[0]?.xUnit ?? "x"}
              yLabel={activePanel?.yLabel ?? traces[0]?.yUnit ?? "y"}
              onViewportChange={setWaveformViewport}
              onReset={resetViewport}
            />
          )}
        </div>
      </div>
      <div className="waveform-foot">
        <span>{summary.improvementText}</span>
        <span>{artifactBound ? "artifact-backed waveform" : demo ? "demo preview only" : "metric-derived preview only"}</span>
      </div>
    </section>
  );
}

function SimulationStatisticsPanel({
  metrics,
  flavor,
}: {
  metrics: OptimizationRoundMetric[];
  flavor: CircuitMetricFlavor;
}) {
  const rows = metrics.flatMap((metric) => {
    const primary = flavor === "comparator" ? metric.delayPs : flavor === "ota" ? metric.gainDb : metric.enob;
    if (primary === undefined || !Number.isFinite(primary)) return [];
    return [{ id: `${metric.round}:${metric.candidateId ?? "candidate"}`, round: metric.round, primary, power: metric.powerUw, passed: metric.specPassed }];
  });
  const values = rows.map((row) => row.primary);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const span = Math.max(max - min, Math.abs(max) * 0.05, 1e-9);
  const powers = rows.map((row) => row.power).filter((value): value is number => value !== undefined && Number.isFinite(value));
  const minPower = powers.length ? Math.min(...powers) : 0;
  const maxPower = powers.length ? Math.max(...powers) : 1;
  const powerSpan = Math.max(maxPower - minPower, Math.abs(maxPower) * 0.05, 1e-9);
  const sorted = [...values].sort((left, right) => left - right);
  const primaryLabel = flavor === "comparator" ? "Delay (ps)" : flavor === "ota" ? "Gain (dB)" : "ENOB";
  return (
    <div className="simulation-statistics-workspace">
      <header><strong>Statistical Results</strong><span>{rows.length} evidence rows · {primaryLabel}</span></header>
      {!rows.length ? (
        <div className="simulation-statistics-empty">当前项目还没有可用于统计视图的真实结果。</div>
      ) : (
        <div className="simulation-statistics-grid">
          <figure>
            <figcaption>Scatter · Power vs {primaryLabel}</figcaption>
            <svg viewBox="0 0 220 105" role="img" aria-label="Scatter plot">
              <path d="M28 8V88H212" className="stat-axis" />
              {rows.map((row, index) => (
                <circle
                  key={row.id}
                  cx={row.power === undefined ? 36 + index * 8 : 32 + ((row.power - minPower) / powerSpan) * 174}
                  cy={84 - ((row.primary - min) / span) * 70}
                  r="3.5"
                  className={row.passed ? "stat-pass" : "stat-fail"}
                />
              ))}
            </svg>
          </figure>
          <figure>
            <figcaption>Histogram · {primaryLabel}</figcaption>
            <svg viewBox="0 0 220 105" role="img" aria-label="Histogram">
              <path d="M28 8V88H212" className="stat-axis" />
              {sorted.map((value, index) => {
                const width = Math.max(6, 170 / sorted.length - 3);
                const height = 18 + ((value - min) / span) * 58;
                return <rect key={`${value}-${index}`} x={33 + index * (174 / sorted.length)} y={86 - height} width={width} height={height} className="stat-bar" />;
              })}
            </svg>
          </figure>
          <figure>
            <figcaption>Q-Q · normalized rank</figcaption>
            <svg viewBox="0 0 220 105" role="img" aria-label="Q-Q plot">
              <path d="M28 8V88H212" className="stat-axis" />
              <path d="M34 82L206 14" className="stat-reference" />
              {sorted.map((value, index) => (
                <circle
                  key={`${value}-${index}`}
                  cx={34 + ((index + .5) / sorted.length) * 172}
                  cy={82 - ((value - min) / span) * 68}
                  r="3"
                  className="stat-qq"
                />
              ))}
            </svg>
          </figure>
        </div>
      )}
    </div>
  );
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
  const metricsImportRef = useRef<HTMLInputElement>(null);
  const cadenceReportImportRef = useRef<HTMLInputElement>(null);
  const paletteDragRef = useRef<PaletteDrag | null>(null);
  const paletteDragCleanupRef = useRef<(() => void) | null>(null);
  const panelResizeCleanupRef = useRef<(() => void) | null>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const centerRef = useRef<HTMLElement>(null);
  const agentTabsRef = useRef<HTMLDivElement>(null);
  const agentScreenshotButtonRef = useRef<HTMLButtonElement>(null);
  const agentFileInputRef = useRef<HTMLInputElement>(null);
  const agentTraceImportRef = useRef<HTMLInputElement>(null);
  const agentSessionCounterRef = useRef(1);
  const suppressPaletteClickRef = useRef(false);
  const [rootDocument, setRootDocument] = useState<SchematicDocument>(() => initialDocument ?? createDemoDocument());
  const rootDocumentRef = useRef(rootDocument);
  const [document, setDocument] = useState<SchematicDocument>(() => rootDocument);
  const documentRef = useRef(document);
  const initialRootKey = rootCellKey(rootDocument);
  const [hierarchyStack, setHierarchyStack] = useState<HierarchyFrame[]>([
    { key: initialRootKey, cell: rootDocument.cell },
  ]);
  const hierarchyStackRef = useRef(hierarchyStack);
  const lastSavedDocumentRef = useRef(serializeSchematic(rootDocument));
  const projectRevisionRef = useRef(projectRevision);
  const activeSaveRef = useRef<Promise<boolean> | null>(null);
  const saveProjectRef = useRef<() => Promise<boolean>>(async () => false);
  const saveRecoveryRef = useRef<() => Promise<void>>(async () => undefined);
  const [selected, setSelected] = useState<SchematicNode | null>(null);
  const [dialect, setDialect] = useState<NetlistDialect>("spectre");
  const [bottomTab, setBottomTab] = useState<BottomTab>("netlist");
  const [centerViewTab, setCenterViewTab] = useState<CenterViewTab>("schematic");
  const [waveformViewerOpen, setWaveformViewerOpen] = useState(false);
  const [leftMode, setLeftMode] = useState<"library" | "project">("library");
  const [search, setSearch] = useState("");
  const [activePdkProfileId, setActivePdkProfileId] = useState(DEFAULT_PDK_PROFILE_ID);
  const [agentOpen, setAgentOpen] = useState(true);
  const [agentSessions, setAgentSessions] = useState<AgentSession[]>([
    { id: "agent-1", title: "Design Prompt", input: "", messages: [], attachments: [], modelRoute: "auto" },
  ]);
  const [agentModelCatalog, setAgentModelCatalog] = useState<AgentModelCatalogItem[]>(INITIAL_AGENT_MODELS);
  const [activeAgentId, setActiveAgentId] = useState("agent-1");
  const [agentHistoryOpen, setAgentHistoryOpen] = useState(false);
  const [agentHistoryLoading, setAgentHistoryLoading] = useState(Boolean(projectId));
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
  const [agentWorkflowMode, setAgentWorkflowMode] = useState<OptimizationWorkflowMode>("auto");
  const [activeAgentFamily, setActiveAgentFamily] = useState<ReleaseFamily | null>(null);
  const [simulationSession, setSimulationSession] = useState<SimulationSessionConfig>(() => defaultSimulationSession("comparator"));
  const [optimizationRequest, setOptimizationRequest] = useState<OptimizationRunRequest | null>(null);
  const [optimizationMetrics, setOptimizationMetrics] = useState<OptimizationRoundMetric[]>(() =>
    optimizationMetricsFromDocument(initialDocument),
  );
  const [selectedOptimizationRound, setSelectedOptimizationRound] = useState<number | null>(null);
  const [cadenceConvertorRequest, setCadenceConvertorRequest] = useState<CadenceSchematicConvertorRequest | null>(null);
  const [cadenceConvertorReport, setCadenceConvertorReport] = useState<CadenceConvertorReportSummary | null>(null);
  const layoutRef = useRef(layout);
  const agentSessionsRef = useRef(agentSessions);
  const activeAgent = agentSessions.find((session) => session.id === activeAgentId) ?? agentSessions[0];
  const agentHasDraft = Boolean(activeAgent?.input.trim() || activeAgent?.attachments.length);
  const hierarchyPath = hierarchyStack.map((frame) => frame.cell).join(" / ");
  const canvasZoomPercent = Math.round(canvasViewport.scale * 100);
  const canvasZoomTrack = Math.max(0, Math.min(100, ((canvasViewport.scale - CANVAS_MIN_SCALE) / (CANVAS_MAX_SCALE - CANVAS_MIN_SCALE)) * 100));
  const canvasRotation = normalizeCanvasRotation(canvasViewport.rotation);
  const pdkEntries = useMemo(() => selectablePdkEntries(), []);
  const pdkSummary = useMemo(() => pdkRegistrySummary(), []);
  const activePdk = useMemo(() => resolvePdkRegistryEntry(activePdkProfileId), [activePdkProfileId]);
  const activePdkContract = useMemo(() => buildPdkRequestContract(activePdk), [activePdk]);
  const activePdkStatus = pdkStatusLabel(activePdk);
  const schematicProvenance = useMemo(
    () => inspectSchematicProvenance(document, rootDocument),
    [document, rootDocument],
  );

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
  const netlistPreviewText = useMemo(
    () => buildAnnotatedNetlistPreview(document, rootDocument, dialect, compiled.text),
    [compiled.text, dialect, document, rootDocument],
  );
  const netlistPreviewLines = useMemo(() => netlistPreviewText.split("\n"), [netlistPreviewText]);
  const metricFlavor = useMemo(
    () => activeAgentFamily === "opamp"
      ? "ota"
      : activeAgentFamily === "comparator"
        ? "comparator"
        : inferMetricFlavor({
      ...document.properties,
      ...rootDocument.properties,
      project: rootDocument.project,
      cell: rootDocument.cell,
    }),
    [activeAgentFamily, document.properties, rootDocument.properties, rootDocument.project, rootDocument.cell],
  );
  const simulationFamily: ReleaseFamily = metricFlavor === "ota" ? "opamp" : "comparator";
  useEffect(() => {
    setSimulationSession((current) => current.family === simulationFamily
      ? current
      : defaultSimulationSession(simulationFamily));
  }, [simulationFamily]);
  const visibleOptimizationMetrics = useMemo(
    () => optimizationMetrics.length ? optimizationMetrics : defaultOptimizationMetricsForFlavor(metricFlavor),
    [metricFlavor, optimizationMetrics],
  );
  const optimizationSummary = useMemo(
    () => summarizeOptimizationMetrics(visibleOptimizationMetrics, metricFlavor),
    [metricFlavor, visibleOptimizationMetrics],
  );
  const activeWaveformMetric = visibleOptimizationMetrics.find((metric) => metric.round === selectedOptimizationRound)
    ?? optimizationSummary.latest
    ?? visibleOptimizationMetrics.at(-1);
  const activeWaveformPanels = useMemo(
    () => waveformPanelsForRound(activeWaveformMetric, visibleOptimizationMetrics, metricFlavor),
    [activeWaveformMetric, metricFlavor, visibleOptimizationMetrics],
  );
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

  const openAgentConversation = async (conversationId: string) => {
    setActiveAgentId(conversationId);
    setAgentHistoryOpen(false);
    const existing = agentSessionsRef.current.find((session) => session.id === conversationId);
    if (!projectId || existing?.loaded) return;
    setAgentHistoryLoading(true);
    try {
      const payload = await loadAgentConversation(projectId, conversationId);
      setAgentSessions((sessions) => sessions.map((session) => session.id === conversationId
        ? {
            ...session,
            title: payload.conversation.title,
            messages: payload.messages.map(persistedMessage),
            persisted: true,
            loaded: true,
            updatedAt: payload.conversation.updatedAt,
            modelRoute: payload.conversation.modelRoute,
          }
        : session));
      if (payload.conversation.activeFamily === "comparator" || payload.conversation.activeFamily === "opamp") {
        setActiveAgentFamily(payload.conversation.activeFamily);
      }
    } catch (error) {
      setAgentAttachmentNotices((notices) => ({
        ...notices,
        [conversationId]: error instanceof Error ? error.message : "会话历史加载失败",
      }));
    } finally {
      setAgentHistoryLoading(false);
    }
  };

  const refreshAgentConversationCatalog = async () => {
    if (!projectId) return;
    setAgentHistoryLoading(true);
    try {
      const conversations = await listAgentConversations(projectId);
      setAgentSessions((sessions) => conversations.map((conversation) => {
        const existing = sessions.find((session) => session.id === conversation.id);
        return existing
          ? { ...existing, title: conversation.title, updatedAt: conversation.updatedAt, modelRoute: conversation.modelRoute, persisted: true }
          : {
              id: conversation.id,
              title: conversation.title,
              input: "",
              messages: [],
              attachments: [],
              modelRoute: conversation.modelRoute,
              persisted: true,
              loaded: false,
              updatedAt: conversation.updatedAt,
            };
      }));
    } catch (error) {
      setAgentAttachmentNotices((notices) => ({
        ...notices,
        [activeAgentId]: error instanceof Error ? error.message : "项目会话目录刷新失败",
      }));
    } finally {
      setAgentHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setAgentHistoryLoading(true);
    void (async () => {
      try {
        let conversations = await listAgentConversations(projectId);
        if (!conversations.length) {
          conversations = [await createPersistedConversation(projectId, { title: "Design Prompt" })];
        }
        if (cancelled) return;
        const sessions: AgentSession[] = conversations.map((conversation) => ({
          id: conversation.id,
          title: conversation.title,
          input: "",
          messages: [],
          attachments: [],
          modelRoute: conversation.modelRoute,
          persisted: true,
          loaded: false,
          updatedAt: conversation.updatedAt,
        }));
        agentSessionCounterRef.current = sessions.length;
        agentSessionsRef.current = sessions;
        setAgentSessions(sessions);
        setActiveAgentId(sessions[0].id);
        setAgentHistoryOpen(sessions.length > 1);
        await openAgentConversation(sessions[0].id);
      } catch (error) {
        if (!cancelled) {
          setAgentAttachmentNotices((notices) => ({
            ...notices,
            [activeAgentId]: error instanceof Error ? error.message : "项目会话目录加载失败",
          }));
        }
      } finally {
        if (!cancelled) setAgentHistoryLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // Project identity is the lifecycle boundary for its Agent history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void listAgentModels(projectId)
      .then((models) => {
        if (!cancelled) setAgentModelCatalog(models);
      })
      .catch((error) => {
        if (!cancelled) {
          setAgentAttachmentNotices((notices) => ({
            ...notices,
            [activeAgentId]: error instanceof Error ? error.message : "模型目录加载失败",
          }));
        }
      });
    return () => { cancelled = true; };
  }, [activeAgentId, projectId]);

  useEffect(() => {
    agentSessionsRef.current = agentSessions;
  }, [agentSessions]);

  useEffect(() => {
    if (!visibleOptimizationMetrics.length) return;
    const selectedExists = visibleOptimizationMetrics.some((metric) => metric.round === selectedOptimizationRound);
    if (!selectedExists) {
      setSelectedOptimizationRound(visibleOptimizationMetrics.at(-1)?.round ?? null);
    }
  }, [selectedOptimizationRound, visibleOptimizationMetrics]);

  useEffect(() => {
    rootDocumentRef.current = rootDocument;
  }, [rootDocument]);

  useEffect(() => {
    hierarchyStackRef.current = hierarchyStack;
  }, [hierarchyStack]);

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
      const stored = localStorage.getItem("analog-studio.pdk-profile.v1");
      if (stored && selectablePdkEntries().some((entry) => entry.id === stored)) {
        setActivePdkProfileId(stored);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    localStorage.setItem("analog-studio.pdk-profile.v1", activePdkProfileId);
  }, [activePdkProfileId]);

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

  const canAscendHierarchy = hierarchyStack.length > 1;

  const syncVisibleDocumentIntoRoot = (visible: SchematicDocument, bumpRevision = true): SchematicDocument => {
    const frame = hierarchyStackRef.current[hierarchyStackRef.current.length - 1];
    const currentRoot = rootDocumentRef.current;
    const nextRoot = frame && frame.key !== rootCellKey(currentRoot)
      ? withHierarchyCellView(currentRoot, visible, bumpRevision)
      : visible;
    documentRef.current = visible;
    rootDocumentRef.current = nextRoot;
    setRootDocument(nextRoot);
    return nextRoot;
  };

  const loadIntoEditor = (next: SchematicDocument) => {
    setOptimizationMetrics(optimizationMetricsFromDocument(next));
    rootDocumentRef.current = next;
    setRootDocument(next);
    documentRef.current = next;
    setDocument(next);
    const rootFrame = { key: rootCellKey(next), cell: next.cell };
    hierarchyStackRef.current = [rootFrame];
    setHierarchyStack([rootFrame]);
    setSelected(null);
    setPropertyOpen(false);
    setPropertyDraft(null);
    editorRef.current?.loadDocument(next);
  };

  const currentProjectDocument = () => {
    const visible = editorRef.current?.getDocument() ?? documentRef.current;
    return syncVisibleDocumentIntoRoot(visible, true);
  };

  const projectDocumentSnapshot = () => {
    const visible = editorRef.current?.getDocument() ?? documentRef.current;
    const frame = hierarchyStackRef.current[hierarchyStackRef.current.length - 1];
    const currentRoot = rootDocumentRef.current;
    return frame && frame.key !== rootCellKey(currentRoot)
      ? withHierarchyCellView(currentRoot, visible, false)
      : visible;
  };

  const showHierarchyDocument = (next: SchematicDocument, stack: HierarchyFrame[]) => {
    documentRef.current = next;
    setDocument(next);
    hierarchyStackRef.current = stack;
    setHierarchyStack(stack);
    setSelected(null);
    closePropertyEditor();
    editorRef.current?.loadDocument(next);
  };

  const descendIntoHierarchy = (node: SchematicNode): boolean => {
    const childKey = node.properties.hierarchyChildKey;
    if (!childKey) return false;
    const visible = editorRef.current?.getDocument() ?? documentRef.current;
    const syncedRoot = syncVisibleDocumentIntoRoot(visible, true);
    const child = resolveHierarchyCellView(syncedRoot, visible, childKey);
    if (!child) {
      setSavedAt(`未找到子电路 cellview：${node.properties.hierarchyCell ?? childKey}`);
      return true;
    }
    showHierarchyDocument(child, [
      ...hierarchyStackRef.current,
      { key: childKey, cell: child.cell, instanceId: node.id },
    ]);
    setSavedAt(`进入 ${node.instanceName} / ${child.cell}`);
    return true;
  };

  const ascendHierarchy = () => {
    if (hierarchyStackRef.current.length <= 1) return;
    const visible = editorRef.current?.getDocument() ?? documentRef.current;
    const syncedRoot = syncVisibleDocumentIntoRoot(visible, true);
    const nextStack = hierarchyStackRef.current.slice(0, -1);
    const parentFrame = nextStack[nextStack.length - 1];
    const parent = parentFrame.key === rootCellKey(syncedRoot)
      ? syncedRoot
      : hierarchyCellView(syncedRoot, parentFrame.key);
    if (!parent) return;
    showHierarchyDocument(parent, nextStack);
    setSavedAt(`返回 ${parent.cell}`);
  };

  const saveProject = async (): Promise<boolean> => {
    const inFlight = activeSaveRef.current;
    if (inFlight) {
      const succeeded = await inFlight;
      if (!succeeded) return false;
      return serializeSchematic(documentRef.current) === lastSavedDocumentRef.current
        ? true
        : saveProjectRef.current();
    }

    const current = currentProjectDocument();
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
      rootDocumentRef.current = saveCandidate;
      setRootDocument(saveCandidate);
      if (!canAscendHierarchy) {
        documentRef.current = saveCandidate;
        setDocument(saveCandidate);
        editorRef.current?.setDocumentMetadata(saveCandidate);
      }
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
          rootDocumentRef.current = saveCandidate;
          setRootDocument(saveCandidate);
          if (!canAscendHierarchy) {
            documentRef.current = saveCandidate;
            setDocument(saveCandidate);
            editorRef.current?.setDocumentMetadata(saveCandidate);
          }
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
  };

  const saveRecovery = async (): Promise<void> => {
    const current = currentProjectDocument();
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
  };

  const runCheck = () => {
    const current = editorRef.current?.getDocument() ?? documentRef.current;
    const result = runSchematicCheck(current);
    documentRef.current = result.document;
    setDocument(result.document);
    syncVisibleDocumentIntoRoot(result.document, true);
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
    const serialized = serializeSchematic(rootDocument);
    if (serialized === lastSavedDocumentRef.current) return;
    setSaveState("dirty");
    setSavedAt("有未保存修改");
    const timer = window.setTimeout(() => void saveRecoveryRef.current(), 1600);
    return () => window.clearTimeout(timer);
  }, [rootDocument]);

  useEffect(() => {
    const hasUnsavedChanges = () =>
      serializeSchematic(projectDocumentSnapshot()) !== lastSavedDocumentRef.current ||
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

  const importDesignFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      let parsed: SchematicDocument;
      let importedCadenceBuildPlan = false;
      if (shouldImportAsJson(file.name, text)) {
        const json = JSON.parse(text) as unknown;
        if (isHierarchicalSchematicExchange(json)) {
          parsed = parseHierarchicalSchematicExchange(json);
        } else if (isCadenceBuildPlan(json)) {
          importedCadenceBuildPlan = true;
          parsed = importCadenceBuildPlanAsSchematic(json, {
            project: projectName ?? rootDocument.project,
            sourceRun: file.name,
          }).document;
        } else {
          parsed = parseSchematicDocument(json);
        }
      } else {
        parsed = importNetlistAsSchematic(text, {
          project: projectName ?? rootDocument.project,
          cell: cellNameFromFile(file.name),
        });
      }
      const importedProvenance = inspectSchematicProvenance(parsed);
      loadIntoEditor(parsed);
      setSavedAt(shouldImportAsJson(file.name, text)
        ? importedCadenceBuildPlan
          ? `已导入 Cadence build_plan 可编辑原理图：${file.name}`
          : importedProvenance.canClaimConvertedSchematic
          ? `已导入工程转换原理图：${file.name}`
          : `已导入 JSON：${file.name} · 非工程转换图`
        : `已从网表生成原理图：${file.name}`);
      setCenterViewTab("schematic");
      setBottomTab("netlist");
    } catch {
      setSavedAt("导入失败：不是工程 JSON 或受支持的 Spectre/SPICE/CDL 网表");
    } finally {
      event.target.value = "";
    }
  };

  const importOptimizationMetricsFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const metrics = parsePerRoundMetrics(await file.text());
      if (!metrics.length) throw new Error("empty_metrics");
      const nextDocument = withOptimizationMetricsExtension(currentProjectDocument(), metrics, {
        sourceLabel: file.name,
        artifactBacked: true,
      });
      loadIntoEditor(nextDocument);
      setBottomTab("simulation");
      setSavedAt(`已导入优化指标：${file.name}`);
    } catch {
      setSavedAt("指标导入失败：请使用 per_round_metrics.json");
    } finally {
      event.target.value = "";
    }
  };

  const importCadenceReportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const report = parseCadenceConvertorReport(await file.text());
      setCadenceConvertorReport(report);
      setBottomTab("simulation");
      setSavedAt(`已导入 Cadence 转换报告：${file.name}`);
    } catch {
      setSavedAt("Cadence 报告导入失败：请使用 closed_loop_report.json");
    } finally {
      event.target.value = "";
    }
  };

  const choosePdkProfile = (profileId: string) => {
    const next = resolvePdkRegistryEntry(profileId);
    setActivePdkProfileId(next.id);
    setCadenceConvertorReport(null);
    setSavedAt(`PDK 已切换：${next.label} · ${pdkStatusLabel(next)}`);
  };

  const createCadenceConvertorDraft = () => {
    const current = currentProjectDocument();
    const currentCompiled = compileHierarchicalNetlist(current, dialect);
    const request = buildCadenceSchematicConvertorRequest({
      document: current,
      compiled: currentCompiled,
      dialect,
      mode: "closed_loop",
      pdkProfile: activePdkContract.cadence_profile,
      pdkContract: activePdkContract,
    });
    setCadenceConvertorRequest(request);
    setBottomTab("simulation");
    setSavedAt(schematicProvenance.kind === "demo_seed"
      ? `已生成后端转换任务：当前源图为 demo seed，最终展示必须等待工程生成产物`
      : `已生成 Cadence 带布线原理图任务：${request.job_id} · ${activePdk.label}`);
    return request;
  };

  const openWaveformViewer = () => {
    setWaveformViewerOpen(true);
    setCenterViewTab("waveform");
    setBottomTab("simulation");
  };

  const cycleAgentWorkflowMode = () => {
    setAgentWorkflowMode((mode) => {
      if (mode === "auto") return "end_to_end_generate_optimize";
      if (mode === "end_to_end_generate_optimize") return "prompt_directed_modify_optimize";
      return "auto";
    });
  };

  const selectAgentModelRoute = async (modelRoute: AgentModelRoute) => {
    const targetId = activeAgentId;
    setAgentSessions((sessions) => sessions.map((session) => session.id === targetId
      ? { ...session, modelRoute }
      : session));
    if (!projectId) return;
    try {
      await updatePersistedConversation(projectId, targetId, { modelRoute });
    } catch (error) {
      setAgentAttachmentNotices((notices) => ({
        ...notices,
        [targetId]: error instanceof Error ? error.message : "模型选择保存失败",
      }));
    }
  };

  const downloadOptimizationRequest = () => {
    if (!optimizationRequest) return;
    downloadText(`${optimizationRequest.run_id}.optimization-request.json`, JSON.stringify(optimizationRequest, null, 2), "application/json");
  };

  const downloadCadenceConvertorRequest = () => {
    if (!cadenceConvertorRequest) return;
    downloadText(`${cadenceConvertorRequest.job_id}.cadence-convertor-request.json`, JSON.stringify(cadenceConvertorRequest, null, 2), "application/json");
  };

  const downloadCadenceOaPackage = () => {
    const current = currentProjectDocument();
    const currentCompiled = compileNetlist(current, dialect);
    const request = buildCadenceSchematicConvertorRequest({
      document: current,
      compiled: currentCompiled,
      dialect,
      mode: "closed_loop",
      pdkProfile: activePdkContract.cadence_profile,
      pdkContract: activePdkContract,
    });
    const handoff = buildCadenceOaExportPackage({
      document: current,
      rootDocument: current,
      request,
      pdk: activePdkContract,
    });
    setCadenceConvertorRequest(request);
    setBottomTab("simulation");
    downloadText(`${current.cell}.cadence-oa-handoff.json`, JSON.stringify(handoff, null, 2), "application/json");
    setSavedAt(`已导出 Cadence OA handoff：${current.cell} · ${activePdk.label}`);
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

  const updateAgentMessage = (sessionId: string, messageId: string, patch: Partial<AgentMessage>) => {
    setAgentSessions((sessions) => sessions.map((session) => session.id === sessionId
      ? { ...session, messages: session.messages.map((message) => message.id === messageId ? { ...message, ...patch } : message) }
      : session));
  };

  const cancelAgentJob = async (sessionId: string, messageId: string, jobId: string) => {
    try {
      await cancelSpegJob(jobId);
      updateAgentMessage(sessionId, messageId, { status: "failed", text: `cancel_requested · ${jobId}` });
    } catch (error) {
      updateAgentMessage(sessionId, messageId, { text: error instanceof Error ? error.message : "取消 SPEG 任务失败" });
    }
  };

  const executeAgentPrompt = async (
    promptOverride?: string,
    parameterOverrides: Record<string, number | string | boolean> = {},
    requestedOperation: "nominal_signoff" | "full_signoff" = "nominal_signoff",
  ) => {
    const prompt = promptOverride?.trim() || activeAgent?.input.trim();
    const attachments = activeAgent?.attachments ?? [];
    if (!prompt && !attachments.length) return;
    const messageSeed = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const current = currentProjectDocument();
    const currentCompiled = compileHierarchicalNetlist(current, dialect);
    const promptText = prompt || `请根据 ${attachments.length} 个附件继续分析并优化当前电路`;
    const releaseFamily = inferReleaseFamily(promptText, activeAgentFamily);
    const targetAgentId = activeAgentId;
    const optimizationRunRequest = buildOptimizationRunRequest({
      promptText,
      document: current,
      compiled: currentCompiled,
      dialect,
      workflowMode: agentWorkflowMode,
      maxRounds: 10,
      pdkProfile: activePdkContract.workflow_profile,
      pdkContract: activePdkContract,
    });
    const convertorRequest = buildCadenceSchematicConvertorRequest({
      document: current,
      compiled: currentCompiled,
      dialect,
      mode: "closed_loop",
      pdkProfile: activePdkContract.cadence_profile,
      pdkContract: activePdkContract,
    });
    setOptimizationRequest(optimizationRunRequest);
    setCadenceConvertorRequest(convertorRequest);
    setBottomTab("simulation");
    if (projectId && !activeAgent?.persisted) {
      setAgentAttachmentNotices((notices) => ({ ...notices, [targetAgentId]: "项目会话尚未完成持久化，请稍后重试" }));
      return;
    }
    let sentAttachments = attachments;
    let attachmentIds: string[] = [];
    const userMessageId = `user-${messageSeed}`;
    try {
      if (projectId && attachments.length) {
        const uploaded = await Promise.all(attachments.map((attachment) => {
          if (!attachment.blob) throw new Error("待发送附件缺少本地内容");
          return uploadAgentFile(projectId, targetAgentId, {
            blob: attachment.blob,
            name: attachment.name,
            mediaType: attachment.mediaType,
            width: attachment.width,
            height: attachment.height,
          });
        }));
        sentAttachments = uploaded.map(persistedAttachment);
        attachmentIds = uploaded.map((attachment) => attachment.id);
      }
      if (projectId) {
        const storedMessage = await appendAgentMessage(projectId, targetAgentId, {
          id: userMessageId,
          role: "user",
          text: promptText,
          kind: "user_message",
          title: "",
          status: "info",
          attachmentIds,
        });
        if (storedMessage.title) {
          setAgentSessions((sessions) => sessions.map((session) => session.id === targetAgentId
            ? { ...session, title: storedMessage.title! }
            : session));
        }
      }
    } catch (error) {
      if (projectId && attachmentIds.length) {
        await Promise.allSettled(attachmentIds.map((attachmentId) => deleteUnboundAgentFile(projectId, attachmentId)));
      }
      setAgentAttachmentNotices((notices) => ({
        ...notices,
        [targetAgentId]: error instanceof Error ? error.message : "消息或附件保存失败",
      }));
      return;
    }
    attachments.forEach((attachment) => {
      if (attachment.previewUrl.startsWith("blob:")) URL.revokeObjectURL(attachment.previewUrl);
    });
    setAgentSessions((sessions) => sessions.map((session) => session.id === targetAgentId
      ? {
          ...session,
          input: "",
          attachments: [],
          messages: [...session.messages, {
            id: userMessageId,
            role: "user",
            text: promptText,
            kind: "user_message",
            status: "info",
            attachments: sentAttachments,
          }],
        }
      : session));

    if (projectId) {
      if (releaseFamily) {
        try {
          await updatePersistedConversation(projectId, targetAgentId, { activeFamily: releaseFamily });
        } catch (error) {
          setAgentAttachmentNotices((notices) => ({
            ...notices,
            [targetAgentId]: error instanceof Error ? error.message : "会话家族更新失败",
          }));
        }
      }
      try {
        const targetSession = agentSessionsRef.current.find((session) => session.id === targetAgentId);
        const modelMessage = await requestProjectModelResponse(
          projectId,
          targetAgentId,
          userMessageId,
          targetSession?.modelRoute ?? "auto",
        );
        setAgentSessions((sessions) => sessions.map((session) => session.id === targetAgentId
          ? { ...session, messages: [...session.messages, persistedMessage(modelMessage)] }
          : session));
      } catch (error) {
        const modelFailure: AgentMessage = {
          id: `model-${messageSeed}`,
          role: "assistant",
          text: error instanceof Error ? error.message : "多模态模型回答失败",
          kind: "model_response",
          title: "SPEG Design Agent",
          status: "failed",
        };
        setAgentSessions((sessions) => sessions.map((session) => session.id === targetAgentId
          ? { ...session, messages: [...session.messages, modelFailure] }
          : session));
        try {
          await appendAgentMessage(projectId, targetAgentId, persistedMessageInput(modelFailure));
        } catch {
          // The visible provider error remains useful even if history storage is temporarily unavailable.
        }
      }
    }

    if (!requestsSpegExecution(promptText)) return;

    const assistantText = [
      "已在 Analog Studio 内生成版本化闭环任务草案。",
      `optimize: ${optimizationRunRequest.resource_id} · ${optimizationRunRequest.workflow_kind} · ${optimizationRunRequest.simulator_engine}`,
      `schematic: ${convertorRequest.resource_id} · ${convertorRequest.converter_project}`,
      `pdk: ${activePdk.label} · ${activePdkStatus}`,
      `seed: ${current.library}/${current.cell}，${current.nodes.length} 个对象，${currentCompiled.nets.length} 个网络`,
      `source: ${convertorRequest.source.document_provenance.label} · ${convertorRequest.source.document_provenance.can_claim_converted_schematic ? "backend generated" : "not a converted schematic"}`,
      `netlist: ${dialect}，${currentCompiled.issues.length} 条 ERC 提示`,
      "优化后端返回 per_round_metrics.json 后，底部会显示指标变化、trade-off 和波形视图；Cadence 转换后端返回 closed_loop_report.json 后，会显示布线/OA/导出门禁。",
    ].join("\n");
    const actionMessage: AgentMessage = {
      id: `assistant-${messageSeed}`,
      role: "assistant",
      text: assistantText,
      kind: "agent_action",
      title: "SPEG closure plan",
      status: "proposed",
    };
    const toolMessage: AgentMessage = {
      id: `tool-${messageSeed}`,
      role: "assistant",
      text: releaseFamily && projectId
        ? `正在提交受限的 ${requestedOperation} 任务。`
        : releaseFamily ? "请先保存工程，再提交 SPEG 任务。" : "无法从需求中确定 Comparator 或 OTA 家族。",
      kind: "tool_invocation",
      title: "simulation.submit",
      status: releaseFamily && projectId ? "running" : "failed",
    };
    setAgentSessions((sessions) => sessions.map((session) => session.id === targetAgentId
      ? {
          ...session,
          messages: [...session.messages, actionMessage, toolMessage],
        }
      : session));
    if (projectId) {
      try {
        await appendAgentMessage(projectId, targetAgentId, persistedMessageInput(actionMessage));
        await appendAgentMessage(projectId, targetAgentId, persistedMessageInput(toolMessage));
      } catch (error) {
        setAgentAttachmentNotices((notices) => ({
          ...notices,
          [targetAgentId]: error instanceof Error ? error.message : "Agent 动作记录保存失败",
        }));
      }
    }
    if (!releaseFamily || !projectId) return;
    setActiveAgentFamily(releaseFamily);
    const toolMessageId = `tool-${messageSeed}`;
    try {
      const job = await submitSpegJob({
        projectId,
        family: releaseFamily,
        promptText,
        netlistText: compileHierarchicalNetlist(current, "spice").text,
        inputRevision: `${projectRevisionRef.current}:${current.revisions.designRevision}`,
        pdkProfileId: activePdkContract.workflow_profile,
        idempotencyKey: optimizationRunRequest.run_id,
        targets: release1Targets(promptText, releaseFamily),
        parameters: parameterOverrides,
        operation: requestedOperation,
      });
      updateAgentMessage(targetAgentId, toolMessageId, {
        jobId: job.job_id,
        text: `${job.status} · ${job.job_id} · ${job.spec_hash.slice(0, 12)}`,
      });
      const terminal = await waitForSpegJob(job.job_id, {
        onUpdate: (next) => updateAgentMessage(targetAgentId, toolMessageId, {
          jobId: next.job_id,
          status: next.status === "succeeded" ? "passed" : ["failed", "timed_out", "cancelled", "blocked"].includes(next.status) ? "failed" : "running",
          text: `${next.status} · ${next.job_id} · attempt ${next.attempt}`,
        }),
      });
      if (terminal.status !== "succeeded") return;
      const result = await getSpegResult(terminal.job_id);
      const details = liveResultDetails(result);
      const resultMessage: AgentMessage = {
        id: `result-${messageSeed}`,
        role: "assistant",
        text: details.summary,
        kind: "tool_result",
        title: "Spectre result",
        status: details.passed ? "passed" : "failed",
        evidenceLevel: details.evidenceLevel,
        metrics: details.metrics,
      };
      setAgentSessions((sessions) => sessions.map((session) => session.id === targetAgentId
        ? {
            ...session,
            messages: [...session.messages, resultMessage],
          }
        : session));
      try {
        await appendAgentMessage(projectId, targetAgentId, persistedMessageInput(resultMessage));
      } catch (error) {
        setAgentAttachmentNotices((notices) => ({
          ...notices,
          [targetAgentId]: error instanceof Error ? error.message : "仿真结果历史保存失败",
        }));
      }
      try {
        const rows = parsePerRoundMetrics(result);
        if (rows.length) {
          setOptimizationMetrics(rows);
          setSelectedOptimizationRound(rows.at(-1)?.round ?? null);
          setCenterViewTab("waveform");
        }
      } catch {
        // The complete result remains visible even when it has no metric-table shape.
      }
      setSavedAt(`SPEG ${releaseFamily} · ${terminal.job_id} · ${details.evidenceLevel}`);
    } catch (error) {
      updateAgentMessage(targetAgentId, toolMessageId, {
        status: "failed",
        text: error instanceof Error ? error.message : "SPEG 任务提交失败",
      });
    }
  };

  const sendAgentPlaceholder = () => {
    void executeAgentPrompt();
  };

  const focusDesignPrompt = () => {
    setAgentOpen(true);
    window.requestAnimationFrame(() => {
      window.document.querySelector<HTMLTextAreaElement>(".agent-composer textarea")?.focus();
    });
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
        [activeAgent.id]: "每个会话最多保留 4 个待发送附件，请先删除一个。",
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
          [targetId]: "每个会话最多保留 4 个待发送附件，请先删除一个。",
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

  const selectAgentFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (!activeAgent || !files.length) return;
    const remaining = Math.max(0, 4 - activeAgent.attachments.length);
    if (!remaining) {
      setAgentAttachmentNotices((notices) => ({ ...notices, [activeAgent.id]: "每个会话最多保留 4 个待发送附件，请先删除一个。" }));
      return;
    }
    const selected = files.slice(0, remaining);
    const rejected = files.length - selected.length;
    const next = selected.map((file, index) => {
      const mediaType = agentFileMediaType(file);
      const image = /^image\/(?:png|jpeg|webp)$/u.test(mediaType);
      return {
        id: `file-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
        blob: file,
        previewUrl: image ? URL.createObjectURL(file) : "",
        name: file.name,
        width: 0,
        height: 0,
        mediaType,
      } satisfies AgentAttachment;
    });
    setAgentSessions((sessions) => sessions.map((session) => session.id === activeAgent.id
      ? { ...session, attachments: [...session.attachments, ...next] }
      : session));
    setAgentAttachmentNotices((notices) => ({
      ...notices,
      [activeAgent.id]: rejected ? `最多添加 4 个附件，已忽略 ${rejected} 个。` : "",
    }));
  };

  const cancelAgentScreenshot = () => {
    setScreenshotOpen(false);
    setScreenshotTargetAgentId(null);
    window.requestAnimationFrame(() => agentScreenshotButtonRef.current?.focus({ preventScroll: true }));
  };

  const removeAgentAttachment = (attachmentId: string) => {
    const attachment = activeAgent?.attachments.find((candidate) => candidate.id === attachmentId);
    if (attachment?.previewUrl.startsWith("blob:")) URL.revokeObjectURL(attachment.previewUrl);
    setAgentSessions((sessions) => sessions.map((session) => session.id === activeAgentId
      ? { ...session, attachments: session.attachments.filter((attachment) => attachment.id !== attachmentId) }
      : session));
    setAgentAttachmentNotices((notices) => ({ ...notices, [activeAgentId]: "" }));
  };

  const createAgentSession = async () => {
    const number = agentSessionCounterRef.current + 1;
    agentSessionCounterRef.current = number;
    let persistedId = `agent-${number}`;
    let persistedAt = Date.now();
    if (projectId) {
      try {
        const created = await createPersistedConversation(projectId, {
          title: `Design Prompt ${number}`,
          activeFamily: activeAgentFamily ?? "",
          modelRoute: activeAgent?.modelRoute ?? "auto",
        });
        persistedId = created.id;
        persistedAt = created.updatedAt;
      } catch (error) {
        setAgentAttachmentNotices((notices) => ({
          ...notices,
          [activeAgentId]: error instanceof Error ? error.message : "新建会话失败",
        }));
        return;
      }
    }
    const session: AgentSession = {
      id: persistedId,
      title: `Design Prompt ${number}`,
      input: "",
      messages: [],
      attachments: [],
      persisted: Boolean(projectId),
      loaded: true,
      updatedAt: persistedAt,
      modelRoute: activeAgent?.modelRoute ?? "auto",
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
      previewUrls.forEach((previewUrl) => {
        if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
      });
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
    previewUrls.forEach((previewUrl) => {
      if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    });
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

  const importAgentTrace = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const trace = parseAgentTrace(JSON.parse(await file.text()) as unknown);
      const timeline = agentTimeline(trace);
      const metrics = metricsFromAgentTrace(trace);
      const sessionId = `agent-trace-${Date.now()}`;
      const session: AgentSession = {
        id: sessionId,
        title: trace.conversation.active_family === "comparator" ? "Comparator Trace" : "OTA / OpAmp Trace",
        input: "",
        attachments: [],
        modelRoute: "auto",
        messages: timeline.map((item) => ({
          id: item.id,
          sequence: item.sequence,
          role: item.kind === "user_message" ? "user" : "assistant",
          text: item.body,
          kind: item.kind,
          title: item.title,
          status: item.status,
          code: item.code,
          metrics: item.metrics,
          evidenceLevel: item.evidenceLevel,
        })),
      };
      setAgentSessions((sessions) => [...sessions, session]);
      setActiveAgentId(sessionId);
      setActiveAgentFamily(trace.conversation.active_family);
      setOptimizationMetrics(metrics);
      setSelectedOptimizationRound(metrics.at(-1)?.round ?? null);
      setBottomTab("simulation");
      setCenterViewTab("waveform");
      setAgentOpen(true);
      setSavedAt(`Agent trace · ${trace.conversation.active_family} · ${timeline.length} events`);
    } catch (error) {
      setAgentAttachmentNotices((notices) => ({
        ...notices,
        [activeAgentId]: error instanceof Error ? error.message : "Agent trace import failed",
      }));
    }
  };

  const handleNodeDoubleClick = (node: SchematicNode) => {
    if (descendIntoHierarchy(node)) return;
    openPropertyEditor(node);
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

  const addPaletteItem = (item: PaletteItem) => {
    if (item.type === "template") {
      editorRef.current?.addSubcircuitTemplate(item.kind);
      return;
    }
    editorRef.current?.addDevice(item.kind);
  };

  const addPaletteItemAtClient = (item: PaletteItem, clientX: number, clientY: number) => {
    if (item.type === "template") {
      editorRef.current?.addSubcircuitTemplateAtClient(item.kind, clientX, clientY);
      return;
    }
    editorRef.current?.addDeviceAtClient(item.kind, clientX, clientY);
  };

  const startPaletteDrag = (
    event: ReactMouseEvent<HTMLButtonElement>,
    item: PaletteItem,
  ) => {
    if (event.button !== 0) return;
    const next: PaletteDrag = {
      item,
      label: item.label,
      symbol: item.symbol,
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
        addPaletteItemAtClient(current.item, upEvent.clientX, upEvent.clientY);
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

  const netlistExport = NETLIST_EXPORTS.find((item) => item.value === dialect) ?? NETLIST_EXPORTS[0];
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
          <button className="header-action" onClick={() => setAgentOpen((value) => !value)}><Bot size={15} /> Design Prompt</button>
          <span className="user-avatar" aria-label={username || "账户"} title={username || "账户"}>{username.slice(0, 2).toUpperCase() || "AS"}</span>
        </div>
      </header>

      {saveState === "conflict" && <div className="save-conflict-banner" role="alert">
        <span><AlertTriangle size={14} />项目已在其他页面修改。本页内容尚未覆盖服务器版本。</span>
        <div>
          <button onClick={() => downloadText(`${rootDocument.cell}.local-conflict.schematic.json`, serializeSchematic(projectDocumentSnapshot(), true), "application/json")}>导出本地副本</button>
          <button onClick={() => window.location.reload()}>重新载入服务器版本</button>
        </div>
      </div>}

      <div className="primary-toolbar">
        <div className="tool-group" data-group="文件">
          <button className="tool-button" title="清空当前原理图" onClick={() => editorRef.current?.clear()}><FilePlus2 size={20} /><span>清空</span></button>
          <button className="tool-button" title="保存到账户项目" onClick={() => void saveProject()}><Save size={20} /><span>保存</span></button>
          <button className="tool-button" title="提取连接、运行规则检查并保存" onClick={() => void checkAndSave()}><CheckCircle2 size={20} /><span>检查保存</span></button>
          <button className="tool-button" title="保存并返回项目列表" onClick={() => void returnToProjects()}><FolderOpen size={20} /><span>项目</span></button>
          <button className="tool-button" title="导入工程 JSON、Spectre/SPICE/CDL 网表" onClick={() => importRef.current?.click()}><Upload size={20} /><span>导入</span></button>
          <button className="tool-button" title="生成 Cadence 带布线原理图转换任务" onClick={createCadenceConvertorDraft}><FileDown size={20} /><span>代码转图</span></button>
          <button className="tool-button" title="导出 Cadence OA / SKILL / CDL handoff" onClick={downloadCadenceOaPackage}><Download size={20} /><span>导出OA</span></button>
          <input ref={importRef} className="sr-only" type="file" accept="application/json,.json,.scs,.sp,.spi,.spice,.cir,.ckt,.cdl,.net,.txt" onChange={importDesignFile} />
          <input ref={metricsImportRef} className="sr-only" type="file" accept="application/json,.json,.txt" onChange={importOptimizationMetricsFile} />
          <input ref={cadenceReportImportRef} className="sr-only" type="file" accept="application/json,.json" onChange={importCadenceReportFile} />
        </div>
        <div className="toolbar-divider" />
        <div className="tool-group" data-group="历史记录">
          <button className="tool-button" title="撤销 Ctrl+Z" onClick={() => editorRef.current?.undo()}><Undo2 size={20} /><span>撤销</span></button>
          <button className="tool-button" title="重做 Ctrl+Y" onClick={() => editorRef.current?.redo()}><Redo2 size={20} /><span>重做</span></button>
        </div>
        <div className="toolbar-divider" />
        <div className="tool-group" data-group="工具">
          <button
            className="tool-button"
            title="返回上一层 cellview"
            onClick={ascendHierarchy}
            disabled={!canAscendHierarchy}
          ><ArrowUp size={20} /><span>Up</span></button>
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
          <button className="tool-button" title="旋转选中对象；无选中时旋转画幅 R" onClick={() => editorRef.current?.rotateSelected()}><RotateCw size={20} /><span>旋转</span></button>
          <button className="tool-button" title="镜像 X" onClick={() => editorRef.current?.mirrorSelected()}><FlipHorizontal2 size={20} /><span>镜像</span></button>
          <button className="tool-button danger-hover" title="删除" onClick={() => editorRef.current?.deleteSelected()}><Trash2 size={20} /><span>删除</span></button>
        </div>
        <div className="toolbar-divider" />
        <div className="tool-group" data-group="视图">
          <button className="tool-button" title="旋转画幅 90°" onClick={() => editorRef.current?.rotateView()}><RotateCw size={20} /><span>{canvasRotation ? `${canvasRotation}°` : "画幅"}</span></button>
          <button className="tool-button" title="放大" onClick={() => editorRef.current?.zoomIn()}><ZoomIn size={20} /><span>放大</span></button>
          <button className="tool-button" title="缩小" onClick={() => editorRef.current?.zoomOut()}><ZoomOut size={20} /><span>缩小</span></button>
          <button className="tool-button" title="适合窗口" onClick={() => editorRef.current?.fit()}><Maximize2 size={20} /><span>适合</span></button>
          <button className="tool-button" title="居中查看选中对象 / 全部内容 C" onClick={() => editorRef.current?.centerSelection()}><Search size={20} /><span>居中</span></button>
          <button className={`tool-button grid-button ${gridMode !== "off" ? "selected" : ""}`} title="切换格点 / 网格 / 关闭" onClick={cycleGridMode}><Grid3X3 size={20} /><span>{gridModeLabel}</span></button>
        </div>
        <div className="header-spacer" />
        <button className="run-button" title="在 Analog Studio 内提交生成、修改和调优闭环" onClick={focusDesignPrompt}><Play size={21} fill="currentColor" /><span>闭环调优</span></button>
      </div>

      <section ref={workspaceRef} className={`workspace-grid ${agentOpen ? "" : "agent-closed"}`}>
        <aside className="left-sidebar panel-surface">
          <div className="sidebar-heading"><strong>器件</strong><span>{pdkSummary.cadenceClosedLoop}/{pdkSummary.selectable} PDK</span></div>
          <div className="segmented-tabs compact-tabs">
            <button className={leftMode === "library" ? "active" : ""} onClick={() => setLeftMode("library")}><Library size={14} />器件库</button>
            <button className={leftMode === "project" ? "active" : ""} onClick={() => setLeftMode("project")}><FolderTree size={14} />工程</button>
          </div>
          {leftMode === "library" ? (
            <>
              <label className="search-box"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索器件 / PDK" /></label>
              <div className="library-breadcrumb"><span>{activePdk.libraryLabel}</span><ChevronDown size={13} /></div>
              <div className="pdk-registry-panel">
                <label className="pdk-select-row">
                  <Settings2 size={13} />
                  <select
                    aria-label="当前 PDK"
                    value={activePdkProfileId}
                    onChange={(event) => choosePdkProfile(event.target.value)}
                  >
                    {pdkEntries.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label} · {pdkStatusLabel(entry)}
                      </option>
                    ))}
                  </select>
                  <span className={`pdk-state ${activePdk.evidenceLevel}`}>{activePdkStatus}</span>
                </label>
                <div className="pdk-meta-line">
                  <span>{activePdk.nodeNm}nm</span>
                  <span>{activePdk.supportStatus}</span>
                  <span>{activePdk.defaultCorner}</span>
                </div>
                <div className="pdk-chip-row">
                  <span className="pdk-chip">fact {activePdk.factStatus}</span>
                  <span className="pdk-chip">cal {activePdk.calibrationStatus}</span>
                  <span className="pdk-chip">layout {activePdk.layoutContractStatus}</span>
                </div>
                <div className="pdk-model-line">{activePdk.modelNames.slice(0, 4).join(" · ") || "model map pending"}</div>
              </div>
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
                            addPaletteItem(item);
                          }}
                          title={item.type === "template" ? "点击或拖到画布，展开为可编辑 MOS 级电路" : "点击或拖到画布"}
                        >
                          <PaletteSymbolPreview item={item} />
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
              <div className="tree-line root"><FolderTree size={15} /> {projectName ?? rootDocument.project}</div>
              <div className="tree-line"><Box size={14} /> schematic</div>
              {hierarchyStack.map((frame, index) => (
                <div className={`tree-line ${index === hierarchyStack.length - 1 ? "active" : ""}`} key={`${frame.key}-${index}`}>
                  <span className="tree-leaf">S</span> {frame.cell} / schematic
                </div>
              ))}
            </div>
          )}
          <div className="library-footer"><Settings2 size={14} /> PDK: <strong>{activePdk.id}</strong><span>{activePdkStatus}</span></div>
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
            <button
              className={`document-tab ${centerViewTab === "schematic" ? "active" : ""}`}
              onClick={() => setCenterViewTab("schematic")}
            ><span className="tab-type">S</span> {document.cell} {canAscendHierarchy && <span className="tab-dirty">↧</span>} {saveState !== "saved" && <span className="tab-dirty">●</span>}</button>
            {waveformViewerOpen && (
              <button
                className={`document-tab waveform-tab ${centerViewTab === "waveform" ? "active" : ""}`}
                onClick={() => setCenterViewTab("waveform")}
              ><Waves size={14} /> Waveform</button>
            )}
            <button className="new-tab" title="打开 Waveform Viewer" onClick={openWaveformViewer}>+</button>
            <div className="canvas-context">Library: {rootDocument.project} · Cell: {hierarchyPath} · View: {centerViewTab === "schematic" ? "schematic" : "waveform"}</div>
          </div>
          <div className={paletteDrag?.moved ? "canvas-frame drop-ready" : "canvas-frame"}>
            {centerViewTab === "schematic" ? (
              <>
                <SchematicCanvas
                  ref={editorRef}
                  initialDocument={document}
                  toolMode={toolMode}
                  wireDrawMode={wireDrawMode}
                  onDocumentChange={(nextDocument) => {
                    documentRef.current = nextDocument;
                    setDocument(nextDocument);
                    syncVisibleDocumentIntoRoot(nextDocument, true);
                  }}
                  onSelectionChange={(node) => {
                    setSelected(node);
                    if (!node) closePropertyEditor();
                  }}
                  onNodeDoubleClick={handleNodeDoubleClick}
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
                {!schematicProvenance.canClaimConvertedSchematic && (
                  <div className={`schematic-source-banner ${schematicProvenance.kind}`} title={schematicProvenance.reasons.join("\n")}>
                    <AlertTriangle size={14} />
                    <strong>{schematicProvenance.label}</strong>
                    <span>{schematicProvenance.message}</span>
                  </div>
                )}
                {toolMode === "wire" && <div className="wire-mode-hint"><Cable size={13} />{commandState.prompt} · Enter/双击完成 · Backspace 回退 · F3 选项 · F4 选择模式</div>}
                {toolMode === "no-connect" && <div className="wire-mode-hint"><X size={13} />{commandState.prompt} · N 进入 · Esc 退出</div>}
              </>
            ) : (
              <WaveformViewer
                panels={activeWaveformPanels}
                activeMetric={activeWaveformMetric}
                summary={optimizationSummary}
                metricFlavor={metricFlavor}
                demo={!optimizationMetrics.length}
              />
            )}
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
                <button className={bottomTab === "setup" ? "active" : ""} onClick={() => setBottomTab("setup")}><Settings2 size={14} />仿真设置</button>
                <button className={bottomTab === "netlist" ? "active" : ""} onClick={() => setBottomTab("netlist")}><FileDown size={14} />网表预览</button>
                <button className={bottomTab === "markers" ? "active" : ""} onClick={() => setBottomTab("markers")}><AlertTriangle size={14} />检查标记</button>
                <button className={bottomTab === "simulation" ? "active" : ""} onClick={() => setBottomTab("simulation")}><Activity size={14} />仿真结果</button>
                <button className={bottomTab === "waveforms" ? "active" : ""} onClick={openWaveformViewer}><Waves size={14} />波形</button>
                <button className={bottomTab === "statistics" ? "active" : ""} onClick={() => setBottomTab("statistics")}><Activity size={14} />统计</button>
                <button className={bottomTab === "console" ? "active" : ""} onClick={() => setBottomTab("console")}><Waves size={14} />控制台</button>
              </div>
              {bottomTab === "setup" && (
                <div className="netlist-actions">
                  <span className="simulation-session-state">{simulationSession.family === "opamp" ? "OTA / OpAmp" : "Comparator"} · {simulationOperation(simulationSession) === "full_signoff" ? "PVT / MC" : "nominal"}</span>
                  <button
                    className="simulation-run-command"
                    type="button"
                    onClick={() => {
                      setAgentOpen(true);
                      void executeAgentPrompt(
                        simulationSessionPrompt(simulationSession),
                        simulationParameters(simulationSession),
                        simulationOperation(simulationSession),
                      );
                    }}
                  ><Play size={13} />运行</button>
                </div>
              )}
              {bottomTab === "netlist" && (
                <div className="netlist-actions">
                  <div className="dialect-toggle">
                    {NETLIST_EXPORTS.map((option) => (
                      <button
                        className={dialect === option.value ? "active" : ""}
                        key={option.value}
                        onClick={() => setDialect(option.value)}
                      >{option.label}</button>
                    ))}
                  </div>
                  <button className="mini-action" title="复制" onClick={() => navigator.clipboard.writeText(compiled.text)}><Copy size={14} /></button>
                  <button className="mini-action" title="下载" onClick={() => downloadText(`${document.cell}.${netlistExport.extension}`, compiled.text, netlistExport.mime)}><Download size={14} /></button>
                </div>
              )}
              {bottomTab === "simulation" && (
                <div className="netlist-actions">
                  <button className="mini-action" title="导入 per_round_metrics.json" onClick={() => metricsImportRef.current?.click()}><Upload size={14} /></button>
                  <button className="mini-action" title="导入 Cadence closed_loop_report.json" onClick={() => cadenceReportImportRef.current?.click()}><FileDown size={14} /></button>
                  <button className="mini-action" title="打开 Waveform Viewer" onClick={openWaveformViewer}><Waves size={14} /></button>
                </div>
              )}
              {bottomTab === "waveforms" && (
                <div className="netlist-actions">
                  <button className="mini-action" title="导入 per_round_metrics.json" onClick={() => metricsImportRef.current?.click()}><Upload size={14} /></button>
                  <button className="mini-action" title="返回原理图" onClick={() => setCenterViewTab("schematic")}><MousePointer2 size={14} /></button>
                </div>
              )}
            </div>
            {bottomTab === "setup" && (
              <div className="simulation-setup-workspace">
                <section className="simulation-config-section variables">
                  <header><strong>Variables</strong><span>{simulationSession.variables.length}</span></header>
                  <div className="simulation-variable-table">
                    {simulationSession.variables.map((variable) => (
                      <label key={variable.id}>
                        <span>{variable.label}</span>
                        <input
                          type="number"
                          step="any"
                          value={variable.value}
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            if (!Number.isFinite(value)) return;
                            setSimulationSession((session) => ({
                              ...session,
                              variables: session.variables.map((item) => item.id === variable.id ? { ...item, value } : item),
                            }));
                          }}
                        />
                        <small>{variable.unit}</small>
                      </label>
                    ))}
                  </div>
                </section>
                <section className="simulation-config-section analyses">
                  <header><strong>Analyses</strong><span>{simulationSession.analyses.filter((item) => item.enabled).length}</span></header>
                  <div className="simulation-analysis-list">
                    {simulationSession.analyses.map((analysis) => (
                      <label className={!analysis.executable ? "disabled" : ""} key={analysis.kind} title={!analysis.executable ? "owned-runtime 路由尚未闭合" : analysis.label}>
                        <input
                          type="checkbox"
                          checked={analysis.enabled}
                          disabled={!analysis.executable}
                          onChange={(event) => setSimulationSession((session) => ({
                            ...session,
                            analyses: session.analyses.map((item) => {
                              if (item.kind === analysis.kind) return { ...item, enabled: event.target.checked };
                              if (analysis.kind === "mc" && event.target.checked && item.kind === "pvt") return { ...item, enabled: true };
                              return item;
                            }),
                          }))}
                        />
                        <span>{analysis.label}</span>
                        <code>{analysis.kind}</code>
                      </label>
                    ))}
                  </div>
                </section>
                <section className="simulation-config-section outputs">
                  <header><strong>Outputs / Expressions</strong><span>{simulationSession.outputs.length}</span></header>
                  <div className="simulation-output-table">
                    {simulationSession.outputs.map((output) => (
                      <div key={output.id}>
                        <span>{output.label}</span>
                        <code>{output.expression}</code>
                        <small>{output.analysis}</small>
                      </div>
                    ))}
                  </div>
                </section>
                <section className="simulation-config-section specs">
                  <header><strong>Specifications</strong><span>{simulationSession.specs.length}</span></header>
                  <div className="simulation-spec-table">
                    {simulationSession.specs.map((spec) => (
                      <label key={spec.metric}>
                        <code>{spec.metric}</code>
                        <span>{spec.operator}</span>
                        <input
                          type="number"
                          step="any"
                          value={spec.target}
                          onChange={(event) => {
                            const target = Number(event.target.value);
                            if (!Number.isFinite(target)) return;
                            setSimulationSession((session) => ({
                              ...session,
                              specs: session.specs.map((item) => item.metric === spec.metric ? { ...item, target } : item),
                            }));
                          }}
                        />
                        <small>{spec.unit}</small>
                      </label>
                    ))}
                  </div>
                  <div className="simulation-history-summary">
                    <span>History</span>
                    <strong>{optimizationMetrics.length}</strong>
                    <small>{optimizationMetrics.filter((item) => item.specPassed).length} pass</small>
                  </div>
                </section>
              </div>
            )}
            {bottomTab === "netlist" && (
              <div className="netlist-body">
                <div className="code-gutter">{netlistPreviewLines.map((_, index) => <span key={index}>{index + 1}</span>)}</div>
                <pre className="code-preview" aria-label={`${dialect} code preview`}>
                  {netlistPreviewLines.map((line, lineIndex) => (
                    <code className="code-line" key={`${lineIndex}-${line}`}>
                      {highlightNetlistLine(line, dialect).map((token, tokenIndex) => (
                        <span className={token.kind ? `tok-${token.kind}` : undefined} key={`${lineIndex}-${tokenIndex}`}>{token.text}</span>
                      ))}
                      {lineIndex < netlistPreviewLines.length - 1 ? "\n" : ""}
                    </code>
                  ))}
                </pre>
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
              <OptimizationResultsPanel
                metrics={visibleOptimizationMetrics}
                summary={optimizationSummary}
                metricFlavor={metricFlavor}
                demo={!optimizationMetrics.length}
                activeRound={activeWaveformMetric?.round ?? null}
                optimizationRequest={optimizationRequest}
                convertorRequest={cadenceConvertorRequest}
                convertorReport={cadenceConvertorReport}
                onImportMetrics={() => metricsImportRef.current?.click()}
                onDownloadOptimizationRequest={downloadOptimizationRequest}
                onDownloadConvertorRequest={downloadCadenceConvertorRequest}
                onOpenWaveform={openWaveformViewer}
                onSelectRound={setSelectedOptimizationRound}
              />
            )}
            {bottomTab === "waveforms" && (
              <div className="bottom-waveform-panel">
                <WaveformViewer
                  panels={activeWaveformPanels}
                  activeMetric={activeWaveformMetric}
                  summary={optimizationSummary}
                  metricFlavor={metricFlavor}
                  demo={!optimizationMetrics.length}
                />
              </div>
            )}
            {bottomTab === "statistics" && (
              <SimulationStatisticsPanel metrics={optimizationMetrics} flavor={metricFlavor} />
            )}
            {bottomTab === "console" && (
              <div className="console-lines">
                <span className="console-time">[workspace]</span> {document.library}/{document.cell} · ERC {issueCount ? `${issueCount} issues` : "pass"}<br />
                <span className="console-time">[compiler]</span> {dialect} · {compiled.nets.length} nets · revision {document.revisions.designRevision}<br />
                {(activeAgent?.messages ?? [])
                  .filter((message) => message.kind === "agent_action" || message.kind === "tool_invocation" || message.kind === "tool_result")
                  .slice(-20)
                  .map((message) => (
                    <span className={`console-event ${message.status ?? "info"}`} key={message.id}>
                      <span className="console-time">[{message.kind}]</span> {message.title || "SPEG"} · {message.text.replace(/\s+/g, " ").slice(0, 240)}<br />
                    </span>
                  ))}
              </div>
            )}
          </section>
        </section>

        {agentOpen && (
          <>
            <div
              className="pane-splitter vertical dark"
              role="separator"
              aria-label="调节 Design Prompt 面板宽度"
              aria-orientation="vertical"
              aria-valuemin={280}
              aria-valuemax={560}
              aria-valuenow={layout.rightWidth}
              tabIndex={0}
              onPointerDown={(event) => startPanelResize(event, "right")}
              onKeyDown={(event) => handleSeparatorKey(event, "right")}
              onDoubleClick={() => resetPanelSize("right")}
            />
            <aside className="agent-sidebar" aria-label="Design Prompt">
              <input
                ref={agentTraceImportRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={importAgentTrace}
              />
              <input
                ref={agentFileInputRef}
                type="file"
                accept={AGENT_FILE_ACCEPT}
                multiple
                hidden
                onChange={selectAgentFiles}
              />
              <div className="agent-tabbar">
                <div ref={agentTabsRef} className="agent-tabs-scroll" role="tablist" aria-label="Agent 会话">
                  {agentSessions.map((session) => (
                    <div
                      className={`agent-session-tab ${session.id === activeAgentId ? "active" : ""}`}
                      role="tab"
                      aria-selected={session.id === activeAgentId}
                      tabIndex={session.id === activeAgentId ? 0 : -1}
                      key={session.id}
                      onClick={() => void openAgentConversation(session.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          void openAgentConversation(session.id);
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
                  <button title="新建 Agent 会话" onClick={() => void createAgentSession()}><Plus size={17} /></button>
                  <button title="项目对话历史" onClick={() => {
                    const next = !agentHistoryOpen;
                    setAgentHistoryOpen(next);
                    if (next) void refreshAgentConversationCatalog();
                  }}><Clock3 size={16} /></button>
                  <button title="导入 Agent Trace" onClick={() => agentTraceImportRef.current?.click()}><Upload size={16} /></button>
                  <button title="更多"><MoreHorizontal size={17} /></button>
                </div>
              </div>
              {agentHistoryOpen && (
                <div className="agent-history-picker" aria-label="项目对话历史">
                  <div className="agent-history-heading">
                    <strong>项目对话</strong>
                    <span>{agentHistoryLoading ? "同步中" : `${agentSessions.length} 个会话`}</span>
                  </div>
                  <div className="agent-history-list">
                    {agentSessions.map((session) => (
                      <button
                        type="button"
                        className={session.id === activeAgentId ? "active" : ""}
                        key={session.id}
                        onClick={() => void openAgentConversation(session.id)}
                      >
                        <MessageSquare size={14} />
                        <span><strong>{session.title}</strong><small>{session.loaded ? `${session.messages.length} 条记录` : "点击加载历史"}</small></span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className={`agent-composer ${activeAgent?.attachments.length ? "has-attachments" : ""}`}>
                {!!activeAgent?.attachments.length && (
                  <div className="agent-attachment-strip" aria-label="待发送的附件">
                    {activeAgent.attachments.map((attachment) => (
                      <figure className="agent-attachment" key={attachment.id}>
                        {isAgentImage(attachment) && attachment.previewUrl
                          ? <Image
                              src={attachment.previewUrl}
                              alt={`图片附件 ${attachment.name}`}
                              width={attachment.width || 640}
                              height={attachment.height || 480}
                              draggable={false}
                              unoptimized
                            />
                          : <div className="agent-attachment-file-icon"><FileText size={22} /><span>{attachment.mediaType || "file"}</span></div>}
                        <figcaption>{attachment.name}{attachment.blob ? ` · ${formatAttachmentSize(attachment.blob.size)}` : ""}</figcaption>
                        <button
                          type="button"
                          title="删除这个附件"
                          aria-label={`删除附件 ${attachment.name}`}
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
                  placeholder="描述电路需求、尺寸修改、拓扑修改或性能指标"
                  aria-label={`向 ${activeAgent?.title ?? "Design Prompt"} 输入任务`}
                />
                <div className="agent-composer-footer">
                  <div className="agent-composer-modes">
                    <button className="agent-mode" onClick={focusDesignPrompt}><Bot size={14} /> SPEG Agent <ChevronDown size={12} /></button>
                    <select
                      className="agent-model"
                      aria-label="Agent 模型"
                      title="选择电路 Agent 模型"
                      value={activeAgent?.modelRoute ?? "auto"}
                      onChange={(event) => void selectAgentModelRoute(event.target.value as AgentModelRoute)}
                    >
                      {agentModelCatalog.map((model) => (
                        <option key={model.route} value={model.route} disabled={!model.configured}>
                          {model.label}{model.configured ? "" : " · 离线"}
                        </option>
                      ))}
                    </select>
                    <button
                      className="agent-workflow"
                      title="切换优化流程：Auto / End-to-End / Patch"
                      onClick={cycleAgentWorkflowMode}
                    >{WORKFLOW_MODE_LABELS[agentWorkflowMode]} <ChevronDown size={12} /></button>
                  </div>
                  <div className="agent-composer-actions">
                    <button
                      type="button"
                      title="添加文件附件"
                      aria-label="添加文件附件"
                      onClick={() => agentFileInputRef.current?.click()}
                    ><Paperclip size={15} /></button>
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
                    {message.role === "assistant" && (message.kind || message.status) && (
                      <div className={`agent-message-meta ${message.status ?? "info"}`}>
                        <div>
                          <strong>{message.title ?? message.kind ?? "SPEG Design Agent"}</strong>
                          <span>{message.sequence ? `#${message.sequence} · ` : ""}{message.kind ?? "model_response"}</span>
                        </div>
                        <div className="agent-message-meta-actions">
                          {message.modelId && <span className="agent-message-model">{message.modelId}</span>}
                          {message.evidenceLevel && <strong>{message.evidenceLevel}</strong>}
                          {message.status === "running" && message.jobId && (
                            <button
                              type="button"
                              title="取消 SPEG 任务"
                              aria-label="取消 SPEG 任务"
                              onClick={() => cancelAgentJob(activeAgentId, message.id, message.jobId!)}
                            ><CircleStop size={13} /></button>
                          )}
                        </div>
                      </div>
                    )}
                    <div className="agent-message-body">{renderAgentText(message.text)}</div>
                    {message.code && (
                      <details className="agent-message-code-disclosure">
                        <summary><FileCode2 size={13} />完整代码 · {message.code.split("\n").length} 行</summary>
                        <pre className="agent-message-code"><code>{message.code}</code></pre>
                      </details>
                    )}
                    {message.metrics && Object.keys(message.metrics).length > 0 && (
                      <dl className="agent-message-metrics">
                        {Object.entries(message.metrics).map(([key, value]) => (
                          <div key={key}><dt>{key}</dt><dd>{formatAgentMetric(value)}</dd></div>
                        ))}
                      </dl>
                    )}
                    {!!message.attachments?.length && (
                      <div className="agent-message-attachments">
                        {message.attachments.map((attachment) => (
                          isAgentImage(attachment)
                            ? <a className="agent-message-image-link" href={attachment.previewUrl} target="_blank" rel="noreferrer" key={attachment.id} title={`打开 ${attachment.name}`}>
                                <Image
                                  src={attachment.previewUrl}
                                  alt={`已发送图片 ${attachment.name}`}
                                  width={attachment.width || 640}
                                  height={attachment.height || 480}
                                  unoptimized
                                />
                              </a>
                            : <a className="agent-attachment-file" href={attachment.previewUrl} download={attachment.name} key={attachment.id}>
                                <FileText size={16} />
                                <span><strong>{attachment.name}</strong><small>{attachment.mediaType} · {formatAttachmentSize(attachment.sizeBytes ?? 0)}</small></span>
                                <Download size={14} />
                              </a>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="agent-status"><span />AnalogWeave Studio · SPEG Design Agent</div>
            </aside>
          </>
        )}
      </section>

      <footer className="status-bar">
        <div className="status-ready"><span className="ready-dot" />{commandState.prompt} · ERC {issueCount ? `${issueCount} 提示` : "通过"}</div>
        <div>模式：{toolMode === "select" ? "选择" : toolMode === "wire" ? `连线 · ${wireDrawMode}` : "No Connect"}</div><div className={schematicProvenance.canClaimConvertedSchematic ? "status-source ok" : "status-source warning"} title={schematicProvenance.reasons.join("\n")}>来源：{schematicProvenance.label}</div><div>选择：{commandState.partialSelection ? "部分" : "完全包含"}</div><div>主网格：{gridModeLabel} · {document.displayGrid} DBU</div><div>吸附：{document.snapGrid} DBU</div><div>Objects: {document.nodes.length + document.edges.length + document.noConnects.length}</div><div>Nets: {compiled.nets.length}</div><div>{document.revisions.connectivityRevision === document.revisions.designRevision ? "Connectivity: Current" : "Connectivity: Stale"}</div>
        <div className="status-spacer" />
        <div className="status-coordinate">
          {cursorPosition
            ? `x: ${cursorPosition.x.toFixed(0)}   y: ${cursorPosition.y.toFixed(0)}`
            : "x: —   y: —"}
        </div>
        <div className="status-saved">保存：{savedAt}</div>
        <div className="status-zoom">
          <button title="缩小 Ctrl+-" onClick={() => editorRef.current?.zoomOut()}>−</button>
          <span className="zoom-track"><i style={{ left: `${canvasZoomTrack}%` }} /></span>
          <span className="zoom-value">
            {Number.isFinite(canvasZoomPercent) ? canvasZoomPercent : 100}%
            {canvasRotation ? `/${canvasRotation}°` : ""}
          </span>
          <button title="放大 Ctrl++" onClick={() => editorRef.current?.zoomIn()}>+</button>
          <button className="zoom-fit" title="重置画幅旋转" onClick={() => editorRef.current?.resetViewRotation()}>0°</button>
          <button className="zoom-fit" title="居中查看 C" onClick={() => editorRef.current?.centerSelection()}>居中</button>
          <button className="zoom-fit" title="适合窗口 Ctrl+0 / F" onClick={() => editorRef.current?.fit()}>适合</button>
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
          <PaletteSymbolPreview item={paletteDrag.item} /><strong>{paletteDrag.label}</strong>
        </div>
      )}
      {screenshotOpen && (
        <FlexibleScreenshotOverlay onCancel={cancelAgentScreenshot} onComplete={completeAgentScreenshot} />
      )}
    </main>
  );
}
