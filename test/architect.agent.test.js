import test from "node:test";
import assert from "node:assert/strict";

import { generateArchitectMemory, runArchitect } from "../src/agents/architect.js";

test("generateArchitectMemory parses fenced JSON response", async () => {
  const llm = {
    async generateText() {
      return [
        "```json",
        "{",
        '  "projectOverview": "iOS commerce app",',
        '  "architecture": "MVVM + coordinators",',
        '  "iosConventions": ["SwiftLint"],',
        '  "keyComponents": [{ "name": "Discover", "responsibility": "surfacing offers" }],',
        '  "deliveryGuidance": "split by feature boundaries",',
        '  "knownRisks": ["legacy flows"]',
        "}",
        "```",
      ].join("\n");
    },
  };

  const result = await generateArchitectMemory({
    llm,
    context: { docs: [{ path: "README.md", content: "sample" }] },
  });

  assert.equal(result.projectOverview, "iOS commerce app");
  assert.equal(result.keyComponents[0].name, "Discover");
});

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
            title: "Verify Discover Packages implementation ownership",
            body: "Locate where feature lives in current navigator and implementation.",
          },
          {
            title: "Plan migration increments",
            body: "Define scoped steps with acceptance criteria.",
          },
        ],
      });
    },
  };

  const result = await runArchitect({
    llm,
    issue: { key: "IOS-1", fields: { summary: "Migrate Discover Packages" } },
    architectMemory: { projectOverview: "sample" },
    implementationContext: { keywords: ["Discover Packages"], filesScanned: 1, matches: [] },
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
        architectMemory: { projectOverview: "sample" },
        implementationContext: { keywords: [], filesScanned: 0, matches: [] },
      }),
    /subtasks/
  );
});
