import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPvtMetricMatrix,
  defaultOptimizationMetricsForFlavor,
  inferMetricFlavor,
  metricProfileForFlavor,
  optimizationMetricsFromDocument,
  parsePerRoundMetrics,
  summarizeOptimizationMetrics,
  waveformPanelsForRound,
  waveformTracesForRound,
  withOptimizationMetricsExtension,
} from "../lib/optimizationMetrics";

test("per-round metrics parser normalizes common SPEG fields", () => {
  const metrics = parsePerRoundMetrics({
    per_round_metrics: [
      { round: 0, candidate_id: "seed", enob: "7.5", sndr_db: 48, sfdr_db: 55, power_mw: 1.4, spec_passed: false },
      { round_id: 1, candidate: "repair1", enob_bits: 8.2, sndr: "52.5 dB", SFDR: 61, power_uw: 1510, status: "pass" },
    ],
  });

  assert.equal(metrics.length, 2);
  assert.equal(metrics[0].powerUw, 1400);
  assert.equal(metrics[1].sndrDb, 52.5);
  assert.equal(metrics[1].specPassed, true);
});

test("per-round metrics parser accepts a single SPEG metrics object", () => {
  const [metric] = parsePerRoundMetrics({
    sndr_db: 3.946,
    sfdr_db: 7.112,
    enob_bits: 0.363,
    power_uw: 654.244,
  });

  assert.equal(metric.round, 0);
  assert.equal(metric.sndrDb, 3.946);
  assert.equal(metric.sfdrDb, 7.112);
  assert.equal(metric.enob, 0.363);
  assert.equal(metric.powerUw, 654.244);
});

test("SAR ADC failed FFT rounds preserve closed-loop diagnostics", () => {
  const [metric] = parsePerRoundMetrics({
    valid_edge_count: 1088,
    unique_code_count: 1,
    code_transition_count: 0,
    missing_code_count: 1023,
    dnl_lsb_p2p: 1024,
    inl_lsb_p2p: 1023,
    dout_activity_observed: false,
    comparator_activity_observed: true,
    phase_activity_observed: true,
    transistor_closed_loop_passed: false,
    negative_control_passed: false,
    claim_level: "transistor_loop_structure_observed_but_not_causality_proven",
    failure: "output code is static despite sufficient valid edges",
  });
  const summary = summarizeOptimizationMetrics([metric], "sar_adc");

  assert.equal(metric.validEdgeCount, 1088);
  assert.equal(metric.codeTransitionCount, 0);
  assert.equal(metric.missingCodeCount, 1023);
  assert.equal(metric.doutActivityObserved, false);
  assert.equal(metric.comparatorActivityObserved, true);
  assert.equal(metric.loopClaimLevel, "transistor_loop_structure_observed_but_not_causality_proven");
  assert.match(summary.improvementText, /valid 1088/);
  assert.match(summary.rows[0].tradeoff, /output code is static/);
  assert.deepEqual(waveformPanelsForRound(metric, [metric], "sar_adc"), []);
  assert.deepEqual(waveformTracesForRound(metric, [metric], "sar_adc"), []);
});

test("optimization metrics extension persists artifact-backed traces", () => {
  const metrics = parsePerRoundMetrics([
    {
      round: 2,
      candidate_id: "backend-round-02",
      enob_bits: 9.18,
      sndr_db: 57.1,
      sfdr_db: 67.6,
      power_uw: 1492,
      spec_passed: true,
      waveforms: [
        { name: "vip", renderStyle: "line", points: [[0, 0.9], [1, 1.0], [2, 0.8]] },
        { name: "clk", renderStyle: "step", points: [[0, 0], [1, 1.8], [2, 0]] },
      ],
    },
  ]);
  const document = withOptimizationMetricsExtension(
    { extensions: { existing: true } },
    metrics,
    { sourceLabel: "configured_speg_backend", importedAt: "2026-08-23T00:00:00.000Z" },
  );
  const restored = optimizationMetricsFromDocument(document);

  assert.equal(document.extensions?.existing, true);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].candidateId, "backend-round-02");
  assert.equal(restored[0].sndrDb, 57.1);
  assert.equal(restored[0].sfdrDb, 67.6);
  assert.equal(restored[0].powerUw, 1492);
  assert.equal(restored[0].specPassed, true);
  assert.equal(restored[0].waveforms[1].renderStyle, "step");
});

