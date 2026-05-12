import test from "node:test";
import assert from "node:assert/strict";

import {
  runDeveloper,
  runDeveloperPlan,
  runDeveloperExecute,
  extractPatchFromDeveloperExecuteResponse,
} from "../src/agents/developer.js";

test("runDeveloper parses fenced JSON from first completion", async () => {
  const llm = {
    async generateText() {
      return "```json\n" +
        JSON.stringify({
          implementationPlan: "do thing",
          patchProposal: "diff",
          riskNotes: "none",
          testStubs: "test",
        }) +
        "\n```";
    },
  };

  const result = await runDeveloper({
    llm,
    issue: { key: "IOS-1", fields: { summary: "Feature" } },
    architectPlanText: "- step 1",
    context: { docs: [] },
  });

  assert.equal(result.implementationPlan, "do thing");
  assert.equal(result.patchProposal, "diff");
});

test("runDeveloper throws when implementationPlan missing after repair", async () => {
  let calls = 0;
  const llm = {
    async generateText() {
      calls += 1;
      if (calls === 1) return "nope";
      return JSON.stringify({ patchProposal: "only patch" });
    },
  };

  await assert.rejects(
    () =>
      runDeveloper({
        llm,
        issue: { key: "IOS-2", fields: { summary: "X" } },
        architectPlanText: "plan",
        context: { docs: [] },
      }),
    /implementationPlan/
  );
});

test("runDeveloperPlan returns plan fields only", async () => {
  const llm = {
    async generateText() {
      return JSON.stringify({
        implementationPlan: "step A then B",
        riskNotes: "low",
        testStubs: "FooTests",
      });
    },
  };

  const out = await runDeveloperPlan({
    llm,
    issue: { key: "IOS-3", fields: { summary: "S" } },
    architectPlanText: "[1] task",
    context: { docs: [] },
  });

  assert.equal(out.implementationPlan, "step A then B");
  assert.equal(out.riskNotes, "low");
  assert.equal(out.testStubs, "FooTests");
});

test("runDeveloperExecute returns patchProposal", async () => {
  const llm = {
    async generateText() {
      return JSON.stringify({ patchProposal: "diff --git a/x b/x\n" });
    },
  };

  const out = await runDeveloperExecute({
    llm,
    issue: { key: "IOS-4", fields: { summary: "S" } },
    architectPlanText: "[1] task",
    developerDraft: {
      implementationPlan: "do it",
      riskNotes: "",
      testStubs: "",
    },
    context: { docs: [] },
  });

  assert.ok(out.patchProposal.includes("diff --git"));
});

test("extractPatchFromDeveloperExecuteResponse accepts raw diff with braces in hunks", () => {
  const diff = `diff --git a/Foo.swift b/Foo.swift
--- a/Foo.swift
+++ b/Foo.swift
@@ -1 +1 @@
-let x = 1
+let x = { 1 }
`;
  const out = extractPatchFromDeveloperExecuteResponse(diff);
  assert.ok(out.includes("+let x = { 1 }"));
});

test("extractPatchFromDeveloperExecuteResponse parses JSON patchProposal", () => {
  const out = extractPatchFromDeveloperExecuteResponse(
    JSON.stringify({ patchProposal: "diff --git a/x b/x\n" })
  );
  assert.ok(out.includes("diff --git"));
});

test("runDeveloperExecute uses repair when first completion is not a patch", async () => {
  let n = 0;
  const good = `diff --git a/x b/x
--- a/x
+++ b/x
@@ -1 +1 @@
-a
+b
`;
  const llm = {
    async generateText() {
      n += 1;
      if (n === 1) return "Here is a helpful summary without a diff.";
      return good;
    },
  };

  const out = await runDeveloperExecute({
    llm,
    issue: { key: "IOS-5", fields: { summary: "S" } },
    architectPlanText: "scope",
    developerDraft: { implementationPlan: "p", riskNotes: "", testStubs: "" },
    context: { docs: [] },
  });
  assert.equal(n, 2);
  assert.ok(out.patchProposal.includes("diff --git"));
});
