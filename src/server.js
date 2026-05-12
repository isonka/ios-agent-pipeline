import express from "express";

import { validateEnv, envConfig } from "./config/env.js";
import { resolveTargetRepoPath } from "./services/repoPath.js";
import { buildProjectContext } from "./services/projectContext.js";
import { loadRunState, saveRunState } from "./services/runStore.js";
import {
  runDeveloperFullPipeline,
  runDeveloperPlanPipeline,
  runDeveloperExecutePipeline,
} from "./services/pipeline/developerStages.js";
import { BedrockClaudeClient } from "./llm/bedrockClaude.js";
import { JiraClient } from "./integrations/jiraClient.js";
import { runTester } from "./agents/tester.js";
import { runReviewer } from "./agents/reviewer.js";
import { resolveJiraCommentHook } from "./agents/jiraCommentHooks.js";
import { runArchitectRefineJob } from "./hooks/runArchitectRefineJob.js";
import { runArchitectApprovedJob } from "./hooks/runArchitectApprovedJob.js";
import { runArchitectCheckPlanJob } from "./hooks/runArchitectCheckPlanJob.js";

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

/** One LLM call: plan + patch together (quick / legacy). */
app.post("/pipeline/run-developer", async (req, res) => {
  try {
    const { issueKey, targetRepoPath } = req.body || {};
    if (!issueKey) return jsonError(res, 400, "issueKey is required");

    const config = envConfig();
    const deps = createDependencies(config);
    const result = await runDeveloperFullPipeline({
      llm: deps.llm,
      jira: deps.jira,
      issueKey,
      targetRepoPath,
      targetFallback: config.targetProjectPathFallback,
    });

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** Step 1 of 2: developer plan draft (manual curl / same logic as hook). */
app.post("/pipeline/developer-plan", async (req, res) => {
  try {
    const { issueKey, targetRepoPath } = req.body || {};
    if (!issueKey) return jsonError(res, 400, "issueKey is required");

    const config = envConfig();
    const deps = createDependencies(config);
    const result = await runDeveloperPlanPipeline({
      llm: deps.llm,
      jira: deps.jira,
      issueKey,
      targetRepoPath,
      targetFallback: config.targetProjectPathFallback,
    });

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** Architect reviews latest developer plan comment (@architect check plan). */
app.post("/pipeline/architect-check-plan", async (req, res) => {
  try {
    const { issueKey, targetRepoPath } = req.body || {};
    if (!issueKey) return jsonError(res, 400, "issueKey is required");

    const config = envConfig();
    const deps = createDependencies(config);
    const review = await runArchitectCheckPlanJob({
      jira: deps.jira,
      llm: deps.llm,
      issueKey,
      targetRepoPath,
      targetFallback: config.targetProjectPathFallback,
    });

    res.status(200).json({ issueKey, ...review });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** Copy latest refine comment into issue description (same as hook @architect approved). */
app.post("/pipeline/architect-approved", async (req, res) => {
  try {
    const { issueKey, targetRepoPath } = req.body || {};
    if (!issueKey) return jsonError(res, 400, "issueKey is required");

    const config = envConfig();
    const deps = createDependencies(config);
    await runArchitectApprovedJob({
      jira: deps.jira,
      issueKey,
      targetRepoPath,
      targetFallback: config.targetProjectPathFallback,
    });

    res.status(200).json({ issueKey, status: "description_updated" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** Step 2 of 2: patch after approved draft (manual curl / same logic as hook). */
app.post("/pipeline/developer-execute", async (req, res) => {
  try {
    const { issueKey, targetRepoPath } = req.body || {};
    if (!issueKey) return jsonError(res, 400, "issueKey is required");

    const config = envConfig();
    const deps = createDependencies(config);
    const result = await runDeveloperExecutePipeline({
      llm: deps.llm,
      jira: deps.jira,
      issueKey,
      targetRepoPath,
      targetFallback: config.targetProjectPathFallback,
    });

    res.status(200).json(result);
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

  const hook = resolveJiraCommentHook(commentBody);
  if (!hook) {
    return res.status(200).json({
      status: "ignored",
      reason:
        "No matching command. Expected @architect refine, @architect check plan, @architect approved, @developer plan, or @developer plan is approved + start implementation.",
    });
  }

  const targetRepoPath = req.body?.targetRepoPath || "";

  res.status(202).json({ status: "accepted", issueKey, hook });

  void (async () => {
    const cfg = envConfig();
    const deps = createDependencies(cfg);
    const logPrefix = `[hooks/jira/comment] ${hook} ${issueKey}`;
    try {
      console.log(`${logPrefix} start`);
      if (hook === "architect_refine") {
        await runArchitectRefineJob({
          jira: deps.jira,
          llm: deps.llm,
          issueKey,
          targetRepoPath,
          targetFallback: cfg.targetProjectPathFallback,
        });
      } else if (hook === "architect_check_plan") {
        await runArchitectCheckPlanJob({
          jira: deps.jira,
          llm: deps.llm,
          issueKey,
          targetRepoPath,
          targetFallback: cfg.targetProjectPathFallback,
        });
      } else if (hook === "architect_approved") {
        await runArchitectApprovedJob({
          jira: deps.jira,
          issueKey,
          targetRepoPath,
          targetFallback: cfg.targetProjectPathFallback,
        });
      } else if (hook === "developer_plan") {
        await runDeveloperPlanPipeline({
          llm: deps.llm,
          jira: deps.jira,
          issueKey,
          targetRepoPath,
          targetFallback: cfg.targetProjectPathFallback,
        });
      } else if (hook === "developer_execute") {
        await runDeveloperExecutePipeline({
          llm: deps.llm,
          jira: deps.jira,
          issueKey,
          targetRepoPath,
          targetFallback: cfg.targetProjectPathFallback,
        });
      }
      console.log(`${logPrefix} done`);
    } catch (err) {
      console.error(`${logPrefix} failed:`, err.message || err);
      await deps.jira.addCommentParagraphs(issueKey, `${hook} failed: ${err.message}`).catch((postErr) => {
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
    console.log(
      "Jira comment hook: POST /hooks/jira/comment — @architect refine | @architect check plan | @architect approved | @developer plan | @developer plan is approved start implementation"
    );
  });
}

start().catch((error) => {
  console.error(`Startup failed: ${error.message}`);
  process.exit(1);
});