test("metric summary reports improvements and trade-offs", () => {
  const metrics = parsePerRoundMetrics([
    { round: 0, enob: 7, sndr_db: 44, sfdr_db: 52, power_uw: 1000, spec_passed: false },
    { round: 1, enob: 8, sndr_db: 50, sfdr_db: 56, power_uw: 1180, spec_passed: false },
    { round: 2, enob: 8.6, sndr_db: 53, sfdr_db: 64, power_uw: 1120, spec_passed: true },
  ]);
  const summary = summarizeOptimizationMetrics(metrics);

  assert.equal(summary.best.enob?.round, 2);
  assert.equal(summary.best.powerUw?.round, 2);
  assert.equal(summary.rows[1].deltaFromInitial.sndrDb, 6);
  assert.match(summary.rows[1].tradeoff, /功耗上升/);
  assert.match(summary.improvementText, /SNDR \+9\.00 dB/);
});

test("waveform parser keeps real traces and fallback creates equivalent preview", () => {
  const [metric] = parsePerRoundMetrics([
    {
      round: 3,
      waveforms: [
        { name: "VOUT", points: [[0, 0], [1, 1.2], [2, 0.2]] },
      ],
    },
  ]);
  assert.equal(waveformTracesForRound(metric, [metric])[0].name, "VOUT");
  const importedPanels = waveformPanelsForRound(metric, [metric]);
  assert.equal(importedPanels[0].kind, "imported");
  assert.equal(importedPanels.some((panel) => panel.kind === "sar_transient"), false);

  const artifactBacked = waveformPanelsForRound({
    ...metric,
    waveformImageUrl: "/cadence/viva_round_3.png",
  }, [metric]);
  assert.equal(artifactBacked[0].id, "imported_psf");
  assert.equal(artifactBacked[1].id, "cadence_viva");
  assert.equal(artifactBacked[1].traces.length, 0);

  const fallback = waveformTracesForRound({ ...metric, waveforms: [], sndrDb: 55, enob: 8.5 }, [metric]);
  assert.deepEqual(fallback.map((trace) => trace.name), [
    "/VINP",
    "/VINN",
    "/SAMPLE",
    "/SAR_CLK",
    "/VTOPP",
    "/VTOPN",
    "/OUTP",
    "/OUTN",
  ]);
  assert.ok(fallback.every((trace) => trace.points.length > 500));

  const artifactOnly = waveformPanelsForRound(
    { ...metric, waveforms: [], suppressGeneratedWaveforms: true },
    [metric],
  );
  assert.deepEqual(artifactOnly, []);
});

test("artifact-backed SAR waveforms do not mix metric-derived preview panels", () => {
  const [metric] = parsePerRoundMetrics([
    {
      round: 0,
      enob: 7.82,
      sndr_db: 48.84,
      sfdr_db: 65.95,
      power_uw: 208.8,
      waveform_status: "available",
      waveforms: [
        { name: "/vip", points: [[0, 0.6], [1, 0.7], [2, 0.8]] },
        { name: "/dout9", renderStyle: "step", points: [[0, 0], [1, 1.2], [2, 1.2]] },
      ],
    },
  ]);

  const panels = waveformPanelsForRound(metric, [metric], "sar_adc");
  assert.deepEqual(panels.map((panel) => panel.id), ["imported_psf"]);
  assert.equal(waveformTracesForRound(metric, [metric], "sar_adc").length, 2);
});

