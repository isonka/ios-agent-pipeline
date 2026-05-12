import test from "node:test";
import assert from "node:assert/strict";

import { runArchitectReviewDeveloperPlan } from "../src/agents/architectDeveloperPlanReview.js";

test("runArchitectReviewDeveloperPlan returns approve", async () => {
  const llm = {
    async generateText() {
      return JSON.stringify({
        decision: "approve",
        reason: "Plan matches scope.",
      });
    },
  };
  const out = await runArchitectReviewDeveloperPlan({
    llm,
    issue: { key: "MP-1", fields: { summary: "Story" } },
    storyScope: "Summary\nDesc",
    developerDraft: { implementationPlan: "Do X", riskNotes: "low", testStubs: "T" },
  });
  assert.equal(out.decision, "approve");
});

test("runArchitectReviewDeveloperPlan returns reject", async () => {
  const llm = {
    async generateText() {
      return JSON.stringify({
        decision: "reject",
        reason: "Out of scope.",
      });
    },
  };
  const out = await runArchitectReviewDeveloperPlan({
    llm,
    issue: { key: "MP-2", fields: { summary: "S" } },
    storyScope: "scope",
    developerDraft: { implementationPlan: "bad", riskNotes: "", testStubs: "" },
  });
  assert.equal(out.decision, "reject");
});
