import assert from "node:assert/strict";
import test from "node:test";

import { createX6NodeMetadata } from "../components/x6Symbols";
import { createDeviceNode } from "../lib/schematic";

function portPosition(metadata: ReturnType<typeof createX6NodeMetadata>, id: string) {
  const ports = metadata.ports as { items?: Array<{ id: string; args?: unknown }> } | undefined;
  const item = ports?.items?.find((candidate) => candidate.id === id);
  assert.ok(item, `missing ${id} port`);
  return item.args as { x: number; y: number };
}

test("MOS symbol leads terminate at the exact X6 D/G/S/B port coordinates", () => {
  for (const kind of ["nmos4", "pmos4"] as const) {
    const node = createDeviceNode(kind, 200, 220);
    const metadata = createX6NodeMetadata(node);
    const attrs = metadata.attrs as Record<string, { d?: string; text?: string }>;
    const terminalX = node.width - 10;
    const centerY = node.height / 2;

    assert.deepEqual(portPosition(metadata, "G"), { x: 0, y: centerY });
    assert.match(attrs.mosGate.d ?? "", new RegExp(`M 0 ${centerY} L`));

    assert.deepEqual(portPosition(metadata, "B"), { x: terminalX, y: centerY });
    assert.match(attrs.mosBulk.d ?? "", new RegExp(`L ${terminalX} ${centerY}$`));

    const drainY = kind === "nmos4" ? 0 : node.height;
    const sourceY = kind === "nmos4" ? node.height : 0;
    assert.deepEqual(portPosition(metadata, "D"), { x: terminalX, y: drainY });
    assert.deepEqual(portPosition(metadata, "S"), { x: terminalX, y: sourceY });
    assert.match(attrs.mosDrain.d ?? "", new RegExp(`L ${terminalX} ${drainY}$`));
    assert.match(attrs.mosSource.d ?? "", new RegExp(`L ${terminalX} ${sourceY}$`));

    assert.equal(attrs.mosFingerLabel.text, "");
    assert.equal(attrs.mosMultiplierLabel.text, "");
    assert.match(attrs.mosWidthLabel.text ?? "", /^W\/L /);
  }
});