test("waveform panels cover circuit-specific SAR ADC metrics", () => {
  const metrics = parsePerRoundMetrics([
    { round: 0, enob: 7.4, sndr_db: 46.5, sfdr_db: 55.1, power_uw: 1380 },
    { round: 1, enob: 8.2, sndr_db: 52.0, sfdr_db: 61.0, power_uw: 1510 },
  ]);
  const panels = waveformPanelsForRound(metrics[1], metrics);
  const kinds = panels.map((panel) => panel.kind);

  assert.ok(kinds.includes("sar_transient"));
  assert.ok(kinds.includes("fft_sndr_sfdr"));
  assert.ok(kinds.includes("linearity"));
  assert.ok(kinds.includes("power_tradeoff"));
  assert.ok(kinds.includes("comparator_regen"));
  assert.ok(kinds.includes("cdac_settling"));
  assert.ok(panels.every((panel) => panel.traces.length >= 1));
});

test("metric profiles keep comparator and OTA vocabularies separate from ADC", () => {
  const comparator = defaultOptimizationMetricsForFlavor("comparator");
  const ota = defaultOptimizationMetricsForFlavor("ota");
  const comparatorSummary = summarizeOptimizationMetrics(comparator, "comparator");
  const otaSummary = summarizeOptimizationMetrics(ota, "ota");
  const comparatorPanels = waveformPanelsForRound(comparatorSummary.latest, comparator, "comparator");
  const otaPanels = waveformPanelsForRound(otaSummary.latest, ota, "ota");

  assert.deepEqual(metricProfileForFlavor("comparator").columns.map((column) => column.key), [
    "delayPs",
    "offsetMv",
    "outputSwingV",
    "powerUw",
  ]);
  assert.deepEqual(metricProfileForFlavor("ota").columns.map((column) => column.key), [
    "gainDb",
    "ugbwMhz",
    "phaseMarginDeg",
    "settlingNs",
    "powerUw",
  ]);
  assert.ok(comparatorSummary.best.delayPs?.delayPs);
  assert.ok(otaSummary.best.gainDb?.gainDb);
  assert.ok(comparatorPanels.some((panel) => panel.kind === "comparator_delay_sweep"));
  assert.ok(otaPanels.some((panel) => panel.kind === "ota_ac_bode"));
  assert.equal(comparatorPanels.some((panel) => panel.kind === "fft_sndr_sfdr"), false);
  assert.equal(otaPanels.some((panel) => panel.kind === "fft_sndr_sfdr"), false);
});

test("per-round metrics parser normalizes comparator and OTA fields", () => {
  const metrics = parsePerRoundMetrics([
    { round: 0, tpd_avg_ns: 0.12, offset_mv: "5.5mV", output_swing_v: 1.7, power_mw: 0.44 },
    { round: 1, gain_db: "66 dB", ugbw_hz: 18_000_000, phase_margin_deg: 63, settling_ns: 45, slew_rate_v_us: 17.2 },
  ]);

  assert.equal(metrics[0].delayPs, 120);
  assert.equal(metrics[0].offsetMv, 5.5);
  assert.equal(metrics[0].powerUw, 440);
  assert.equal(metrics[1].gainDb, 66);
  assert.equal(metrics[1].ugbwMhz, 18);
  assert.equal(metrics[1].phaseMarginDeg, 63);
  assert.equal(metrics[1].settlingNs, 45);
  assert.equal(metrics[1].slewVus, 17.2);
});

test("per-round metrics parser treats valid Spectre metric files as passed", () => {
  const [metric] = parsePerRoundMetrics({
    tpd_fall_ns: 1.7982,
    output_swing_v: 1.8002,
    power_mw: 0.0695,
    valid: true,
    metric_source: "spectre_log_measure",
  });

  assert.equal(metric.specPassed, true);
  assert.equal(metric.delayPs, 1798.2);
  assert.ok(Math.abs((metric.powerUw ?? 0) - 69.5) < 1e-9);
});

