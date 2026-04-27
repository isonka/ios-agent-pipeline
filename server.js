import "dotenv/config";
import express from "express";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

import { runArchitect } from "./agents/architect.js";
import { runDeveloper } from "./agents/developer.js";
import { runTester } from "./agents/tester.js";
import { runPRReviewer } from "./agents/prReviewer.js";
import * as jira from "./jira/client.js";
import { createDraftPullRequest } from "./github/cloudClient.js";
import { getProjectContextForPromptCached } from "./project/context.js";
import { ensureSnapshotsAndRunTests } from "./project/testRunner.js";
import { appendAgentFeedback, initializeAgentMemoryFiles, loadAgentMemory } from "./project/agentMemory.js";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";
const IN_PROGRESS_STATUS = process.env.JIRA_STATUS_IN_PROGRESS || "IN PROGRESS";
const IN_REVIEW_STATUS = process.env.JIRA_STATUS_IN_REVIEW || "IN REVIEW";
const DONE_STATUS = process.env.JIRA_STATUS_DONE || "DONE";
const BRANCH_FIELD = process.env.JIRA_BRANCH_FIELD_ID || "";
const ON_DEMAND_ONLY = String(process.env.ON_DEMAND_ONLY || "false").toLowerCase() === "true";
const DEFAULT_TARGET_PROJECT_PATH = process.env.TARGET_PROJECT_PATH || "";
const REQUIRED_LLM_PROVIDER = "bedrock";

function ensureBedrockOnlyProvider() {
  const configuredProvider = String(process.env.LLM_PROVIDER || REQUIRED_LLM_PROVIDER).toLowerCase();
  if (configuredProvider !== REQUIRED_LLM_PROVIDER) {
    throw new Error(`Unsupported LLM_PROVIDER '${configuredProvider}'. Only '${REQUIRED_LLM_PROVIDER}' is allowed.`);
  }
}

async function listRequiredEnvKeysFromExample() {
  const envExamplePath = path.resolve(process.cwd(), ".env.example");
  const raw = await fs.readFile(envExamplePath, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const separatorIndex = line.indexOf("=");
      if (separatorIndex < 0) return null;
      const key = line.slice(0, separatorIndex).trim();
      const exampleValue = line.slice(separatorIndex + 1).trim();
      if (!key || exampleValue === "") return null;
      return key;
    })
    .filter(Boolean);
}

async function validateRuntimeEnv() {
  ensureBedrockOnlyProvider();

  const requiredKeys = await listRequiredEnvKeysFromExample();
  const missing = requiredKeys.filter((key) => !process.env[key] || String(process.env[key]).trim() === "");
  if (missing.length) {
    throw new Error(
      `Missing required env vars declared in .env.example: ${missing.join(", ")}`
    );
  }
}

