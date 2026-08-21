"use client";

import { Check, RotateCcw, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

export interface ScreenshotCapture {
  blob: Blob;
  name: string;
  width: number;
  height: number;
}

interface FlexibleScreenshotOverlayProps {
  onCancel: () => void;
  onComplete: (capture: ScreenshotCapture) => void;
}

type SelectionRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type ResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

type DragState = {
  pointerId: number;
  mode: "create" | "move" | "resize";
  startX: number;
  startY: number;
  initial: SelectionRect;
  handle?: ResizeHandle;
};

const MIN_SELECTION_SIZE = 24;
const RESIZE_HANDLES: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

function clamp(value: number, minimum: number, maximum: number) {
  const safeMaximum = Math.max(minimum, maximum);
  return Math.min(Math.max(value, minimum), safeMaximum);
}

function captureFilename() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `schematic-capture-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.png`;
}

export function FlexibleScreenshotOverlay({ onCancel, onComplete }: FlexibleScreenshotOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const capturingRef = useRef(false);
  const captureGenerationRef = useRef(0);
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState("");

  const finishPointerDrag = useCallback((pointerId: number) => {
    if (dragRef.current?.pointerId !== pointerId) return;
    dragRef.current = null;
    setSelection((current) => {
      if (!current) return null;
      if (current.width < MIN_SELECTION_SIZE || current.height < MIN_SELECTION_SIZE) return null;
      return current;
    });
    try {
      overlayRef.current?.releasePointerCapture(pointerId);
    } catch {
      // Pointer capture may already be released when the pointer leaves the browser window.
    }
  }, []);

  const captureSelection = useCallback(async () => {
    if (!selection || capturingRef.current) return;
    const overlay = overlayRef.current;
    if (!overlay) return;

    const captureGeneration = ++captureGenerationRef.current;
    const captureRect: SelectionRect = {
      width: Math.min(selection.width, window.innerWidth),
      height: Math.min(selection.height, window.innerHeight),
      left: 0,
      top: 0,
    };
    captureRect.left = clamp(selection.left, 0, window.innerWidth - captureRect.width);
    captureRect.top = clamp(selection.top, 0, window.innerHeight - captureRect.height);
    capturingRef.current = true;
    setCapturing(true);
    setError("");

    try {
      // Keep the editor bundle lean; the renderer is only needed after the user confirms a selection.
      const { default: html2canvas } = await import("html2canvas");

      const pixelRatio = window.devicePixelRatio || 1;
      const maxDimensionScale = 2_048 / Math.max(captureRect.width, captureRect.height);
      const maxPixelScale = Math.sqrt(4_000_000 / Math.max(1, captureRect.width * captureRect.height));
      const scale = Math.min(pixelRatio, 2, maxDimensionScale, maxPixelScale);
      const canvas = await html2canvas(document.body, {
        allowTaint: false,
        backgroundColor: "#ffffff",
        height: Math.round(captureRect.height),
        imageTimeout: 10_000,
        ignoreElements: (element) => (element as HTMLElement).dataset?.screenshotUi === "true",
        logging: false,
        onclone: (clonedDocument) => {
          clonedDocument.querySelectorAll('[data-screenshot-ui="true"]').forEach((element) => element.remove());
        },
        removeContainer: true,
        scale,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        useCORS: true,
        width: Math.round(captureRect.width),
        windowHeight: window.innerHeight,
        windowWidth: window.innerWidth,
        x: Math.round(captureRect.left + window.scrollX),
        y: Math.round(captureRect.top + window.scrollY),
      });

      const width = canvas.width;
      const height = canvas.height;
      let blob: Blob;
      try {
        blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((result) => {
            if (result) resolve(result);
            else reject(new Error("浏览器未能生成截图文件"));
          }, "image/png");
        });
      } finally {
        // Release the potentially large backing bitmap as soon as the PNG is ready.
        canvas.width = 0;
        canvas.height = 0;
      }
      if (captureGeneration !== captureGenerationRef.current) return;
      onComplete({
        blob,
        name: captureFilename(),
        width,
        height,
      });
    } catch (captureError) {
      if (captureGeneration !== captureGenerationRef.current) return;
      capturingRef.current = false;
      setCapturing(false);
      setError(captureError instanceof Error ? captureError.message : "截图生成失败，请重新框选");
    }
  }, [onComplete, selection]);

  useEffect(() => () => {
    captureGenerationRef.current += 1;
  }, []);

  useEffect(() => {
    overlayRef.current?.focus({ preventScroll: true });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        const buttons = Array.from(overlayRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
        if (!buttons.length) {
          event.preventDefault();
          overlayRef.current?.focus({ preventScroll: true });
          return;
        }
        const activeIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const nextIndex = event.shiftKey
          ? activeIndex <= 0 ? buttons.length - 1 : activeIndex - 1
          : activeIndex < 0 || activeIndex === buttons.length - 1 ? 0 : activeIndex + 1;
        event.preventDefault();
        buttons[nextIndex].focus({ preventScroll: true });
      } else if (event.key === "Escape" && !capturing) {
        event.preventDefault();
        onCancel();
      } else if (
        event.key === "Enter" &&
        event.target === overlayRef.current &&
        selection &&
        !capturing
      ) {
        event.preventDefault();
        void captureSelection();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [captureSelection, capturing, onCancel, selection]);

  useEffect(() => {
    const keepSelectionInViewport = () => {
      setSelection((current) => {
        if (!current) return null;
        const width = Math.min(current.width, window.innerWidth);
        const height = Math.min(current.height, window.innerHeight);
        return {
          left: clamp(current.left, 0, window.innerWidth - width),
          top: clamp(current.top, 0, window.innerHeight - height),
          width,
          height,
        };
      });
    };
    window.addEventListener("resize", keepSelectionInViewport);
    return () => window.removeEventListener("resize", keepSelectionInViewport);
  }, []);

  const startCreate = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (capturing || event.button !== 0) return;
    const startX = clamp(event.clientX, 0, window.innerWidth);
    const startY = clamp(event.clientY, 0, window.innerHeight);
    const initial = { left: startX, top: startY, width: 0, height: 0 };
    dragRef.current = {
      pointerId: event.pointerId,
      mode: "create",
      startX,
      startY,
      initial,
    };
    setError("");
    setSelection(initial);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const startExistingDrag = (
    event: ReactPointerEvent<HTMLElement>,
    mode: "move" | "resize",
    handle?: ResizeHandle,
  ) => {
    if (!selection || capturing || event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    overlayRef.current?.focus({ preventScroll: true });
    dragRef.current = {
      pointerId: event.pointerId,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      initial: selection,
      handle,
    };
    overlayRef.current?.setPointerCapture(event.pointerId);
  };

  const updateSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const x = clamp(event.clientX, 0, window.innerWidth);
    const y = clamp(event.clientY, 0, window.innerHeight);

    if (drag.mode === "create") {
      setSelection({
        left: Math.min(drag.startX, x),
        top: Math.min(drag.startY, y),
        width: Math.abs(x - drag.startX),
        height: Math.abs(y - drag.startY),
      });
      return;
    }

    if (drag.mode === "move") {
      setSelection({
        ...drag.initial,
        left: clamp(drag.initial.left + x - drag.startX, 0, window.innerWidth - drag.initial.width),
        top: clamp(drag.initial.top + y - drag.startY, 0, window.innerHeight - drag.initial.height),
      });
      return;
    }

    let left = drag.initial.left;
    let top = drag.initial.top;
    let right = drag.initial.left + drag.initial.width;
    let bottom = drag.initial.top + drag.initial.height;
    const handle = drag.handle ?? "se";

    if (handle.includes("w")) left = clamp(x, 0, right - MIN_SELECTION_SIZE);
    if (handle.includes("e")) right = clamp(x, left + MIN_SELECTION_SIZE, window.innerWidth);
    if (handle.includes("n")) top = clamp(y, 0, bottom - MIN_SELECTION_SIZE);
    if (handle.includes("s")) bottom = clamp(y, top + MIN_SELECTION_SIZE, window.innerHeight);
    setSelection({ left, top, width: right - left, height: bottom - top });
  };

  const toolbarStyle = selection
    ? {
        left: clamp(selection.left + selection.width - 226, 8, Math.max(8, window.innerWidth - 234)),
        top: selection.top + selection.height + 44 <= window.innerHeight
          ? selection.top + selection.height + 8
          : Math.max(8, selection.top - 44),
      }
    : undefined;

  return (
    <div
      ref={overlayRef}
      className={`screenshot-overlay ${selection ? "has-selection" : ""}`}
      data-screenshot-ui="true"
      role="dialog"
      aria-modal="true"
      aria-label="自由框选截图"
      tabIndex={-1}
      onPointerDown={startCreate}
      onPointerMove={updateSelection}
      onPointerUp={(event) => finishPointerDrag(event.pointerId)}
      onPointerCancel={(event) => finishPointerDrag(event.pointerId)}
      onLostPointerCapture={(event) => finishPointerDrag(event.pointerId)}
    >
      {!selection && (
        <div className="screenshot-instruction" aria-live="polite">
          <strong>拖动鼠标框选截图区域</strong>
          <span>Esc 取消</span>
        </div>
      )}

      {selection && (
        <>
          <div
            className="screenshot-selection"
            style={{
              left: selection.left,
              top: selection.top,
              width: selection.width,
              height: selection.height,
            } as CSSProperties}
            onPointerDown={(event) => startExistingDrag(event, "move")}
          >
            <span className="screenshot-size">{Math.round(selection.width)} × {Math.round(selection.height)}</span>
            {RESIZE_HANDLES.map((handle) => (
              <button
                type="button"
                className={`screenshot-resize-handle handle-${handle}`}
                aria-label={`调整截图选区 ${handle}`}
                key={handle}
                tabIndex={-1}
                onPointerDown={(event) => startExistingDrag(event, "resize", handle)}
              />
            ))}
          </div>
          <div className="screenshot-toolbar" style={toolbarStyle} onPointerDown={(event) => event.stopPropagation()}>
            <button type="button" title="重新框选" disabled={capturing} onClick={() => setSelection(null)}><RotateCcw size={14} />重选</button>
            <button type="button" title="取消截图" disabled={capturing} onClick={onCancel}><X size={14} />取消</button>
            <button
              type="button"
              className="primary"
              disabled={capturing}
              title="确认截图（Enter）"
              onClick={() => void captureSelection()}
            ><Check size={14} />{capturing ? "生成中" : "完成"}</button>
          </div>
        </>
      )}

      {error && <div className="screenshot-error" role="alert">{error}</div>}
    </div>
  );
}
