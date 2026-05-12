import test from "node:test";
import assert from "node:assert/strict";

import { runArchitect } from "../src/agents/architect.js";

test("runArchitect repairs non-JSON first response", async () => {
  let calls = 0;
  const llm = {
    async generateText() {
      calls += 1;
      if (calls === 1) {
        return "I think this should be split into tasks. (not valid json)";
      }
      return JSON.stringify({
        summary: "Use existing Discover package flow and split migration safely.",
        subtasks: [
          {
            title: "Refactor Discover Packages routing integration",
            body: "Switch routing to new navigator adapter with acceptance criteria.",
            storyPoints: 2,
            changedFiles: ["DiscoverPackagesView.swift"],
            suggestedSkill: null,
          },
          {
            title: "Plan migration increments",
            body: "Define scoped steps with acceptance criteria.",
            storyPoints: 1,
            changedFiles: ["DiscoverPackagesView.swift"],
            suggestedSkill: null,
          },
        ],
      });
    },
  };

  const result = await runArchitect({
    llm,
    issue: { key: "IOS-1", fields: { summary: "Migrate Discover Packages" } },
    implementationContext: {
      keywords: ["Discover Packages"],
      filesScanned: 1,
      matches: [{ path: "DiscoverPackagesView.swift", reason: "path match", snippet: "" }],
      skillDocs: [],
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.subtasks.length, 2);
});

test("runArchitect throws when subtasks are missing", async () => {
  const llm = {
    async generateText() {
      return JSON.stringify({ summary: "missing subtasks" });
    },
  };

  await assert.rejects(
    () =>
      runArchitect({
        llm,
        issue: { key: "IOS-2", fields: { summary: "Anything" } },
        implementationContext: { keywords: [], filesScanned: 0, matches: [], skillDocs: [] },
      }),
    /subtasks/
  );
});
