import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "path";

import { runArchitectCheckPlanJob } from "../src/hooks/runArchitectCheckPlanJob.js";
import { serializeDeveloperPlanComment } from "../src/services/developerDraftFromComments.js";

test("runArchitectCheckPlanJob posts review from latest plan comment", async () => {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "ios-agent-check-plan-"));
  await fs.mkdir(path.join(repoPath, ".git"), { recursive: true });

  const draft = { implementationPlan: "Do A", riskNotes: "r", testStubs: "t" };
  const planComment = serializeDeveloperPlanComment({ issueKey: "MP-9", draft });

  const jira = {
    planComments: [],
    async getIssue() {
      return {
        key: "MP-9",
        fields: {
          summary: "S",
          description: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: "Desc" }] }] },
        },
      };
    },
    async listIssueComments() {
      return {
        comments: [
          {
            created: "2025-02-01T00:00:00.000+0000",
            body: {
              type: "doc",
              version: 1,
              content: [{ type: "paragraph", content: [{ type: "text", text: planComment }] }],
            },
          },
        ],
      };
    },
    async addCommentParagraphs(issueKey, text) {
      this.planComments.push({ issueKey, text });
    },
  };

  const llm = {
    async generateText() {
      return JSON.stringify({ decision: "approve", reason: "ok" });
    },
  };

  const review = await runArchitectCheckPlanJob({
    jira,
    llm,
    issueKey: "MP-9",
    targetRepoPath: repoPath,
    targetFallback: "",
  });

  assert.equal(review.decision, "approve");
  assert.equal(jira.planComments.length, 1);
  assert.match(jira.planComments[0].text, /check plan/i);
  assert.match(jira.planComments[0].text, /APPROVE/);
});
