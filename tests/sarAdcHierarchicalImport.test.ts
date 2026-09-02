import assert from "node:assert/strict";
import test from "node:test";

import { hierarchyCellViews } from "../lib/hierarchy";
import { importSarAdcFlatNetlistAsHierarchy } from "../lib/sarAdcHierarchicalImport";
import { compileNetlist } from "../lib/netlist";

const SAMPLE_SAR = `
simulator lang=spectre
subckt sar_adc_dut (vip vin vdd vref vss clk start rst_n comp_p comp_n sp0 sn0 dout0 valid eoc cdac_p cdac_n)
  xctrl_timing (clk start rst_n vdd vss valid eoc cmp_eval phi_bit_0 phi_dec_0 phi_cap_0) sar_adc_timing_ctrl_1b
  ccdacp_bin_0 (cdac_p sp0) capacitor c=1p
  ccdacp_par (cdac_p vss) capacitor c=10f
  ccdacn_bin_0 (cdac_n sn0) capacitor c=1p
  ccdacn_par (cdac_n vss) capacitor c=10f
  rcdac_p (cdac_p vss) resistor r=1G
  rcdac_n (cdac_n vss) resistor r=1G
  rcmp_in_p_link (cmp_in_p cdac_p) resistor r=0.5
  rcmp_in_n_link (cmp_in_n cdac_n) resistor r=0.5
  mcmp_precharge_p (comp_p cmp_eval vdd vdd) p18 l=180n w=2u nf=1
  mcmp_tail_eval (cmp_tail cmp_eval vss vss) n18 l=180n w=2u nf=1
  mcmp_in_p (comp_p cmp_in_p cmp_tail vss) n18 l=180n w=1u nf=1
  mcmp_in_n (comp_n cmp_in_n cmp_tail vss) n18 l=180n w=1u nf=1
  mcmp_logic_p_p (cmp_logic_p comp_p vdd vdd) p18 l=180n w=2u nf=1
  mcmp_logic_n_n (cmp_logic_n comp_n vss vss) n18 l=180n w=1u nf=1
  rbp_mid_ref_top (vref bp_mid) resistor r=60k
  rbp_mid_ref_bot (bp_mid vss) resistor r=60k
  cbp_mid_ref_hold (bp_mid vss) capacitor c=20f
  mstart_bar_p (start_bar start vdd vdd) p18 l=180n w=1u nf=1
  mstart_bar_n (start_bar start vss vss) n18 l=180n w=1u nf=1
  msample_p_n (cdac_p start vip vss) n18 l=180n w=1u nf=1
  msample_n_n (cdac_n start vin vss) n18 l=180n w=1u nf=1
  mphi_bit_0_bar_p (phi_bit_0_bar phi_bit_0 vdd vdd) p18 l=180n w=1u nf=1
  mphi_cap_0_bar_n (phi_cap_0_bar phi_cap_0 vss vss) n18 l=180n w=1u nf=1
  cbit0_q (bit0_q vss) capacitor c=25f
  mbit0_q_cap_n (bit0_q phi_cap_0 cmp_logic_p vss) n18 l=180n w=1u nf=1
  mdout0_p (dout0 bit0_q vdd vdd) p18 l=180n w=1u nf=1
  msp0_trial_hi_n (sp0 phi_bit_0 bp_mid vss) n18 l=180n w=1u nf=1
  msn0_trial_lo_n (sn0 phi_bit_0_bar bp_mid vss) n18 l=180n w=1u nf=1
ends sar_adc_dut
`;

test("SAR ADC flat DUT imports as an editable hierarchy rather than a top-level device explosion", () => {
  const result = importSarAdcFlatNetlistAsHierarchy(SAMPLE_SAR, {
    project: "SAR ADC - test",
    cell: "sar_adc_dut",
    library: "AS_SAR_ADC_TEST",
    sourceRun: "unit_test_run",
  });
  const childViews = hierarchyCellViews(result.document);
  const childCells = Object.values(childViews);
  const topKinds = new Set(result.document.nodes.map((node) => node.kind));
  const topInstances = result.document.nodes.filter((node) => node.properties.hierarchyChildKey);
  const bitChild = childCells.find((child) => child.cell === "sar_bit0_slice");
  const cdacChild = childCells.find((child) => child.cell === "cdac_p_array");

  assert.equal(result.summary.sourceInstanceCount, 29);
  assert.equal(result.summary.moduleCount, 7);
  assert.equal(topKinds.has("nmos4"), false);
  assert.equal(topKinds.has("pmos4"), false);
  assert.equal(topKinds.has("capacitor"), false);
  assert.equal(topKinds.has("resistor"), false);
  assert.ok(topInstances.length >= 7);
  assert.ok(bitChild);
  assert.ok(bitChild.nodes.some((node) => node.kind === "nmos4" || node.kind === "pmos4"));
  assert.ok(bitChild.nodes.some((node) => node.kind === "capacitor"));
  assert.ok(cdacChild);
  assert.ok(cdacChild.nodes.some((node) => node.kind === "capacitor"));
  assert.doesNotMatch(JSON.stringify(result.document), /\/home\/|\/tmp\/|[A-Za-z]:[\\/]|token|secret|password|license/i);
});

test("SAR ADC hierarchy keeps named top-level connectivity for OA handoff", () => {
  const { document } = importSarAdcFlatNetlistAsHierarchy(SAMPLE_SAR, {
    project: "SAR ADC - test",
    cell: "sar_adc_dut",
    library: "AS_SAR_ADC_TEST",
    sourceRun: "unit_test_run",
  });
  const oaExchange = JSON.parse(compileNetlist(document, "oa_exchange").text) as {
    instances: Array<{ name: string; terminals: Array<{ net: string }> }>;
    nets: Array<{ name: string }>;
  };

  assert.ok(oaExchange.instances.some((instance) => instance.name === "XCDACP"));
  assert.ok(oaExchange.instances.some((instance) => instance.name === "XBIT0"));
  assert.ok(oaExchange.nets.some((net) => net.name === "cdac_p"));
  assert.ok(oaExchange.nets.some((net) => net.name === "dout0"));
});
