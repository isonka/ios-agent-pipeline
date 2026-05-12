import express from "express";

import { validateEnv, envConfig } from "./config/env.js";
import { resolveTargetRepoPath } from "./services/repoPath.js";
import { buildProjectContext } from "./services/projectContext.js";
import { loadRunState, saveRunState } from "./services/runStore.js";
import {
  createArchitectSubtasks,
  ensureArchitectMemory,
} from "./services/pipeline/architectFlow.js";
import { BedrockClaudeClient } from "./llm/bedrockClaude.js";
import { JiraClient } from "./integrations/jiraClient.js";
import { runDeveloper } from "./agents/developer.js";
import { runTester } from "./agents/tester.js";
import { runReviewer } from "./agents/reviewer.js";
import { shouldTriggerArchitectRefineFromComment } from "./agents/architectRefineStory.js";
import { runArchitectRefineJob } from "./hooks/runArchitectRefineJob.js";

const app = express();
app.use(express.json());

function jsonError(res, code, message) {
  return res.status(code).json({ error: message });
}

function createDependencies(config) {
  const llm = new BedrockClaudeClient({
    region: config.bedrockRegion,
    modelId: config.bedrockModelId,
    maxTokens: config.llmMaxTokens,
    temperature: 0,
  });

  const jira = new JiraClient({
    baseUrl: config.jiraBaseUrl,
    email: config.jiraEmail,
    apiToken: config.jiraApiToken,
    projectKey: config.jiraProjectKey,
  });

  return { llm, jira };
}

