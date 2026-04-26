import test from "node:test";
import assert from "node:assert/strict";

import { runArchitect } from "../agents/architect.js";
import { runDeveloper } from "../agents/developer.js";
import { runTester } from "../agents/tester.js";
import { runPRReviewer } from "../agents/prReviewer.js";

test("runArchitect uses provided project context and parses JSON", async () => {
  let capturedUserMessage = "";
  const issue = { key: "MP-1", title: "Add onboarding" };

  const result = await runArchitect(
    issue,
    "PROJECT_CTX",
    {
      llmCall: async (_system, userMessage) => {
        capturedUserMessage = userMessage;
        return JSON.stringify({
          summary: "ok",
          subtasks: [{ title: "t1", body: "b1", estimate: "S" }],
          risks: [],
          dependencies: [],
        });
      },
    }
  );

  assert.equal(result.summary, "ok");
  assert.match(capturedUserMessage, /PROJECT_CTX/);
  assert.match(capturedUserMessage, /#MP-1: Add onboarding/);
});

test("runArchitect fetches context when none is provided", async () => {
  let getContextCalled = 0;
  let capturedUserMessage = "";

  await runArchitect(
    { key: "MP-2", title: "Improve search" },
    "",
    {
      getProjectContext: async () => {
        getContextCalled += 1;
        return "CTX_FROM_CACHE";
      },
      llmCall: async (_system, userMessage) => {
        capturedUserMessage = userMessage;
        return JSON.stringify({
          summary: "ok",
          subtasks: [],
          risks: [],
          dependencies: [],
        });
      },
    }
  );

  assert.equal(getContextCalled, 1);
  assert.match(capturedUserMessage, /CTX_FROM_CACHE/);
});

test("runDeveloper includes execution policy and context", async () => {
  let capturedUserMessage = "";
  const issue = { key: "MP-3", title: "Refactor list cells", body: "Task details" };

  const result = await runDeveloper(issue, {
    getProjectContext: async () => "DEV_CONTEXT",
    llmCall: async (_system, userMessage) => {
      capturedUserMessage = userMessage;
      return JSON.stringify({
        implementationPlan: "plan",
        prTitle: "title",
        prDescription: "desc",
        branchName: "feature/mp-3-refactor-list-cells",
        testStubs: "tests",
        developerDecision: {
          usedSkill: true,
          skillFilesUsed: ["skills/ios-networking.md"],
          fallbackUsed: false,
          reason: "Relevant networking skill matched task.",
        },
      });
    },
  });

  assert.equal(result.prTitle, "title");
  assert.equal(result.developerDecision.usedSkill, true);
  assert.deepEqual(result.developerDecision.skillFilesUsed, ["skills/ios-networking.md"]);
  assert.match(capturedUserMessage, /DEV_CONTEXT/);
  assert.match(capturedUserMessage, /Use project skills when relevant/);
  assert.match(
    capturedUserMessage,
    /If no relevant skill, implement via existing module examples from project docs/
  );
});

test("runDeveloper throws clear error on invalid model JSON", async () => {
  await assert.rejects(
    () =>
      runDeveloper(
        { key: "MP-4", title: "Fix crash" },
        {
          getProjectContext: async () => "CTX",
          llmCall: async () => "not-json",
        }
      ),
    /Developer returned invalid JSON/
  );
});

test("runTester includes manual and integration quality gates", async () => {
  let capturedUserMessage = "";
  const issue = { key: "MP-8", title: "Checkout flow", body: "Add analytics events" };

  const result = await runTester(issue, "diff", {
    llmCall: async (_system, userMessage) => {
      capturedUserMessage = userMessage;
      return JSON.stringify({
        testPlan: "plan",
        snapshotTests: "snap",
        manualValidation: {
          worksAsExpected: true,
          stepsRun: ["Open app", "Trigger checkout"],
          observations: ["Behavior matches expected"],
        },
        integrationTests: {
          status: "PASS",
          details: "Checkout integration suite green",
        },
        unitTests: "unit",
        uiTests: "ui",
        bugsFound: [],
        coverageAssessment: "ok",
        verdict: "PASS",
        verdictReason: "all good",
      });
    },
  });

  assert.equal(result.verdict, "PASS");
  assert.equal(result.manualValidation.worksAsExpected, true);
  assert.equal(result.integrationTests.status, "PASS");
  assert.match(capturedUserMessage, /Required output quality gate/);
  assert.match(capturedUserMessage, /manual behavior does not work as expected/);
  assert.match(capturedUserMessage, /critical integration tests fail/);
});

test("runPRReviewer includes merge quality gate and reviewerDecision", async () => {
  let capturedUserMessage = "";

  const result = await runPRReviewer(
    { number: 10, title: "Feature PR", body: "PR body" },
    "diff",
    [{ body: "🧪 Tester Agent\nall checks green" }],
    {
      llmCall: async (_system, userMessage) => {
        capturedUserMessage = userMessage;
        return JSON.stringify({
          verdict: "APPROVE",
          summary: "Looks good",
          feedback: "",
          codeQuality: "GOOD",
          securityConcerns: [],
          performanceConcerns: [],
          suggestions: [],
          reviewerDecision: {
            mergeReady: true,
            blockingIssues: [],
            requiredChecks: {
              manualValidationVerified: true,
              integrationTestsVerified: true,
            },
          },
        });
      },
    }
  );

  assert.equal(result.verdict, "APPROVE");
  assert.equal(result.reviewerDecision.mergeReady, true);
  assert.equal(result.reviewerDecision.requiredChecks.integrationTestsVerified, true);
  assert.match(capturedUserMessage, /Quality gate/);
  assert.match(capturedUserMessage, /merge is not safe/);
});
