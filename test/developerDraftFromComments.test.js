import test from "node:test";
import assert from "node:assert/strict";

import {
  DEVELOPER_DRAFT_MARKER,
  serializeDeveloperPlanComment,
  fetchLatestDeveloperDraftFromComments,
} from "../src/services/developerDraftFromComments.js";

test("serialize then fetch round-trips draft", async () => {
  const draft = {
    implementationPlan: "Step one\nStep two",
    riskNotes: "low",
    testStubs: "FooTests",
  };
  const body = serializeDeveloperPlanComment({ issueKey: "MP-1", draft });

  const jira = {
    async listIssueComments() {
      return {
        comments: [
          {
            created: "2025-01-02T00:00:00.000+0000",
            body: {
              type: "doc",
              version: 1,
              content: [{ type: "paragraph", content: [{ type: "text", text: body }] }],
            },
          },
        ],
      };
    },
  };

  const out = await fetchLatestDeveloperDraftFromComments(jira, "MP-1");
  assert.ok(out);
  assert.equal(out.implementationPlan, "Step one\nStep two");
  assert.equal(out.riskNotes, "low");
  assert.equal(out.testStubs, "FooTests");
  assert.ok(body.includes(DEVELOPER_DRAFT_MARKER));
});

test("fetchLatestDeveloperDraftFromComments returns null when missing", async () => {
  const jira = {
    async listIssueComments() {
      return { comments: [] };
    },
  };
  assert.equal(await fetchLatestDeveloperDraftFromComments(jira, "X"), null);
});
