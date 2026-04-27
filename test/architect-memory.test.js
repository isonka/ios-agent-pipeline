import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  appendAgentFeedback,
  loadAgentMemory,
  formatAgentMemoryForPrompt,
} from "../project/agentMemory.js";

test("architect memory saves and loads feedback", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "architect-memory-"));
  process.env.AGENT_MEMORY_DIR = dir;
  process.env.AGENT_MEMORY_MAX_ENTRIES = "5";

  await appendAgentFeedback("architect", {
    issueKey: "MP-1",
    rating: "good",
    whatWorked: "Clear file-level subtasks",
    whatFailed: "",
    expectations: "Keep this style",
    notes: "Good baseline",
  });

  const loaded = await loadAgentMemory("architect");
  assert.equal(loaded.feedback.length, 1);
  assert.equal(loaded.feedback[0].issueKey, "MP-1");
  assert.equal(loaded.feedback[0].rating, "good");
});

test("architect memory trims to max entries", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "architect-memory-trim-"));
  process.env.AGENT_MEMORY_DIR = dir;
  process.env.AGENT_MEMORY_MAX_ENTRIES = "2";

  await appendAgentFeedback("architect", { issueKey: "MP-1", rating: "neutral" });
  await appendAgentFeedback("architect", { issueKey: "MP-2", rating: "neutral" });
  await appendAgentFeedback("architect", { issueKey: "MP-3", rating: "neutral" });

  const loaded = await loadAgentMemory("architect");
  assert.equal(loaded.feedback.length, 2);
  assert.equal(loaded.feedback[0].issueKey, "MP-2");
  assert.equal(loaded.feedback[1].issueKey, "MP-3");
});

test("formatArchitectMemoryForPrompt renders feedback entries", () => {
  const text = formatAgentMemoryForPrompt({
    feedback: [
      {
        issueKey: "MP-10",
        rating: "bad",
        whatWorked: "nothing",
        whatFailed: "Too vague",
        expectations: "Need strict acceptance criteria",
        notes: "Please include file paths",
      },
    ],
  });

  assert.match(text, /issueKey: MP-10/);
  assert.match(text, /whatFailed: Too vague/);
  assert.match(text, /expectations: Need strict acceptance criteria/);
});
