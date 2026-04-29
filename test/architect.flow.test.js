import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "path";

import { loadArchitectMemory, saveArchitectMemory } from "../src/services/architectMemory.js";
import {
  createArchitectSubtasks,
  ensureArchitectMemory,
} from "../src/services/pipeline/architectFlow.js";

async function makeTempRepo() {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "ios-agent-pipeline-"));
  await fs.mkdir(path.join(repoPath, ".git"), { recursive: true });
  return repoPath;
}

test("ensureArchitectMemory generates once and then reuses saved memory", async () => {
  const repoPath = await makeTempRepo();
  await fs.writeFile(path.join(repoPath, "README.md"), "# App\n", "utf8");

  const llm = {
    calls: 0,
    async generateText() {
      this.calls += 1;
      return JSON.stringify({
        projectOverview: "Overview",
        architecture: "Architecture",
        iosConventions: ["Swift"],
        keyComponents: [{ name: "Discover", responsibility: "Offers" }],
        deliveryGuidance: "Guidance",
        knownRisks: ["Risk"],
      });
    },
  };

  const first = await ensureArchitectMemory({
    llm,
    targetRepoPath: repoPath,
  });

  assert.equal(first.architectMemoryGenerated, true);
  assert.equal(llm.calls, 1);
  assert.equal(first.architectMemoryPath, ".ios-agent/architect-context.json");

  const second = await ensureArchitectMemory({
    llm: {
      async generateText() {
        throw new Error("LLM should not be called when memory exists");
      },
    },
    targetRepoPath: repoPath,
  });

  assert.equal(second.architectMemoryGenerated, false);
  assert.equal(second.architectMemory.projectOverview, "Overview");
});

test("createArchitectSubtasks updates memory with new implementation signals", async () => {
  const repoPath = await makeTempRepo();
  await fs.writeFile(path.join(repoPath, "README.md"), "# App\n", "utf8");
  await fs.writeFile(
    path.join(repoPath, "DiscoverPackagesView.swift"),
    "import SwiftUI\nstruct DiscoverPackagesView { let title = \"Discover Packages\" }\n",
    "utf8"
  );
  await fs.mkdir(path.join(repoPath, "skills", "swiftui-migration"), { recursive: true });
  await fs.writeFile(
    path.join(repoPath, "skills", "swiftui-migration", "SKILL.md"),
    "# SwiftUI migration skill\n",
    "utf8"
  );

  await saveArchitectMemory(repoPath, {
    generatedAt: new Date().toISOString(),
    sourceDocuments: ["README.md"],
    content: {
      projectOverview: "Overview",
      architecture: "Architecture",
      iosConventions: ["Swift"],
      keyComponents: [{ name: "Discover", responsibility: "Offers" }],
      deliveryGuidance: "Guidance",
      knownRisks: [],
    },
  });

  let llmCalls = 0;
  const llm = {
    async generateText() {
      llmCalls += 1;
      if (llmCalls === 1) {
        return JSON.stringify({
          summary: "Subtasks based on real implementation evidence.",
          subtasks: [
            {
              title: "Validate Discover Packages ownership",
              body: "Find true ownership and keep scope minimal.",
              storyPoints: 1,
              changedFiles: ["DiscoverPackagesView.swift"],
              suggestedSkill: null,
            },
            {
              title: "Implement scoped migration",
              body: "Ship in verifiable increments.",
              storyPoints: 2,
              changedFiles: ["DiscoverPackagesView.swift"],
              suggestedSkill: null,
            },
          ],
        });
      }
      return JSON.stringify({
        summary: "Subtasks based on completed architect discovery.",
        subtasks: [
          {
            title: "Migrate Discover Packages navigation wiring",
            body: "Move flow entry points to target navigator adapter with acceptance criteria.",
            storyPoints: 3,
            changedFiles: ["DiscoverPackagesView.swift"],
            suggestedSkill: "skills/swiftui-migration/SKILL.md",
          },
          {
            title: "Add regression coverage for Discover Packages flow",
            body: "Add tests for migrated flow and keep parity with previous behavior.",
            storyPoints: 2,
            changedFiles: ["DiscoverPackagesView.swift"],
            suggestedSkill: null,
          },
        ],
      });
    },
  };

  const jira = {
    created: [],
    transitioned: [],
    async createSubtask(parentKey, title, body) {
      const key = `${parentKey}-${this.created.length + 1}`;
      this.created.push({ key, title, body });
      return { key };
    },
    async transitionIssueToStatus(issueKey, status) {
      this.transitioned.push({ issueKey, status });
    },
  };

  const issue = {
    key: "IOS-200",
    fields: {
      summary: "Migrate Discover Packages to new navigation",
      description: "Do not assume standalone module. Validate where it lives first.",
    },
  };

  const result = await createArchitectSubtasks({
    llm,
    jira,
    issue,
    targetRepoPath: repoPath,
    architectMemory: {
      projectOverview: "Overview",
      architecture: "Architecture",
      iosConventions: ["Swift"],
      keyComponents: [{ name: "Discover", responsibility: "Offers" }],
      deliveryGuidance: "Guidance",
      knownRisks: [],
    },
    architectMemoryPath: ".ios-agent/architect-context.json",
    jiraSubtaskTargetStatus: "In Progress",
  });

  assert.equal(result.createdSubtasks.length, 2);
  assert.equal(llmCalls, 2);
  assert.equal(jira.transitioned.length, 2);
  assert.equal(result.createdSubtasks[0].storyPoints, 3);
  assert.deepEqual(result.createdSubtasks[0].changedFiles, ["DiscoverPackagesView.swift"]);
  assert.equal(result.architectMemoryUpdated, true);
  assert.ok(result.architectMemoryAddedSignals > 0);
  assert.ok(result.implementationContext.matches.length > 0);
  assert.ok(result.implementationContext.skillDocs.includes("skills/swiftui-migration/SKILL.md"));

  const updatedMemory = await loadArchitectMemory(repoPath);
  assert.ok(Array.isArray(updatedMemory.content.implementationSignals));
  assert.ok(updatedMemory.content.implementationSignals.length > 0);
  assert.match(jira.created[0].body, /Story points: 3/);
  assert.match(jira.created[0].body, /Changed files:/);
});
