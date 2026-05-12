import { resolveTargetRepoPath } from "../repoPath.js";
import { buildProjectContext } from "../projectContext.js";
import { loadRunState, saveRunState } from "../runStore.js";
import { runDeveloper, runDeveloperPlan, runDeveloperExecute } from "../../agents/developer.js";

export function formatPlanItemsForDeveloperPrompt(planItems) {
  if (!Array.isArray(planItems) || planItems.length === 0) {
    return "(No architect plan in run state. POST /pipeline/create-subtasks for this issue first.)";
  }
  return planItems
    .map((item, index) => {
      const files = (item.changedFiles || []).map((filePath) => `- ${filePath}`).join("\n");
      return [
        `[${index + 1}] ${item.title}`,
        item.body || "",
        `storyPoints: ${item.storyPoints}`,
        "changedFiles:",
        files || "- (none)",
        item.suggestedSkill ? `suggestedSkill: ${item.suggestedSkill}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n---\n\n");
}

function missingArchitectPlanMessage(architectPlanText) {
  return (
    typeof architectPlanText === "string" &&
    architectPlanText.includes("No architect plan in run state")
  );
}

/**
 * Developer plan only: saves `developerDraft`, posts Jira summary comment.
 */
export async function runDeveloperPlanPipeline({
  llm,
  jira,
  runStateDir,
  issueKey,
  targetRepoPath,
  targetFallback,
}) {
  const resolvedRepoPath = await resolveTargetRepoPath(targetRepoPath || "", targetFallback);
  const issue = await jira.getIssue(issueKey);
  const context = await buildProjectContext(resolvedRepoPath);
  const runState = await loadRunState(runStateDir, issueKey);
  const architectPlanText = formatPlanItemsForDeveloperPrompt(runState?.architect?.planItems);
  if (missingArchitectPlanMessage(architectPlanText)) {
    throw new Error("No architect planItems in run state. Run POST /pipeline/create-subtasks for this issue first.");
  }

  const draft = await runDeveloperPlan({
    llm,
    issue,
    architectPlanText,
    context,
  });

  const updatedState = {
    ...(runState || {}),
    issueKey,
    targetRepoPath: resolvedRepoPath,
    developerDraft: {
      implementationPlan: draft.implementationPlan,
      riskNotes: draft.riskNotes,
      testStubs: draft.testStubs,
      draftedAt: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  };
  await saveRunState(runStateDir, issueKey, updatedState);

  const body = [
    `Developer **plan** (draft) for ${issueKey}`,
    "",
    draft.implementationPlan || "",
    "",
    "_(Approve with a comment containing: `@developer` **plan is approved** **start implementation**)_",
  ].join("\n");
  await jira.addCommentParagraphs(issueKey, body);

  return {
    issueKey,
    targetRepoPath: resolvedRepoPath,
    ...draft,
  };
}

/**
 * After approved plan draft: generates patch, saves `developer`, clears `developerDraft`.
 */
export async function runDeveloperExecutePipeline({
  llm,
  jira,
  runStateDir,
  issueKey,
  targetRepoPath,
  targetFallback,
}) {
  const resolvedRepoPath = await resolveTargetRepoPath(targetRepoPath || "", targetFallback);
  const issue = await jira.getIssue(issueKey);
  const context = await buildProjectContext(resolvedRepoPath);
  const runState = await loadRunState(runStateDir, issueKey);
  const draft = runState?.developerDraft;
  if (!draft || typeof draft.implementationPlan !== "string" || !draft.implementationPlan.trim()) {
    throw new Error(
      "No developer plan draft. Run POST /pipeline/developer-plan (or Jira comment with @developer and plan) first."
    );
  }

  const architectPlanText = formatPlanItemsForDeveloperPrompt(runState?.architect?.planItems);
  if (missingArchitectPlanMessage(architectPlanText)) {
    throw new Error("No architect planItems in run state. Run POST /pipeline/create-subtasks for this issue first.");
  }

  const executeResult = await runDeveloperExecute({
    llm,
    issue,
    architectPlanText,
    developerDraft: draft,
    context,
  });

  const mergedDeveloper = {
    implementationPlan: draft.implementationPlan,
    riskNotes: draft.riskNotes,
    testStubs: draft.testStubs,
    patchProposal: executeResult.patchProposal,
  };

  const updatedState = {
    ...(runState || {}),
    issueKey,
    targetRepoPath: resolvedRepoPath,
    developer: mergedDeveloper,
    developerDraft: null,
    updatedAt: new Date().toISOString(),
  };
  await saveRunState(runStateDir, issueKey, updatedState);

  await jira.addCommentParagraphs(
    issueKey,
    [
      `Developer **implementation** for ${issueKey}`,
      "",
      mergedDeveloper.implementationPlan || "",
      "",
      mergedDeveloper.patchProposal
        ? "```diff\n" + String(mergedDeveloper.patchProposal).slice(0, 12000) + "\n```"
        : "(no patchProposal)",
    ].join("\n")
  );

  return {
    issueKey,
    targetRepoPath: resolvedRepoPath,
    ...mergedDeveloper,
  };
}

/**
 * Single-call developer (legacy / quick path): one LLM, full JSON.
 */
export async function runDeveloperFullPipeline({
  llm,
  jira,
  runStateDir,
  issueKey,
  targetRepoPath,
  targetFallback,
}) {
  const resolvedRepoPath = await resolveTargetRepoPath(targetRepoPath || "", targetFallback);
  const issue = await jira.getIssue(issueKey);
  const context = await buildProjectContext(resolvedRepoPath);
  const runState = await loadRunState(runStateDir, issueKey);
  const architectPlanText = formatPlanItemsForDeveloperPrompt(runState?.architect?.planItems);

  const developerResult = await runDeveloper({
    llm,
    issue,
    architectPlanText,
    context,
  });

  const updatedState = {
    ...(runState || {}),
    issueKey,
    targetRepoPath: resolvedRepoPath,
    developer: { ...developerResult },
    developerDraft: null,
    updatedAt: new Date().toISOString(),
  };
  await saveRunState(runStateDir, issueKey, updatedState);

  await jira.addComment(
    issueKey,
    `Developer output for ${issueKey} (uses architect plan from run state).\n\n${developerResult.implementationPlan || ""}`
  );

  return {
    issueKey,
    targetRepoPath: resolvedRepoPath,
    ...developerResult,
  };
}