app.get("/health", (_, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

async function resolveRepoPath({ targetRepoPath, targetFallback }) {
  return resolveTargetRepoPath(targetRepoPath || "", targetFallback);
}

async function loadIssueAndRepoPath({ jira, issueKey, targetRepoPath, targetFallback }) {
  const resolvedRepoPath = await resolveRepoPath({ targetRepoPath, targetFallback });
  const issue = await jira.getIssue(issueKey);
  return { issue, resolvedRepoPath };
}

async function loadIssueAndContext({ jira, issueKey, targetRepoPath, targetFallback }) {
  const { issue, resolvedRepoPath } = await loadIssueAndRepoPath({
    jira,
    issueKey,
    targetRepoPath,
    targetFallback,
  });
  const context = await buildProjectContext(resolvedRepoPath);
  return { issue, context, resolvedRepoPath };
}

app.post("/pipeline/learn-architect-context", async (req, res) => {
  try {
    const { targetRepoPath, forceRegenerate = false } = req.body || {};
    const config = envConfig();
    const deps = createDependencies(config);
    const resolvedRepoPath = await resolveRepoPath({
      targetRepoPath,
      targetFallback: config.targetProjectPathFallback,
    });

    const memoryResult = await ensureArchitectMemory({
      llm: deps.llm,
      targetRepoPath: resolvedRepoPath,
      forceRegenerate: Boolean(forceRegenerate),
    });

    res.status(200).json({
      targetRepoPath: resolvedRepoPath,
      architectMemoryPath: memoryResult.architectMemoryPath,
      architectMemoryGenerated: memoryResult.architectMemoryGenerated,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/pipeline/create-subtasks", async (req, res) => {
  try {
    const { issueKey, targetRepoPath } = req.body || {};
    if (!issueKey) return jsonError(res, 400, "issueKey is required");

    const config = envConfig();
    const deps = createDependencies(config);
    const { issue, resolvedRepoPath } = await loadIssueAndRepoPath({
      jira: deps.jira,
      issueKey,
      targetRepoPath,
      targetFallback: config.targetProjectPathFallback,
    });

    const memoryResult = await ensureArchitectMemory({
      llm: deps.llm,
      targetRepoPath: resolvedRepoPath,
    });

    const architectResult = await createArchitectSubtasks({
      llm: deps.llm,
      jira: deps.jira,
      issue,
      targetRepoPath: resolvedRepoPath,
      architectMemory: memoryResult.architectMemory,
      architectMemoryPath: memoryResult.architectMemoryPath,
      jiraSubtaskTargetStatus: config.jiraSubtaskTargetStatus,
    });

    await saveRunState(config.runStateDir, issue.key, {
      issueKey: issue.key,
      targetRepoPath: resolvedRepoPath,
      architect: architectResult,
      architectMemory: {
        path: memoryResult.architectMemoryPath,
        generated: memoryResult.architectMemoryGenerated,
        updated: architectResult.architectMemoryUpdated,
        addedSignals: architectResult.architectMemoryAddedSignals,
      },
      implementationContext: architectResult.implementationContext,
      subtasks: architectResult.createdSubtasks,
      updatedAt: new Date().toISOString(),
    });

    await deps.jira.addComment(
      issue.key,
      [
        `Architect created ${architectResult.createdSubtasks.length} subtasks for ${issue.key}.`,
        `Target repo: ${resolvedRepoPath}`,
        `Architect memory: ${memoryResult.architectMemoryPath} (${memoryResult.architectMemoryGenerated ? "created" : "reused"})`,
        architectResult.architectMemoryUpdated
          ? `Architect memory updated with ${architectResult.architectMemoryAddedSignals} new implementation signals.`
          : "Architect memory had no new implementation signals.",
        config.jiraSubtaskTargetStatus
          ? `Subtasks moved to status: ${config.jiraSubtaskTargetStatus}`
          : "Subtasks left in Jira default status.",
      ].join("\n")
    );

    res.status(200).json({
      issueKey: issue.key,
      targetRepoPath: resolvedRepoPath,
      architectMemoryPath: memoryResult.architectMemoryPath,
      architectMemoryGenerated: memoryResult.architectMemoryGenerated,
      architectMemoryUpdated: architectResult.architectMemoryUpdated,
      architectMemoryAddedSignals: architectResult.architectMemoryAddedSignals,
      summary: architectResult.summary,
      moduleResolution: architectResult.moduleResolution,
      implementationContext: architectResult.implementationContext,
      subtasks: architectResult.createdSubtasks,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/pipeline/run-developer", async (req, res) => {
  try {
    const { issueKey, subtaskKey, targetRepoPath } = req.body || {};
    if (!issueKey) return jsonError(res, 400, "issueKey is required");
    if (!subtaskKey) return jsonError(res, 400, "subtaskKey is required");

    const config = envConfig();
    const deps = createDependencies(config);
    const { issue, context, resolvedRepoPath } = await loadIssueAndContext({
      jira: deps.jira,
      issueKey,
      targetRepoPath,
      targetFallback: config.targetProjectPathFallback,
    });

    const runState = await loadRunState(config.runStateDir, issueKey);
    const subtaskSummary = runState?.subtasks?.find((item) => item.key === subtaskKey)?.title || "";

    const developerResult = await runDeveloper({
      llm: deps.llm,
      issue,
      subtaskKey,
      subtaskSummary,
      context,
    });

    const updatedState = {
      ...(runState || {}),
      issueKey,
      targetRepoPath: resolvedRepoPath,
      developer: {
        subtaskKey,
        ...developerResult,
      },
      updatedAt: new Date().toISOString(),
    };
    await saveRunState(config.runStateDir, issueKey, updatedState);

    await deps.jira.addComment(
      issueKey,
      `Developer selected ${subtaskKey} and produced patch proposal.\n\n${developerResult.implementationPlan || ""}`
    );

    res.status(200).json({
      issueKey,
      targetRepoPath: resolvedRepoPath,
      subtaskKey,
      ...developerResult,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/pipeline/run-tester", async (req, res) => {
  try {
    const { issueKey, diff, targetRepoPath } = req.body || {};
    if (!issueKey) return jsonError(res, 400, "issueKey is required");
    if (!diff) return jsonError(res, 400, "diff is required");

    const config = envConfig();
    const deps = createDependencies(config);
    const { context, resolvedRepoPath } = await loadIssueAndContext({
      jira: deps.jira,
      issueKey,
      targetRepoPath,
      targetFallback: config.targetProjectPathFallback,
    });

    const testerResult = await runTester({
      llm: deps.llm,
      issueKey,
      diff,
      context,
    });

    const runState = await loadRunState(config.runStateDir, issueKey);
    await saveRunState(config.runStateDir, issueKey, {
      ...(runState || {}),
      issueKey,
      targetRepoPath: resolvedRepoPath,
      tester: testerResult,
      updatedAt: new Date().toISOString(),
    });

    await deps.jira.addComment(
      issueKey,
      `Tester verdict: ${testerResult.verdict}\nReason: ${testerResult.reason || "n/a"}`
    );

    res.status(200).json({
      issueKey,
      targetRepoPath: resolvedRepoPath,
      ...testerResult,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/pipeline/run-reviewer", async (req, res) => {
  try {
    const { issueKey, diff, targetRepoPath } = req.body || {};
    if (!issueKey) return jsonError(res, 400, "issueKey is required");
    if (!diff) return jsonError(res, 400, "diff is required");

    const config = envConfig();
    const deps = createDependencies(config);
    const resolvedRepoPath = await resolveRepoPath({
      targetRepoPath,
      targetFallback: config.targetProjectPathFallback,
    });
    const runState = await loadRunState(config.runStateDir, issueKey);
    const testerReport = runState?.tester || {};

    const reviewerResult = await runReviewer({
      llm: deps.llm,
      issueKey,
      diff,
      testerReport,
    });

    await saveRunState(config.runStateDir, issueKey, {
      ...(runState || {}),
      issueKey,
      targetRepoPath: resolvedRepoPath,
      reviewer: reviewerResult,
      updatedAt: new Date().toISOString(),
    });

    await deps.jira.addComment(
      issueKey,
      `Code reviewer verdict: ${reviewerResult.verdict}\nSummary: ${reviewerResult.summary || "n/a"}`
    );

    res.status(200).json({
      issueKey,
      targetRepoPath: resolvedRepoPath,
      ...reviewerResult,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/hooks/jira/comment", (req, res) => {
  // No shared-secret check yet (local-first). Add auth before exposing this URL on the internet.
  const config = envConfig();
  const issueKey = req.body?.issueKey || req.body?.issue;
  const commentBody = req.body?.commentBody ?? req.body?.comment ?? "";
  if (!issueKey) {
    return res.status(400).json({ error: "issueKey is required" });
  }

  if (!shouldTriggerArchitectRefineFromComment(commentBody)) {
    return res.status(200).json({
      status: "ignored",
      reason: "Comment does not request @architect refine.",
    });
  }

  const targetRepoPath = req.body?.targetRepoPath || "";

  res.status(202).json({ status: "accepted", issueKey });

  void (async () => {
    const cfg = envConfig();
    const deps = createDependencies(cfg);
    try {
      console.log(`[hooks/jira/comment] architect refine start ${issueKey}`);
      await runArchitectRefineJob({
        jira: deps.jira,
        llm: deps.llm,
        issueKey,
        targetRepoPath,
        targetFallback: cfg.targetProjectPathFallback,
      });
      console.log(`[hooks/jira/comment] architect refine done ${issueKey}`);
    } catch (err) {
      console.error(`[hooks/jira/comment] architect refine failed ${issueKey}:`, err.message || err);
      await deps.jira.addCommentParagraphs(issueKey, `Architect refine failed: ${err.message}`).catch((postErr) => {
        console.error(`[hooks/jira/comment] could not post failure comment on ${issueKey}:`, postErr.message || postErr);
      });
    }
  })();
});

async function start() {
  await validateEnv();
  const config = envConfig();
  app.listen(config.port, () => {
    console.log(`iOS Agent Pipeline listening on :${config.port}`);
    console.log(`LLM provider: bedrock`);
    console.log(`Bedrock model: ${config.bedrockModelId}`);
    console.log("Jira architect refine webhook: POST /hooks/jira/comment");
  });
}

start().catch((error) => {
  console.error(`Startup failed: ${error.message}`);
  process.exit(1);
});
