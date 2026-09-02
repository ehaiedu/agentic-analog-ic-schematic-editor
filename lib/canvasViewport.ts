export const CANVAS_MIN_SCALE = 0.2;
export const CANVAS_MAX_SCALE = 4;
export const CANVAS_ZOOM_FACTOR = 1.2;

export function clampCanvasScale(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  return Math.max(CANVAS_MIN_SCALE, Math.min(CANVAS_MAX_SCALE, scale));
}

export function nextCanvasZoomScale(currentScale: number, factor: number): number {
  const safeCurrent = Number.isFinite(currentScale) && currentScale > 0 ? currentScale : 1;
  const safeFactor = Number.isFinite(factor) && factor > 0 ? factor : 1;
  return clampCanvasScale(safeCurrent * safeFactor);
}

export function normalizeCanvasRotation(angle: number): number {
  if (!Number.isFinite(angle)) return 0;
  return ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
}
