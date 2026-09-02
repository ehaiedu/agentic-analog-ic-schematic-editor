import assert from "node:assert/strict";
import test from "node:test";

import { inferReleaseFamily, release1Targets, requestsSpegExecution } from "../lib/release1Intent";

test("Comparator intent maps natural-language constraints to signoff flags", () => {
  const prompt = "clocked comparator average delay below 5.3 ns, rise delay 5.3 ns, fall delay 8 ns, swing above 1.6 V, power under 120 uW";
  assert.equal(inferReleaseFamily(prompt), "comparator");
  assert.deepEqual(release1Targets(prompt, "comparator"), {
    power_mw_max: 0.12,
    tpd_avg_ns_max: 5.3,
    tpd_rise_ns_max: 5.3,
    tpd_fall_ns_max: 8,
    output_swing_v_min: 1.6,
  });
});

test("OTA intent normalizes MHz, degrees, nanoseconds, and microwatts", () => {
  const prompt = "five-transistor OTA with at least 38 dB gain, 0.8 MHz UGBW, 60 degree phase margin, under 50 uW power, settling below 700 ns";
  assert.equal(inferReleaseFamily(prompt), "opamp");
  assert.deepEqual(release1Targets(prompt, "opamp"), {
    power_mw_max: 0.05,
    gain_db_min: 38,
    ugbw_hz_min: 800_000,
    pm_deg_min: 60,
    settling_time_ns_max: 700,
  });
});

test("ordinary project questions do not implicitly run EDA tools", () => {
  assert.equal(requestsSpegExecution("请分析当前 OTA 的结构"), false);
  assert.equal(requestsSpegExecution("请分析截图，不运行仿真"), false);
  assert.equal(requestsSpegExecution("请运行仿真并验证当前 OTA"), true);
  assert.equal(requestsSpegExecution("rerun the comparator after optimization"), true);
});
