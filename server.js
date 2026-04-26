import "dotenv/config";
import express from "express";
import crypto from "crypto";

import { runArchitect } from "./agents/architect.js";
import { runDeveloper } from "./agents/developer.js";
import { runTester } from "./agents/tester.js";
import { runPRReviewer } from "./agents/prReviewer.js";
import * as jira from "./jira/client.js";
import { createDraftPullRequest } from "./github/cloudClient.js";
import { getProjectContextForPromptCached } from "./project/context.js";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";
const IN_PROGRESS_STATUS = process.env.JIRA_STATUS_IN_PROGRESS || "IN PROGRESS";
const IN_REVIEW_STATUS = process.env.JIRA_STATUS_IN_REVIEW || "IN REVIEW";
const DONE_STATUS = process.env.JIRA_STATUS_DONE || "DONE";
const BRANCH_FIELD = process.env.JIRA_BRANCH_FIELD_ID || "";

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

function developerComment(result) {
  return [
    "Developer execution contract:",
    "",
    result.implementationPlan || "No plan generated.",
    "",
    "Test stubs:",
    result.testStubs || "No stubs generated.",
  ].join("\n");
}

function testerComment(result) {
  const bugs = result.bugsFound?.length ? result.bugsFound.map((b) => `- ${b}`).join("\n") : "- none";
  return [
    `Tester verdict: ${result.verdict}`,
    result.verdictReason || "",
    "",
    "Test plan:",
    result.testPlan || "No test plan generated.",
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

function reviewerComment(result, prUrl) {
  return [
    `PR review verdict: ${result.verdict}`,
    `Code quality: ${result.codeQuality}`,
    "",
    result.summary || "No summary.",
    "",
    result.feedback ? `Required changes:\n${result.feedback}` : "No required changes.",
    "",
    `PR: ${prUrl}`,
  ].join("\n");
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

// ── Manual endpoint: create subtasks from parent story ────────────────────
app.post("/pipeline/create-subtasks", async (req, res) => {
  if (!verifySignature(req)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  try {
    const { issueKey } = req.body || {};
    if (!issueKey) {
      return res.status(400).json({ error: "issueKey is required" });
    }

    const issue = await jira.getIssue(issueKey);
    const isInConfiguredBoard = await jira.isIssueInConfiguredBoard(issueKey);
    if (!isInConfiguredBoard) {
      return res.status(403).json({
        error: "Forbidden: issue is outside configured Jira board scope",
      });
    }

    const isOwnerIssue = await jira.isAssignedToCurrentUser(issue);
    if (!isOwnerIssue) {
      return res.status(403).json({
        error: "Forbidden: issue is not assigned to Jira token owner",
      });
    }

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

    await jira.addComment(issueKey, architectComment(issueKey, breakdown, subtaskKeys));
    return res.status(200).json({ created: subtaskKeys.length, subtaskKeys });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Jira webhook status-driven orchestration ───────────────────────────────
app.post("/jira/webhook", async (req, res) => {
  if (!verifySignature(req)) {
    return res.status(401).json({ error: "Invalid signature" });
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

      if (testerResult.verdict === "FAIL") {
        await jira.addComment(issue.key, "Testing failed. Move ticket back to developer.");
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

// ── Health check ───────────────────────────────────────────────────────────

app.get("/health", (_, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));

// ── Start ──────────────────────────────────────────────────────────────────

app.listen(PORT, async () => {
  console.log(`\n🚀 iOS Agent Pipeline running on :${PORT}`);
  console.log(`   Bedrock model: ${process.env.BEDROCK_MODEL_ID || "anthropic.claude-sonnet-4-5"}`);
  console.log(`   Jira: ${process.env.JIRA_BASE_URL || "not configured"}`);
  console.log(`   Health: http://localhost:${PORT}/health\n`);
});