import assert from "node:assert/strict";
import test from "node:test";

import type { PersistedAgentAttachment, PersistedAgentMessage } from "../lib/agentHistory";

test("persisted multimodal message contract keeps media private behind project API", () => {
  const attachment: PersistedAgentAttachment = {
    id: "media_1",
    direction: "input",
    name: "schematic.png",
    mediaType: "image/png",
    sizeBytes: 1024,
    width: 800,
    height: 600,
    sha256: "a".repeat(64),
    createdAt: 1,
    url: "/api/projects/project_1/agent/media/media_1",
  };
  const message: PersistedAgentMessage = {
    id: "message_1",
    sequence: 1,
    role: "user",
    kind: "user_message",
    status: "info",
    title: "",
    text: "分析截图中的比较器",
    createdAt: 1,
    attachments: [attachment],
  };
  assert.equal(message.attachments[0].url.startsWith("/api/projects/"), true);
  assert.equal(JSON.stringify(message).includes("object_key"), false);
  assert.equal(JSON.stringify(message).includes("/home/"), false);
});
