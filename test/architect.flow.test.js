import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "path";

import { runArchitectForIssue } from "../src/services/pipeline/architectFlow.js";

async function makeTempRepo() {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "ios-agent-pipeline-"));
  await fs.mkdir(path.join(repoPath, ".git"), { recursive: true });
  return repoPath;
}

test("runArchitectForIssue creates plan from LLM using issue and evidence only", async () => {
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
    planComments: [],
    async addCommentParagraphs(issueKey, text) {
      this.planComments.push({ issueKey, text });
    },
  };

  const issue = {
    key: "IOS-200",
    fields: {
      summary: "Migrate Discover Packages to new navigation",
      description: "Do not assume standalone module. Validate where it lives first.",
    },
  };

  const result = await runArchitectForIssue({
    llm,
    jira,
    issue,
    targetRepoPath: repoPath,
  });

  assert.equal(result.planItems.length, 2);
  assert.equal(llmCalls, 1);
  assert.equal(result.planItems[0].storyPoints, 1);
  assert.deepEqual(result.planItems[0].changedFiles, ["DiscoverPackagesView.swift"]);
  assert.ok(result.implementationContext.matches.length > 0);
  assert.ok(result.implementationContext.skillDocs.includes("skills/swiftui-migration/SKILL.md"));

  assert.equal(jira.planComments.length, 1);
  assert.equal(jira.planComments[0].issueKey, "IOS-200");
  assert.match(jira.planComments[0].text, /Architect plan/);
  assert.match(jira.planComments[0].text, /Story points: 1/);
});

test("runArchitectForIssue uses LLM for migration-style summary (no deterministic branch)", async () => {
  const repoPath = await makeTempRepo();
  await fs.writeFile(path.join(repoPath, "README.md"), "# App\n", "utf8");
  await fs.mkdir(path.join(repoPath, "Feature", "Views"), { recursive: true });
  await fs.writeFile(
    path.join(repoPath, "Feature", "Views", "LegacyScreen.swift"),
    "import UIKit\nfinal class LegacyScreen: UIViewController {}\n",
    "utf8"
  );

  let llmCalls = 0;
  const llm = {
    async generateText() {
      llmCalls += 1;
      return JSON.stringify({
        summary: "Migrate LegacyScreen UIKit to SwiftUI per structured story.",
        subtasks: [
          {
            title: "Introduce SwiftUI host",
            body: "Wrap or replace entry with SwiftUI.",
            storyPoints: 2,
            changedFiles: ["Feature/Views/LegacyScreen.swift"],
            suggestedSkill: null,
          },
          {
            title: "Remove dead UIKit paths",
            body: "Delete obsolete code after parity.",
            storyPoints: 1,
            changedFiles: ["Feature/Views/LegacyScreen.swift"],
            suggestedSkill: null,
          },
        ],
      });
    },
  };

  const jira = {
    planComments: [],
    async addCommentParagraphs(issueKey, text) {
      this.planComments.push({ issueKey, text });
    },
  };

  const issue = {
    key: "IOS-300",
    fields: {
      summary: "Discover Packages - Migrate UIKit to SwiftUI",
      description: "Agent folder: Feature/Views\nScope per claude.md.",
    },
  };

  const result = await runArchitectForIssue({
    llm,
    jira,
    issue,
    targetRepoPath: repoPath,
  });

  assert.equal(llmCalls, 1);
  assert.equal(result.planItems.length, 2);
  assert.equal(jira.planComments.length, 1);
});
