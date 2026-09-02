import assert from "node:assert/strict";
import test from "node:test";

import { buildPrimaryMessages, buildVisionMessages } from "../lib/multimodalMessages";

const image = { mediaType: "image/png", base64: "AAECAwQ=" };

test("vision sidecar receives images and an evidence-only instruction", () => {
  const messages = buildVisionMessages({ prompt: "Inspect the comparator waveform", images: [image], family: "comparator" });
  const encoded = JSON.stringify(messages);
  assert.match(encoded, /visual evidence extractor/iu);
  assert.match(encoded, /data:image\/png;base64,AAECAwQ=/u);
  assert.match(encoded, /do not claim simulation success/iu);
});

test("Qwen3.8 primary receives visual evidence but not raw image bytes", () => {
  const messages = buildPrimaryMessages({
    history: [{ role: "assistant", text: "Prior answer", code: "cell = comparator()" }],
    prompt: "Continue the design",
    images: [image],
    family: "comparator",
    visionEvidence: { modelId: "AnalogWeave/Qwen3-VL-8B", text: "The plot contains two differential traces." },
  });
  const encoded = JSON.stringify(messages);
  assert.match(encoded, /AnalogWeave\/Qwen3-VL-8B/u);
  assert.match(encoded, /two differential traces/u);
  assert.match(encoded, /cell = comparator\(\)/u);
  assert.doesNotMatch(encoded, /AAECAwQ=/u);
});

test("single multimodal provider compatibility keeps images in the primary request", () => {
  const messages = buildPrimaryMessages({
    history: [],
    prompt: "Inspect this image",
    images: [image],
    family: "opamp",
  });
  assert.match(JSON.stringify(messages), /data:image\/png;base64,AAECAwQ=/u);
});

test("primary prompt includes text design files as delimited untrusted data", () => {
  const messages = buildPrimaryMessages({
    history: [],
    prompt: "Review the uploaded OTA source",
    images: [],
    files: [{ name: "ota.py", mediaType: "text/x-python", sizeBytes: 42, text: "@cell\ndef ota(c):\n    pass" }],
    family: "opamp",
  });
  const encoded = JSON.stringify(messages);
  assert.match(encoded, /Attached file: ota\.py/u);
  assert.match(encoded, /untrusted design data/u);
  assert.match(encoded, /def ota/u);
});

test("primary prompt identifies binary files without fabricating their contents", () => {
  const messages = buildPrimaryMessages({
    history: [],
    prompt: "Summarize the uploaded report",
    images: [],
    files: [{ name: "signoff.pdf", mediaType: "application/pdf", sizeBytes: 128, text: "" }],
    family: "opamp",
  });
  const encoded = JSON.stringify(messages);
  assert.match(encoded, /signoff\.pdf/u);
  assert.match(encoded, /Binary file is stored/u);
});
