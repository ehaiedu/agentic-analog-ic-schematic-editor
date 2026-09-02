import assert from "node:assert/strict";
import test from "node:test";

import type { SubmitSpegJobRequest } from "../lib/spegClient";

test("Release-1 SPEG job contract carries only project, circuit, PDK, and metric inputs", () => {
  const request: SubmitSpegJobRequest = {
    projectId: "project_cmp",
    family: "comparator",
    promptText: "delay below 5 ns",
    netlistText: ".subckt comparator inp inn outp outn vdd vss clk\n.ends comparator\n",
    inputRevision: "3:ir_abc",
    pdkProfileId: "smic180_bcd",
    idempotencyKey: "cmp_ir_abc",
    targets: { tpd_avg_ns_max: 5, power_mw_max: 0.12 },
    parameters: { vdd: 1.8, temp_c: 27 },
    operation: "full_signoff",
  };
  const serialized = JSON.stringify(request);
  assert.equal(serialized.includes("/home/"), false);
  assert.equal(serialized.includes("api_key"), false);
  assert.equal(serialized.includes("pdk_include"), false);
  assert.equal(request.family, "comparator");
  assert.equal(request.operation, "full_signoff");
});
