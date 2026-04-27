import express from "express";

import { validateEnv, envConfig } from "./config/env.js";
import { resolveTargetRepoPath } from "./services/repoPath.js";
import { buildProjectContext } from "./services/projectContext.js";
import { loadRunState, saveRunState } from "./services/runStore.js";
import { BedrockClaudeClient } from "./llm/bedrockClaude.js";
import { JiraClient } from "./integrations/jiraClient.js";
import { runArchitect } from "./agents/architect.js";
import { runDeveloper } from "./agents/developer.js";
import { runTester } from "./agents/tester.js";
import { runReviewer } from "./agents/reviewer.js";

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

async function loadIssueAndContext({ jira, issueKey, targetFallback }) {
  const resolvedRepoPath = await resolveTargetRepoPath("", targetFallback);
  const [issue, context] = await Promise.all([
    jira.getIssue(issueKey),
    buildProjectContext(resolvedRepoPath),
  ]);
  return { issue, context, resolvedRepoPath };
}

app.post("/pipeline/create-subtasks", async (req, res) => {
  try {
    const { issueKey } = req.body || {};
    if (!issueKey) return jsonError(res, 400, "issueKey is required");

    const config = envConfig();
    const deps = createDependencies(config);
    const { issue, context, resolvedRepoPath } = await loadIssueAndContext({
      jira: deps.jira,
      issueKey,
      targetFallback: config.targetProjectPathFallback,
    });

    const architectResult = await runArchitect({
      llm: deps.llm,
      issue,
      context,
    });

    const createdSubtasks = [];
    for (const subtask of architectResult.subtasks) {
      const created = await deps.jira.createSubtask(issue.key, subtask.title, subtask.body);
      createdSubtasks.push({ key: created.key, title: subtask.title, body: subtask.body });
    }

    await saveRunState(config.runStateDir, issue.key, {
      issueKey: issue.key,
      targetRepoPath: resolvedRepoPath,
      architect: architectResult,
      subtasks: createdSubtasks,
      updatedAt: new Date().toISOString(),
    });

    await deps.jira.addComment(
      issue.key,
      `Architect created ${createdSubtasks.length} subtasks for ${issue.key}.\nTarget repo: ${resolvedRepoPath}`
    );

    res.status(200).json({
      issueKey: issue.key,
      targetRepoPath: resolvedRepoPath,
      summary: architectResult.summary,
      subtasks: createdSubtasks,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/pipeline/run-developer", async (req, res) => {
  try {
    const { issueKey, subtaskKey } = req.body || {};
    if (!issueKey) return jsonError(res, 400, "issueKey is required");
    if (!subtaskKey) return jsonError(res, 400, "subtaskKey is required");

    const config = envConfig();
    const deps = createDependencies(config);
    const { issue, context, resolvedRepoPath } = await loadIssueAndContext({
      jira: deps.jira,
      issueKey,
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
    const { issueKey, diff } = req.body || {};
    if (!issueKey) return jsonError(res, 400, "issueKey is required");
    if (!diff) return jsonError(res, 400, "diff is required");

    const config = envConfig();
    const deps = createDependencies(config);
    const { context, resolvedRepoPath } = await loadIssueAndContext({
      jira: deps.jira,
      issueKey,
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
    const { issueKey, diff } = req.body || {};
    if (!issueKey) return jsonError(res, 400, "issueKey is required");
    if (!diff) return jsonError(res, 400, "diff is required");

    const config = envConfig();
    const deps = createDependencies(config);
    const resolvedRepoPath = await resolveTargetRepoPath("", config.targetProjectPathFallback);
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

async function start() {
  await validateEnv();
  const config = envConfig();
  app.listen(config.port, () => {
    console.log(`iOS Agent Pipeline listening on :${config.port}`);
    console.log(`LLM provider: bedrock`);
    console.log(`Bedrock model: ${config.bedrockModelId}`);
  });
}

start().catch((error) => {
  console.error(`Startup failed: ${error.message}`);
  process.exit(1);
});
