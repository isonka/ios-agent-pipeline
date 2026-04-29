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
  assert.equal(llmCalls, 1);
  assert.equal(jira.transitioned.length, 2);
  assert.equal(result.createdSubtasks[0].storyPoints, 1);
  assert.deepEqual(result.createdSubtasks[0].changedFiles, ["DiscoverPackagesView.swift"]);
  assert.equal(result.architectMemoryUpdated, true);
  assert.ok(result.architectMemoryAddedSignals > 0);
  assert.ok(result.implementationContext.matches.length > 0);
  assert.ok(result.implementationContext.skillDocs.includes("skills/swiftui-migration/SKILL.md"));

  const updatedMemory = await loadArchitectMemory(repoPath);
  assert.ok(Array.isArray(updatedMemory.content.implementationSignals));
  assert.ok(updatedMemory.content.implementationSignals.length > 0);
  assert.match(jira.created[0].body, /Story points: 1/);
  assert.match(jira.created[0].body, /Changed files:/);
});

test("createArchitectSubtasks uses deterministic planning for UIKit to SwiftUI story", async () => {
  const repoPath = await makeTempRepo();
  await fs.writeFile(path.join(repoPath, "README.md"), "# App\n", "utf8");
  await fs.mkdir(path.join(repoPath, "TargetShared", "Sources", "TargetShared", "VIP", "View"), {
    recursive: true,
  });
  await fs.mkdir(
    path.join(repoPath, "TargetShared", "Sources", "TargetShared", "VIP", "Main Vip", "ViewState"),
    { recursive: true }
  );
  await fs.mkdir(path.join(repoPath, "Modules", "VIP", "Sources", "VIP", "View", "DeliveryPackages"), {
    recursive: true,
  });
  await fs.mkdir(path.join(repoPath, ".claude", "skills", "uikit-to-swiftui"), { recursive: true });

  await fs.writeFile(
    path.join(repoPath, "TargetShared", "Sources", "TargetShared", "VIP", "View", "VipViewController.swift"),
    "import UIKit\nfinal class VipViewController: UIViewController {}\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(
      repoPath,
      "TargetShared",
      "Sources",
      "TargetShared",
      "VIP",
      "Main Vip",
      "ViewState",
      "VipViewState+Converter.swift"
    ),
    "import Foundation\nstruct VipViewStateConverter {}\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(repoPath, "Modules", "VIP", "Sources", "VIP", "View", "DeliveryPackages", "DeliveryPackagesView.swift"),
    "import SwiftUI\nstruct DeliveryPackagesView: View { var body: some View { Text(\"x\") } }\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(repoPath, ".claude", "skills", "uikit-to-swiftui", "SKILL.md"),
    "# skill\n",
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

  const llm = {
    async generateText() {
      throw new Error("LLM should not be called for deterministic UIKit->SwiftUI planning");
    },
  };

  const jira = {
    created: [],
    async createSubtask(parentKey, title, body) {
      const key = `${parentKey}-${this.created.length + 1}`;
      this.created.push({ key, title, body });
      return { key };
    },
    async transitionIssueToStatus() {},
  };

  const issue = {
    key: "IOS-300",
    fields: { summary: "Discover Packages - Migrate UIKit to SwiftUI", description: "" },
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
    jiraSubtaskTargetStatus: "",
  });

  assert.ok(result.summary.includes("UIKit->SwiftUI"));
  assert.ok(result.createdSubtasks.length >= 3);
  assert.equal(result.createdSubtasks[0].storyPoints <= 3, true);
  assert.ok(Array.isArray(result.createdSubtasks[0].changedFiles));
  assert.ok(result.createdSubtasks[0].changedFiles.length > 0);
  assert.ok(result.moduleResolution);
  assert.ok(["high", "medium"].includes(result.moduleResolution.confidence));
  assert.equal(
    result.createdSubtasks.some((item) => item.suggestedSkill?.includes("uikit-to-swiftui")),
    true
  );
});