async function resolveTargetRepoPath(inputPath) {
  const selectedPath = inputPath || DEFAULT_TARGET_PROJECT_PATH;
  if (!selectedPath) {
    throw new Error("targetRepoPath is required when TARGET_PROJECT_PATH is not configured.");
  }

  const absolutePath = path.resolve(selectedPath);
  const stat = await fs.stat(absolutePath).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Invalid targetRepoPath: '${absolutePath}' is not a readable directory.`);
  }

  const gitDir = path.join(absolutePath, ".git");
  const gitDirStat = await fs.stat(gitDir).catch(() => null);
  if (!gitDirStat || !gitDirStat.isDirectory()) {
    throw new Error(`Invalid targetRepoPath: '${absolutePath}' is not a git repository root.`);
  }

  return absolutePath;
}

function withTargetProjectPath(targetRepoPath) {
  process.env.TARGET_PROJECT_PATH = targetRepoPath;
}

// ── Webhook signature verification ────────────────────────────────────────

function verifySignature(req) {
  if (!WEBHOOK_SECRET) return true;
  const sig = req.headers["x-webhook-signature"] || req.headers["x-hub-signature-256"];
  if (!sig) return false;
  const hmac = crypto.createHmac("sha256", WEBHOOK_SECRET);
  const digest = "sha256=" + hmac.update(JSON.stringify(req.body)).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(digest));
  } catch {
    return false;
  }
}

// ── Comment formatters ─────────────────────────────────────────────────────

function architectComment(issueKey, breakdown, subtaskKeys) {
  const created = subtaskKeys.map((key) => `- ${key}`).join("\n") || "- none";
  return [
    "Architect output generated.",
    `Parent: ${issueKey}`,
    "",
    `Summary: ${breakdown.summary || "n/a"}`,
    "",
    "Subtasks created:",
    created,
  ].join("\n");
}

function architectFeedbackRequestComment(issueKey, subtaskKeys) {
  return [
    "Architect feedback requested.",
    `Issue: ${issueKey}`,
    `Subtasks generated: ${subtaskKeys.length}`,
    "",
    "Reply with this template in a Jira comment or use /pipeline/agent-feedback:",
    "#agent-feedback",
    "agent: architect",
    "rating: good|neutral|bad",
    "whatWorked: ...",
    "whatFailed: ...",
    "expectations: ...",
    "notes: ...",
  ].join("\n");
}

function developerComment(result) {
  const decision = result.developerDecision || {};
  const usedSkill = typeof decision.usedSkill === "boolean" ? decision.usedSkill : null;
  const fallbackUsed = typeof decision.fallbackUsed === "boolean" ? decision.fallbackUsed : null;
  const skillFiles = Array.isArray(decision.skillFilesUsed) && decision.skillFilesUsed.length
    ? decision.skillFilesUsed.map((f) => `- ${f}`).join("\n")
    : "- none";

  return [
    "Developer execution contract:",
    "",
    result.implementationPlan || "No plan generated.",
    "",
    "Test stubs:",
    result.testStubs || "No stubs generated.",
    "",
    "Developer decision:",
    `- usedSkill: ${usedSkill === null ? "unknown" : usedSkill}`,
    `- fallbackUsed: ${fallbackUsed === null ? "unknown" : fallbackUsed}`,
    "- skillFilesUsed:",
    skillFiles,
    `- reason: ${decision.reason || "not provided"}`,
  ].join("\n");
}

function extractDeveloperPatch(result) {
  return result?.patchProposal || result?.diff || result?.patch || "";
}

function testerComment(result) {
  const bugs = result.bugsFound?.length ? result.bugsFound.map((b) => `- ${b}`).join("\n") : "- none";
  const manual = result.manualValidation || {};
  const manualSteps = Array.isArray(manual.stepsRun) && manual.stepsRun.length
    ? manual.stepsRun.map((s) => `- ${s}`).join("\n")
    : "- none provided";
  const manualObs = Array.isArray(manual.observations) && manual.observations.length
    ? manual.observations.map((o) => `- ${o}`).join("\n")
    : "- none";
  const integration = result.integrationTests || {};
  return [
    `Tester verdict: ${result.verdict}`,
    result.verdictReason || "",
    "",
    "Test plan:",
    result.testPlan || "No test plan generated.",
    "",
    "Snapshot tests:",
    result.snapshotTests || "No snapshot tests generated.",
    "",
    "Manual validation:",
    `- worksAsExpected: ${manual.worksAsExpected === true ? "yes" : manual.worksAsExpected === false ? "no" : "unknown"}`,
    "- stepsRun:",
    manualSteps,
    "- observations:",
    manualObs,
    "",
    "Integration tests:",
    `- status: ${integration.status || "unknown"}`,
    `- details: ${integration.details || "not provided"}`,
    "",
    "Unit tests:",
    result.unitTests || "No unit tests generated.",
    "",
    "UI tests:",
    result.uiTests || "No UI tests generated.",
    "",
    "Bugs found:",
    bugs,
  ].join("\n");
}

function shouldFailFromTesterAssessment(result) {
  if (result.verdict === "FAIL") return true;
  if (result.manualValidation?.worksAsExpected === false) return true;
  if (result.integrationTests?.status === "FAIL") return true;
  return false;
}

function testerExecutionComment(execution) {
  const created = execution.snapshot?.created ? "yes" : "no";
  const snapshotPath = execution.snapshot?.path || "not created";
  return [
    "Tester execution:",
    `- simulator: ${execution.destination}`,
    `- snapshotCreated: ${created}`,
    `- snapshotPath: ${snapshotPath}`,
    `- testsSuccess: ${execution.testRun?.success ? "yes" : "no"}`,
    `- testExitCode: ${execution.testRun?.exitCode}`,
    "",
    "xcodebuild tail:",
    execution.testRun?.outputTail || "no output",
  ].join("\n");
}

function reviewerComment(result, prUrl) {
  const decision = result.reviewerDecision || {};
  const checks = decision.requiredChecks || {};
  const blocking = Array.isArray(decision.blockingIssues) && decision.blockingIssues.length
    ? decision.blockingIssues.map((item) => `- ${item}`).join("\n")
    : "- none";

  return [
    `PR review verdict: ${result.verdict}`,
    `Code quality: ${result.codeQuality}`,
    "",
    result.summary || "No summary.",
    "",
    result.feedback ? `Required changes:\n${result.feedback}` : "No required changes.",
    "",
    "Reviewer decision:",
    `- mergeReady: ${decision.mergeReady === true ? "yes" : decision.mergeReady === false ? "no" : "unknown"}`,
    "- blockingIssues:",
    blocking,
    `- requiredChecks.manualValidationVerified: ${checks.manualValidationVerified === true ? "yes" : checks.manualValidationVerified === false ? "no" : "unknown"}`,
    `- requiredChecks.integrationTestsVerified: ${checks.integrationTestsVerified === true ? "yes" : checks.integrationTestsVerified === false ? "no" : "unknown"}`,
    "",
    `PR: ${prUrl}`,
  ].join("\n");
}

function shouldFailFromReviewerAssessment(result) {
  if (result.verdict === "REQUEST_CHANGES") return true;
  if (result.reviewerDecision?.mergeReady === false) return true;
  if (result.reviewerDecision?.requiredChecks?.manualValidationVerified === false) return true;
  if (result.reviewerDecision?.requiredChecks?.integrationTestsVerified === false) return true;
  return false;
}

function getPlainDescription(issue) {
  const desc = issue.fields?.description;
  if (!desc || !desc.content) return "";
  return desc.content
    .flatMap((node) => node.content || [])
    .map((node) => node.text || "")
    .join("\n");
}

function normalizeIssue(issue) {
  return {
    key: issue.key,
    title: issue.fields?.summary || "",
    body: getPlainDescription(issue),
    fields: issue.fields,
  };
}

function getStatusTransition(changelog) {
  const item = changelog?.items?.find((it) => it.field === "status");
  if (!item) return null;
  return { from: item.fromString, to: item.toString };
}

async function loadAuthorizedIssue(issueKey) {
  const issue = await jira.getIssue(issueKey);
  const isInConfiguredBoard = await jira.isIssueInConfiguredBoard(issueKey);
  if (!isInConfiguredBoard) {
    throw new Error("Forbidden: issue is outside configured Jira board scope");
  }
  const isOwnerIssue = await jira.isAssignedToCurrentUser(issue);
  if (!isOwnerIssue) {
    throw new Error("Forbidden: issue is not assigned to Jira token owner");
  }
  return issue;
}

// ── Manual endpoint: create subtasks from parent story ────────────────────
app.post("/pipeline/create-subtasks", async (req, res) => {
  if (!verifySignature(req)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  try {
    const { issueKey, plannedChanges, expectations = "", targetRepoPath } = req.body || {};
    if (!issueKey) {
      return res.status(400).json({ error: "issueKey is required" });
    }
    if (!plannedChanges) {
      return res.status(400).json({
        error: "plannedChanges is required. Provide your expected plan so Architect can learn before creating subtasks.",
      });
    }

    const resolvedRepoPath = await resolveTargetRepoPath(targetRepoPath);
    withTargetProjectPath(resolvedRepoPath);
    const issue = await loadAuthorizedIssue(issueKey);
    const plannedChangesText = typeof plannedChanges === "string"
      ? plannedChanges
      : JSON.stringify(plannedChanges);
    await appendAgentFeedback("architect", {
      issueKey,
      rating: "plan_input",
      whatWorked: "",
      whatFailed: "",
      expectations,
      notes: plannedChangesText,
      source: "planned_input",
    });

    const normalized = normalizeIssue(issue);
    const breakdown = await runArchitect(normalized);
    const subtaskKeys = [];

    for (const subtask of breakdown.subtasks || []) {
      const created = await jira.createSubtask(issue, {
        title: subtask.title,
        body: subtask.body,
      });
      subtaskKeys.push(created.key);
    }

    const runSummary = `Generated ${subtaskKeys.length} subtasks: ${subtaskKeys.join(", ")}`;
    await appendAgentFeedback("architect", {
      issueKey,
      rating: "neutral",
      whatWorked: runSummary,
      whatFailed: "",
      expectations,
      notes: "Auto-recorded architect run summary.",
      source: "auto_run_summary",
    });

    await jira.addComment(issueKey, architectComment(issueKey, breakdown, subtaskKeys));
    await jira.addComment(issueKey, architectFeedbackRequestComment(issueKey, subtaskKeys));
    return res.status(200).json({ created: subtaskKeys.length, subtaskKeys, targetRepoPath: resolvedRepoPath });
  } catch (err) {
    if (String(err.message || "").startsWith("Forbidden:")) {
      return res.status(403).json({ error: err.message });
    }
    return res.status(500).json({ error: err.message });
  }
});

// ── Manual endpoint: run developer stage on demand ─────────────────────────
app.post("/pipeline/run-developer", async (req, res) => {
  if (!verifySignature(req)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  try {
    const { issueKey, plannedChanges, expectations = "", targetRepoPath, subtaskKey } = req.body || {};
    if (!issueKey) {
      return res.status(400).json({ error: "issueKey is required" });
    }
    if (!subtaskKey) {
      return res.status(400).json({ error: "subtaskKey is required for developer stage." });
    }
    if (!plannedChanges) {
      return res.status(400).json({
        error: "plannedChanges is required for developer learning memory.",
      });
    }

    const resolvedRepoPath = await resolveTargetRepoPath(targetRepoPath);
    withTargetProjectPath(resolvedRepoPath);
    await getProjectContextForPromptCached();
    const issue = await loadAuthorizedIssue(issueKey);
    const plannedChangesText = typeof plannedChanges === "string"
      ? plannedChanges
      : JSON.stringify(plannedChanges);
    await appendAgentFeedback("developer", {
      issueKey,
      rating: "plan_input",
      expectations,
      notes: `subtaskKey=${subtaskKey}\n${plannedChangesText}`,
      source: "planned_input",
    });
    const normalized = normalizeIssue(issue);
    const devResult = await runDeveloper(normalized);
    const patchProposal = extractDeveloperPatch(devResult);
    const patchSummary = patchProposal
      ? `\n\nPatch proposal:\n\`\`\`diff\n${patchProposal.slice(0, 4000)}\n\`\`\``
      : "\n\nPatch proposal: not provided by developer agent.";
    await jira.addComment(
      issue.key,
      `${developerComment(devResult)}\n\nSelected subtask: ${subtaskKey}\nTarget repo: ${resolvedRepoPath}${patchSummary}`
    );

    return res.status(200).json({
      issueKey,
      subtaskKey,
      targetRepoPath: resolvedRepoPath,
      prTitle: devResult.prTitle,
      branchName: devResult.branchName,
      patchProposal,
      developerDecision: devResult.developerDecision || null,
    });
  } catch (err) {
    if (String(err.message || "").startsWith("Forbidden:")) {
      return res.status(403).json({ error: err.message });
    }
    return res.status(500).json({ error: err.message });
  }
});

