import assert from "node:assert/strict";
import test from "node:test";

import {
  CANVAS_MAX_SCALE,
  CANVAS_MIN_SCALE,
  CANVAS_ZOOM_FACTOR,
  clampCanvasScale,
  nextCanvasZoomScale,
  normalizeCanvasRotation,
} from "../lib/canvasViewport";

test("canvas zoom uses multiplicative steps and clamps to editor bounds", () => {
  assert.equal(nextCanvasZoomScale(1, CANVAS_ZOOM_FACTOR), 1.2);
  assert.equal(nextCanvasZoomScale(2, 1 / CANVAS_ZOOM_FACTOR), 2 / CANVAS_ZOOM_FACTOR);
  assert.equal(nextCanvasZoomScale(10, CANVAS_ZOOM_FACTOR), CANVAS_MAX_SCALE);
  assert.equal(nextCanvasZoomScale(0.01, 1 / CANVAS_ZOOM_FACTOR), CANVAS_MIN_SCALE);
  assert.equal(clampCanvasScale(Number.NaN), 1);
});

test("canvas rotation is normalized to right-angle view states", () => {
  assert.equal(normalizeCanvasRotation(0), 0);
  assert.equal(normalizeCanvasRotation(89), 90);
  assert.equal(normalizeCanvasRotation(450), 90);
  assert.equal(normalizeCanvasRotation(-90), 270);
  assert.equal(normalizeCanvasRotation(Number.NaN), 0);
});
