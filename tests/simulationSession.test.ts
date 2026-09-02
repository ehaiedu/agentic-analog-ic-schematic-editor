import assert from "node:assert/strict";
import test from "node:test";

import { defaultSimulationSession, simulationOperation, simulationParameters, simulationSessionPrompt } from "../lib/simulationSession";

test("Comparator simulation workspace maps variables and nominal analysis to a prompt", () => {
  const config = defaultSimulationSession("comparator");
  assert.equal(config.analyses.find((item) => item.kind === "tran")?.executable, true);
  assert.equal(config.analyses.find((item) => item.kind === "pvt")?.executable, true);
  assert.equal(simulationParameters(config).vdd, 1.8);
  assert.match(simulationSessionPrompt(config), /tpd_avg_ns <= 5\.3ns/);
});

test("PVT and MC selections route to the existing full Spectre105 matrix", () => {
  const config = defaultSimulationSession("comparator");
  config.analyses = config.analyses.map((item) => item.kind === "pvt" || item.kind === "mc" ? { ...item, enabled: true } : item);
  assert.equal(simulationOperation(config), "full_signoff");
  assert.equal(simulationParameters(config).corner_preset, "full");
  assert.equal(simulationParameters(config).mc_samples, 100);
  assert.equal(simulationParameters(config).smic180_mismatch_ckt_models, true);
});

test("OTA simulation workspace exposes OP, AC, and transient outputs", () => {
  const config = defaultSimulationSession("opamp");
  assert.deepEqual(config.analyses.filter((item) => item.enabled).map((item) => item.kind), ["op", "ac", "tran"]);
  assert.ok(config.outputs.some((item) => item.id === "ugbw" && item.analysis === "ac"));
  assert.match(simulationSessionPrompt(config), /gain_db >= 38dB/);
});