test("per-round metrics parser flattens SPEG nested comparator round summaries", () => {
  const metrics = parsePerRoundMetrics({
    family: "comparator",
    round_00: {
      metrics: {
        tpd_avg_ns: 1.3574,
        output_swing_v: 1.8031357,
        power_mw: 1.3718862,
      },
      metric_source_file: "comparator/round_00/metrics.json",
      assessment: {
        full_metric_targets_passed: false,
        blockers: ["power_mw exceeds target or is missing"],
      },
      spectre: {
        waveform_export: {
          manifest: "comparator/round_00/waveform_manifest.json",
          csv: "comparator/round_00/waveforms_downsampled.csv",
          source: "spectre_nutascii_comparator_nominal",
        },
      },
    },
    round_01: {
      metrics: {
        tpd_avg_ns: 1.0945,
        output_swing_v: 1.80194955,
        power_mw: 1.3582476,
      },
      assessment: { full_metric_targets_passed: true },
    },
  });
  const panels = waveformPanelsForRound(metrics[1], metrics, "comparator");

  assert.equal(metrics.length, 2);
  assert.equal(metrics[0].round, 0);
  assert.ok(Math.abs((metrics[0].delayPs ?? 0) - 1357.4) < 1e-9);
  assert.ok(Math.abs((metrics[0].powerUw ?? 0) - 1371.8862) < 1e-9);
  assert.equal(metrics[0].waveformCsvPath, "comparator/round_00/waveforms_downsampled.csv");
  assert.equal(metrics[0].waveformArtifactStatus, "available");
  assert.equal(metrics[0].metricSourceFile, "comparator/round_00/metrics.json");
  assert.equal(metrics[1].specPassed, true);
  assert.ok(panels.some((panel) => panel.kind === "comparator_regen"));
  assert.ok(panels.every((panel) => panel.traces.length >= 1));
});

test("per-round metrics parser accepts SPEG PVT corner summaries", () => {
  const metrics = parsePerRoundMetrics({
    corners: [
      {
        corner_id: "tt_27c_vddx1",
        process: "tt",
        temperature_c: 27,
        vdd_scale: 1,
        stage_name: "pvt",
        stage_passed: true,
        metrics: {
          gain_db: 79.6731,
          ugbw_hz: 44_428_500,
          pm_deg: 60.085,
          settling_time_ns: 5.842,
          power_mw: 1.0170684,
          metric_source: "spectre_log_measure",
        },
        assessment: {
          signoff_level: "nominal_spectre105",
          full_metric_targets_passed: true,
        },
      },
    ],
  });

  assert.equal(metrics.length, 1);
  assert.equal(metrics[0].candidateId, "tt_27c_vddx1");
  assert.equal(metrics[0].cornerId, "tt_27c_vddx1");
  assert.equal(metrics[0].process, "tt");
  assert.equal(metrics[0].temperatureC, 27);
  assert.equal(metrics[0].vddScale, 1);
  assert.equal(metrics[0].status, "pvt");
  assert.equal(metrics[0].signoffLevel, "nominal_spectre105");
  assert.equal(metrics[0].specPassed, true);
  assert.equal(metrics[0].gainDb, 79.6731);
  assert.equal(metrics[0].ugbwMhz, 44.4285);
  assert.equal(metrics[0].settlingNs, 5.842);
  assert.ok(metrics[0].notes.some((note) => note.includes("Corner: tt_27c_vddx1")));
});