test("deterministic planner respects TargetShared module hint from Jira description", async () => {
  const repoPath = await makeTempRepo();
  await fs.writeFile(path.join(repoPath, "README.md"), "# App\n", "utf8");

  await fs.mkdir(path.join(repoPath, "TargetShared", "Sources", "TargetShared", "SMB", "Features"), {
    recursive: true,
  });
  await fs.mkdir(path.join(repoPath, "TargetShared", "Tests", "TargetSharedTests", "ASQ"), {
    recursive: true,
  });
  await fs.mkdir(path.join(repoPath, "MarktplaatsCore", "Sources", "MarktplaatsCore"), {
    recursive: true,
  });
  await fs.mkdir(path.join(repoPath, ".claude", "skills", "uikit-to-swiftui"), { recursive: true });

  await fs.writeFile(
    path.join(repoPath, "TargetShared", "Sources", "TargetShared", "SMB", "Features", "SmbBundlesViewController.swift"),
    "import UIKit\nfinal class SmbBundlesViewController: UIViewController {}\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(repoPath, "TargetShared", "Sources", "TargetShared", "SMB", "Features", "SmbBundlesViewStateConverter.swift"),
    "import Foundation\nstruct SmbBundlesViewStateConverter {}\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(repoPath, "TargetShared", "Sources", "TargetShared", "SMB", "Features", "SmbBundlesView.swift"),
    "import SwiftUI\nstruct SmbBundlesView: View { var body: some View { Text(\"Discover packages\") } }\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(repoPath, "TargetShared", "Tests", "TargetSharedTests", "ASQ", "AsqDismissState_ReducerTests.swift"),
    "// discover packages unrelated test\n",
    "utf8"
  );
  for (let index = 0; index < 30; index += 1) {
    await fs.writeFile(
      path.join(repoPath, "MarktplaatsCore", "Sources", "MarktplaatsCore", `Noise${index}.swift`),
      `// Discover packages migrate UIKit to SwiftUI noise ${index}\n`,
      "utf8"
    );
  }
  await fs.writeFile(
    path.join(repoPath, ".claude", "skills", "uikit-to-swiftui", "SKILL.md"),
    "# skill\n",
    "utf8"
  );

  await saveArchitectMemory(repoPath, {
    generatedAt: new Date().toISOString(),
    sourceDocuments: ["README.md"],
    content: {
      projectOverview: "Overview",
      architecture: "Architecture",
      iosConventions: ["Swift"],
      keyComponents: [{ name: "SMB", responsibility: "Bundles" }],
      deliveryGuidance: "Guidance",
      knownRisks: [],
    },
  });

  const llm = {
    async generateText() {
      throw new Error("LLM should not be called for deterministic UIKit->SwiftUI planning");
    },
  };

  const jira = {
    created: [],
    async createSubtask(parentKey, title, body) {
      const key = `${parentKey}-${this.created.length + 1}`;
      this.created.push({ key, title, body });
      return { key };
    },
    async transitionIssueToStatus() {},
  };

  const issue = {
    key: "IOS-400",
    fields: {
      summary: "[iOS] Discover Packages - Migrate UIKit to SwiftUI",
      description: "Discover packages is located in TargetShared/SMB/ migrate UIKit elements to SwiftUI.",
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
      keyComponents: [{ name: "SMB", responsibility: "Bundles" }],
      deliveryGuidance: "Guidance",
      knownRisks: [],
    },
    architectMemoryPath: ".ios-agent/architect-context.json",
    jiraSubtaskTargetStatus: "",
  });

  assert.equal(result.moduleResolution.primaryModule, "TargetShared/SMB");
  assert.ok(
    result.createdSubtasks
      .flatMap((subtask) => subtask.changedFiles || [])
      .every((filePath) => filePath.includes("TargetShared/Sources/TargetShared/SMB"))
  );
});

