import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PDK_PROFILE_ID,
  buildPdkRequestContract,
  cadenceReadyPdkEntries,
  pdkRegistrySummary,
  pdkStatusLabel,
  resolvePdkRegistryEntry,
  selectablePdkEntries,
} from "../lib/pdkRegistry";

test("PDK registry loads Cadence, remote, and SPEG profile entries without backend paths", () => {
  const summary = pdkRegistrySummary();
  const serialized = JSON.stringify(selectablePdkEntries());

  assert.ok(summary.total >= 10);
  assert.equal(summary.cadenceClosedLoop, 3);
  assert.ok(summary.remoteDetected >= 4);
  assert.doesNotMatch(serialized, /\/home\/|\/opt\/|C:\\|I:\\|192\.168\./);
  assert.doesNotMatch(serialized, /password|token|license/i);
});

test("default PDK is a Cadence-verified SMIC180 profile", () => {
  const entry = resolvePdkRegistryEntry(DEFAULT_PDK_PROFILE_ID);
  const contract = buildPdkRequestContract(entry);

  assert.equal(entry.id, "smic180_smic18mmrf");
  assert.equal(entry.selectable, true);
  assert.equal(pdkStatusLabel(entry), "Cadence通过");
  assert.equal(contract.cadence_profile, "smic180_smic18mmrf");
  assert.equal(contract.workflow_profile, "smic180_bcd_105_runtime");
  assert.equal(contract.pdk_paths_backend_only, true);
});

test("Cadence-ready profiles match the configured backend evidence matrix", () => {
  const ready = cadenceReadyPdkEntries().map((entry) => entry.id).sort();

  assert.deepEqual(ready, ["gpdk090", "smic180_smic18mmrf", "tsmc180_tsmc18rf"]);
});
