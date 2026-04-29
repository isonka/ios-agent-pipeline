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
    architectMemory: { projectOverview: "sample" },
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

test("runArchitect rewrites discovery subtasks into implementation subtasks", async () => {
  let calls = 0;
  const llm = {
    async generateText() {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          summary: "Initial output includes discovery.",
          subtasks: [
            {
              title: "Locate and document Discover Packages ownership",
              body: "Find where the feature lives before coding.",
            storyPoints: 1,
            changedFiles: ["DiscoverPackagesView.swift"],
            suggestedSkill: null,
            },
            {
              title: "Implement migration",
              body: "Move logic to target architecture.",
            storyPoints: 2,
            changedFiles: ["DiscoverPackagesView.swift"],
            suggestedSkill: null,
            },
          ],
        });
      }
      return JSON.stringify({
        summary: "Ownership analysis applied by architect; implementation-ready plan.",
        subtasks: [
          {
            title: "Extract Discover Packages orchestration into navigator adapter",
            body: "Move current flow wiring into adapter and preserve behavior with acceptance criteria.",
            storyPoints: 3,
            changedFiles: ["DiscoverPackagesView.swift"],
            suggestedSkill: "skills/swiftui-migration/SKILL.md",
          },
          {
            title: "Migrate Discover Packages entry points to adapter-backed flow",
            body: "Update callers and validate navigation behavior with explicit acceptance criteria.",
            storyPoints: 2,
            changedFiles: ["DiscoverPackagesView.swift"],
            suggestedSkill: null,
          },
          {
            title: "Add regression coverage for Discover Packages navigation",
            body: "Add tests covering previous and migrated paths with pass/fail criteria.",
            storyPoints: 2,
            changedFiles: ["DiscoverPackagesView.swift"],
            suggestedSkill: null,
          },
        ],
      });
    },
  };

  const result = await runArchitect({
    llm,
    issue: { key: "IOS-3", fields: { summary: "Migrate Discover Packages" } },
    architectMemory: { projectOverview: "sample" },
    implementationContext: {
      keywords: ["Discover Packages"],
      filesScanned: 3,
      matches: [{ path: "DiscoverPackagesView.swift", reason: "path match", snippet: "" }],
      skillDocs: ["skills/swiftui-migration/SKILL.md"],
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.subtasks.length, 3);
  assert.ok(
    result.subtasks.every(
      (item) =>
        !`${item.title} ${item.body}`.toLowerCase().includes("locate") &&
        !`${item.title} ${item.body}`.toLowerCase().includes("ownership")
    )
  );
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
        implementationContext: { keywords: [], filesScanned: 0, matches: [], skillDocs: [] },
      }),
    /subtasks/
  );
});