test("deterministic planner fails when hinted module has no evidence", async () => {
  const repoPath = await makeTempRepo();
  await fs.writeFile(path.join(repoPath, "README.md"), "# App\n", "utf8");
  await fs.mkdir(path.join(repoPath, "MarktplaatsCore", "Sources", "MarktplaatsCore"), {
    recursive: true,
  });
  await fs.mkdir(path.join(repoPath, ".claude", "skills", "uikit-to-swiftui"), { recursive: true });

  for (let index = 0; index < 10; index += 1) {
    await fs.writeFile(
      path.join(repoPath, "MarktplaatsCore", "Sources", "MarktplaatsCore", `Noise${index}.swift`),
      `// Discover packages migrate UIKit to SwiftUI noise ${index}\n`,
      "utf8"
    );
  }
  await fs.writeFile(
    path.join(repoPath, ".claude", "skills", "uikit-to-swiftui", "SKILL.md"),
    "# skill\n",
    "utf8"
  );

  await saveArchitectMemory(repoPath, {
    generatedAt: new Date().toISOString(),
    sourceDocuments: ["README.md"],
    content: {
      projectOverview: "Overview",
      architecture: "Architecture",
      iosConventions: ["Swift"],
      keyComponents: [{ name: "Core", responsibility: "Common platform code" }],
      deliveryGuidance: "Guidance",
      knownRisks: [],
    },
  });

  const llm = {
    async generateText() {
      throw new Error("LLM should not be called for deterministic UIKit->SwiftUI planning");
    },
  };

  const jira = {
    async createSubtask() {
      throw new Error("Subtasks should not be created on low-confidence module resolution");
    },
    async transitionIssueToStatus() {},
  };

  const issue = {
    key: "IOS-401",
    fields: {
      summary: "[iOS] Discover Packages - Migrate UIKit to SwiftUI",
      description: "Discover packages is located in TargetShared/Sources/TargetShared/SMB/.",
    },
  };

  await assert.rejects(
    () =>
      createArchitectSubtasks({
        llm,
        jira,
        issue,
        targetRepoPath: repoPath,
        architectMemory: {
          projectOverview: "Overview",
          architecture: "Architecture",
          iosConventions: ["Swift"],
          keyComponents: [{ name: "Core", responsibility: "Common platform code" }],
          deliveryGuidance: "Guidance",
          knownRisks: [],
        },
        architectMemoryPath: ".ios-agent/architect-context.json",
        jiraSubtaskTargetStatus: "",
      }),
    /Low confidence module resolution/
  );
});

test("deterministic planner seeds evidence from hinted root path", async () => {
  const repoPath = await makeTempRepo();
  await fs.writeFile(path.join(repoPath, "README.md"), "# App\n", "utf8");

  await fs.mkdir(path.join(repoPath, "TargetShared", "Sources", "TargetShared", "SMB", "Features"), {
    recursive: true,
  });
  await fs.mkdir(path.join(repoPath, "MarktplaatsCore", "Sources", "MarktplaatsCore"), {
    recursive: true,
  });
  await fs.mkdir(path.join(repoPath, ".claude", "skills", "uikit-to-swiftui"), { recursive: true });

  await fs.writeFile(
    path.join(repoPath, "TargetShared", "Sources", "TargetShared", "SMB", "Features", "BundlesViewController.swift"),
    "import UIKit\nfinal class BundlesViewController: UIViewController {}\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(repoPath, "TargetShared", "Sources", "TargetShared", "SMB", "Features", "BundlesFeatureState.swift"),
    "import Foundation\nstruct BundlesFeatureState {}\n",
    "utf8"
  );
  for (let index = 0; index < 20; index += 1) {
    await fs.writeFile(
      path.join(repoPath, "MarktplaatsCore", "Sources", "MarktplaatsCore", `Noise${index}.swift`),
      `// discover packages migrate uikit swiftui noise ${index}\n`,
      "utf8"
    );
  }
  await fs.writeFile(
    path.join(repoPath, ".claude", "skills", "uikit-to-swiftui", "SKILL.md"),
    "# skill\n",
    "utf8"
  );

  await saveArchitectMemory(repoPath, {
    generatedAt: new Date().toISOString(),
    sourceDocuments: ["README.md"],
    content: {
      projectOverview: "Overview",
      architecture: "Architecture",
      iosConventions: ["Swift"],
      keyComponents: [{ name: "SMB", responsibility: "Bundles" }],
      deliveryGuidance: "Guidance",
      knownRisks: [],
    },
  });

  const llm = {
    async generateText() {
      throw new Error("LLM should not be called for deterministic UIKit->SwiftUI planning");
    },
  };

  const jira = {
    created: [],
    async createSubtask(parentKey, title, body) {
      const key = `${parentKey}-${this.created.length + 1}`;
      this.created.push({ key, title, body });
      return { key };
    },
    async transitionIssueToStatus() {},
  };

  const issue = {
    key: "IOS-402",
    fields: {
      summary: "Discover Packages - Migrate UIKit to SwiftUI",
      description:
        "Discover packages is located in TargetShared/Sources/TargetShared/SMB/ Migrate UIKit elements.",
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
      keyComponents: [{ name: "SMB", responsibility: "Bundles" }],
      deliveryGuidance: "Guidance",
      knownRisks: [],
    },
    architectMemoryPath: ".ios-agent/architect-context.json",
    jiraSubtaskTargetStatus: "",
  });

  assert.equal(result.moduleResolution.primaryModule, "TargetShared/SMB");
  assert.ok(result.createdSubtasks.length > 0);
});