app.post("/pipeline/run-tester", async (req, res) => {
  if (!verifySignature(req)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  try {
    const { issueKey, plannedChanges, expectations = "", diff = "Diff supplied manually.", targetRepoPath } = req.body || {};
    if (!issueKey) return res.status(400).json({ error: "issueKey is required" });
    if (!plannedChanges) {
      return res.status(400).json({
        error: "plannedChanges is required for tester learning memory.",
      });
    }

    const resolvedRepoPath = await resolveTargetRepoPath(targetRepoPath);
    withTargetProjectPath(resolvedRepoPath);
    const issue = await loadAuthorizedIssue(issueKey);
    const plannedChangesText = typeof plannedChanges === "string"
      ? plannedChanges
      : JSON.stringify(plannedChanges);
    await appendAgentFeedback("tester", {
      issueKey,
      rating: "plan_input",
      expectations,
      notes: plannedChangesText,
      source: "planned_input",
    });

    const normalized = normalizeIssue(issue);
    const testerResult = await runTester(normalized, diff);
    await jira.addComment(issue.key, `${testerComment(testerResult)}\n\nTarget repo: ${resolvedRepoPath}`);
    const execution = await ensureSnapshotsAndRunTests(issue.key);
    await jira.addComment(issue.key, testerExecutionComment(execution));

    return res.status(200).json({
      issueKey,
      targetRepoPath: resolvedRepoPath,
      verdict: testerResult.verdict,
      executionSuccess: Boolean(execution.testRun?.success),
    });
  } catch (err) {
    if (String(err.message || "").startsWith("Forbidden:")) {
      return res.status(403).json({ error: err.message });
    }
    return res.status(500).json({ error: err.message });
  }
});

app.post("/pipeline/run-reviewer", async (req, res) => {
  if (!verifySignature(req)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  try {
    const {
      issueKey,
      plannedChanges,
      expectations = "",
      prNumber = 0,
      prTitle = "",
      prBody = "",
      diff = "Diff supplied manually.",
      qaSummary = "",
      targetRepoPath,
    } = req.body || {};
    if (!issueKey) return res.status(400).json({ error: "issueKey is required" });
    if (!plannedChanges) {
      return res.status(400).json({
        error: "plannedChanges is required for reviewer learning memory.",
      });
    }

    const resolvedRepoPath = await resolveTargetRepoPath(targetRepoPath);
    withTargetProjectPath(resolvedRepoPath);
    const issue = await loadAuthorizedIssue(issueKey);
    const plannedChangesText = typeof plannedChanges === "string"
      ? plannedChanges
      : JSON.stringify(plannedChanges);
    await appendAgentFeedback("reviewer", {
      issueKey,
      rating: "plan_input",
      expectations,
      notes: plannedChangesText,
      source: "planned_input",
    });

    const reviewResult = await runPRReviewer(
      { number: prNumber || 0, title: prTitle || issue.fields?.summary || "PR", body: prBody || "" },
      diff,
      [{ body: qaSummary || "No QA summary provided." }]
    );
    await jira.addComment(
      issue.key,
      `${reviewerComment(reviewResult, "manual/on-demand")}\n\nTarget repo: ${resolvedRepoPath}`
    );
    return res.status(200).json({
      issueKey,
      targetRepoPath: resolvedRepoPath,
      verdict: reviewResult.verdict,
      mergeReady: reviewResult.reviewerDecision?.mergeReady ?? null,
    });
  } catch (err) {
    if (String(err.message || "").startsWith("Forbidden:")) {
      return res.status(403).json({ error: err.message });
    }
    return res.status(500).json({ error: err.message });
  }
});

// ── Manual endpoint: feedback loop for architect memory ────────────────────
app.post("/pipeline/architect-feedback", async (req, res) => {
  if (!verifySignature(req)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  try {
    const {
      issueKey,
      rating = "neutral",
      whatWorked = "",
      whatFailed = "",
      expectations = "",
      developerNotes = "",
    } = req.body || {};

    if (!issueKey) {
      return res.status(400).json({ error: "issueKey is required" });
    }

    const saved = await appendAgentFeedback("architect", {
      issueKey,
      rating,
      whatWorked,
      whatFailed,
      expectations,
      notes: developerNotes,
      source: "manual_feedback",
    });

    return res.status(200).json({
      status: "saved",
      totalEntries: saved.feedback.length,
      updatedAt: saved.updatedAt,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Manual endpoint: generic feedback loop for any agent ───────────────────
app.post("/pipeline/agent-feedback", async (req, res) => {
  if (!verifySignature(req)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  try {
    const {
      agent,
      issueKey,
      rating = "neutral",
      whatWorked = "",
      whatFailed = "",
      expectations = "",
      notes = "",
    } = req.body || {};

    if (!agent) return res.status(400).json({ error: "agent is required" });
    if (!issueKey) return res.status(400).json({ error: "issueKey is required" });

    const saved = await appendAgentFeedback(agent, {
      issueKey,
      rating,
      whatWorked,
      whatFailed,
      expectations,
      notes,
      source: "manual_feedback",
    });

    return res.status(200).json({
      status: "saved",
      agent,
      totalEntries: saved.feedback.length,
      updatedAt: saved.updatedAt,
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// ── Jira webhook status-driven orchestration ───────────────────────────────
app.post("/jira/webhook", async (req, res) => {
  if (!verifySignature(req)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  if (ON_DEMAND_ONLY) {
    return res.status(200).json({
      status: "ignored",
      reason: "ON_DEMAND_ONLY=true",
    });
  }

  res.status(200).json({ status: "accepted" });

  const issue = req.body?.issue;
  const transition = getStatusTransition(req.body?.changelog);
  if (!issue || !transition) return;

  const normalized = normalizeIssue(issue);

  try {
    const isInConfiguredBoard = await jira.isIssueInConfiguredBoard(issue.key);
    if (!isInConfiguredBoard) {
      console.log(`Skipping ${issue.key}: outside configured Jira board scope`);
      return;
    }

    const isOwnerIssue = await jira.isAssignedToCurrentUser(issue);
    if (!isOwnerIssue) {
      console.log(`Skipping ${issue.key}: not assigned to Jira token owner`);
      return;
    }

    if (transition.to === IN_PROGRESS_STATUS) {
      await getProjectContextForPromptCached();
      const devResult = await runDeveloper(normalized);
      await jira.addComment(issue.key, developerComment(devResult));
      return;
    }

    if (transition.to === IN_REVIEW_STATUS) {
      const testerResult = await runTester(normalized, "Diff supplied by local branch/PR process.");
      await jira.addComment(issue.key, testerComment(testerResult));

      const execution = await ensureSnapshotsAndRunTests(issue.key);
      await jira.addComment(issue.key, testerExecutionComment(execution));
      if (!execution.testRun?.success) {
        await jira.addComment(issue.key, "Automated tests failed. Move ticket back to developer.");
        return;
      }

      if (shouldFailFromTesterAssessment(testerResult)) {
        await jira.addComment(
          issue.key,
          "Testing failed (manual validation and/or integration checks). Move ticket back to developer."
        );
        return;
      }

      const branchFromField = BRANCH_FIELD ? issue.fields?.[BRANCH_FIELD] : "";
      const headBranch = branchFromField || `feature/${issue.key.toLowerCase()}`;
      const pr = await createDraftPullRequest({
        title: `[${issue.key}] ${issue.fields?.summary || "iOS update"}`,
        body: `Automated PR from Jira issue ${issue.key}\n\n${testerResult.testPlan || ""}`,
        head: headBranch,
      });

      const reviewResult = await runPRReviewer(
        { number: pr.number, title: pr.title, body: pr.body },
        "PR diff is available in GitHub.",
        [{ body: testerComment(testerResult) }]
      );
      await jira.addComment(issue.key, reviewerComment(reviewResult, pr.html_url));

      if (shouldFailFromReviewerAssessment(reviewResult)) {
        await jira.addComment(issue.key, "PR Reviewer requested changes. Move ticket back to developer.");
        return;
      }

      await jira.transitionIssueByName(issue.key, DONE_STATUS).catch(() => {});
      return;
    }
  } catch (err) {
    await jira.addComment(issue.key, `Pipeline error: ${err.message}`).catch(() => {});
  }
});

// ── Debug endpoint: verify Jira token identity ─────────────────────────────
app.get("/debug/whoami", async (_, res) => {
  try {
    const me = await jira.getCurrentUser();
    return res.status(200).json({
      accountId: me.accountId,
      displayName: me.displayName,
      emailAddress: me.emailAddress || null,
      active: me.active,
      timeZone: me.timeZone || null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get("/debug/architect-memory", async (_, res) => {
  try {
    const memory = await loadAgentMemory("architect");
    return res.status(200).json(memory);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get("/debug/agent-memory/:agent", async (req, res) => {
  try {
    const memory = await loadAgentMemory(req.params.agent);
    return res.status(200).json(memory);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// ── Health check ───────────────────────────────────────────────────────────

app.get("/health", (_, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));

// ── Start ──────────────────────────────────────────────────────────────────

app.listen(PORT, async () => {
  try {
    await validateRuntimeEnv();
    await initializeAgentMemoryFiles();
    console.log(`\n🚀 iOS Agent Pipeline running on :${PORT}`);
    console.log(`   LLM provider: ${process.env.LLM_PROVIDER}`);
    console.log(`   Bedrock model: ${process.env.BEDROCK_MODEL_ID || "anthropic.claude-sonnet-4-5"}`);
    console.log(`   Jira: ${process.env.JIRA_BASE_URL || "not configured"}`);
    console.log(`   Health: http://localhost:${PORT}/health\n`);
  } catch (err) {
    console.error(`Startup validation failed: ${err.message}`);
    process.exit(1);
  }
});