test("PVT matrix summary groups corner rows and identifies worst metrics", () => {
  const metrics = parsePerRoundMetrics({
    corners: [
      {
        corner_id: "tt_27c_vddx1",
        process: "tt",
        temperature_c: 27,
        vdd_scale: 1,
        stage_name: "full_pvt_condition",
        stage_passed: true,
        metrics: { gain_db: 79.6, ugbw_hz: 44_000_000, pm_deg: 60.1, settling_time_ns: 5.8, power_mw: 1.01 },
      },
      {
        corner_id: "ss_125c_vddx0p9",
        process: "ss",
        temperature_c: 125,
        vdd_scale: 0.9,
        stage_name: "full_pvt_condition",
        stage_passed: true,
        metrics: { gain_db: 78.2, ugbw_hz: 36_000_000, pm_deg: 58.8, settling_time_ns: 6.6, power_mw: 1.19 },
      },
    ],
  });
  const matrix = buildPvtMetricMatrix(metrics, "ota");

  assert.equal(matrix.mode, "pvt");
  assert.equal(matrix.totalCount, 2);
  assert.equal(matrix.passCount, 2);
  assert.deepEqual(matrix.processes, ["tt", "ss"]);
  assert.deepEqual(matrix.temperatures, [27, 125]);
  assert.deepEqual(matrix.vddScales, [0.9, 1]);
  assert.equal(matrix.columns.map((column) => column.key).includes("gainDb"), true);
  assert.equal(matrix.worst.find((item) => item.column.key === "gainDb")?.row.label, "ss_125c_vddx0p9");
  assert.equal(matrix.worst.find((item) => item.column.key === "powerUw")?.row.label, "ss_125c_vddx0p9");
});

test("PVT matrix summary marks non-PVT SAR runs as nominal-only evidence", () => {
  const metrics = parsePerRoundMetrics({
    per_round_metrics: [
      {
        round: 0,
        candidate_id: "sar_transient_nominal",
        valid_edge_count: 1088,
        code_transition_count: 0,
        spec_passed: false,
        failure_signature: "output_code_static",
      },
    ],
  });
  const matrix = buildPvtMetricMatrix(metrics, "sar_adc");

  assert.equal(matrix.mode, "nominal");
  assert.equal(matrix.totalCount, 1);
  assert.equal(matrix.passCount, 0);
  assert.match(matrix.subtitle, /PVT corner artifact pending/);
});

test("per-round metrics parser flattens extended comparator bench rows", () => {
  const metrics = parsePerRoundMetrics({
    benches: [
      {
        bench: "input_offset_monte_carlo",
        passed: true,
        details: {
          rows: [
            {
              sample_index: 0,
              passed: true,
              offset_bound_mv: 20,
              metrics: {
                tpd_avg_ns: 1.206,
                output_swing_v: 1.666,
                power_mw: 0.0412,
              },
            },
          ],
        },
      },
    ],
  });

  assert.equal(metrics.length, 1);
  assert.equal(metrics[0].candidateId, "input_offset_monte_carlo_00");
  assert.equal(metrics[0].status, "input_offset_monte_carlo");
  assert.equal(metrics[0].offsetMv, 20);
  assert.equal(metrics[0].delayPs, 1206);
  assert.equal(metrics[0].powerUw, 41.2);
  assert.equal(metrics[0].specPassed, true);
});

test("metric flavor inference follows project family metadata", () => {
  assert.equal(inferMetricFlavor({ circuitFamily: "Comparator", topology: "strongarm" }), "comparator");
  assert.equal(inferMetricFlavor({ circuitFamily: "OTA", topology: "5t" }), "ota");
  assert.equal(inferMetricFlavor({ circuitFamily: "SAR_ADC" }), "sar_adc");
  assert.equal(inferMetricFlavor({ properties: { metricFlavor: "ota" }, cell: "ota" }), "ota");
  assert.equal(inferMetricFlavor({ properties: { circuitFamily: "Comparator" }, cell: "comparator" }), "comparator");
});

test("metric flavor inference accepts underscore-separated cell names", () => {
  assert.equal(inferMetricFlavor({ cell: "opamp_dut" }), "ota");
  assert.equal(inferMetricFlavor({ project: "legacy inverter project", cell: "opamp_dut" }), "ota");
  assert.equal(inferMetricFlavor({ cell: "strongarm_comparator_top" }), "comparator");
});
