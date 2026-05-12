import { jiraDescriptionPlain } from "../../jira/jiraDescriptionPlain.js";
import { stripAgentFolderLines } from "../agentFolderFromDescription.js";
import { resolveTargetRepoPath } from "../repoPath.js";
import { buildProjectContext } from "../projectContext.js";
import { loadRunState, saveRunState } from "../runStore.js";
import { runDeveloper, runDeveloperPlan, runDeveloperExecute } from "../../agents/developer.js";

/**
 * Planning text for developer LLM: **Jira description only** (summary + description with Agent folder line stripped).
 * Refined story must live in the issue description (use @architect approved after refine).
 */
export function buildPlanningInputFromIssue(issue) {
  const summary = String(issue?.fields?.summary || "").trim();
  const descPlain = stripAgentFolderLines(jiraDescriptionPlain(issue?.fields?.description)).trim();
  if (!summary && !descPlain) {
    throw new Error(
      "Issue has empty summary and description. Add Jira fields, or run @architect refine then @architect approved to copy the refined story into the description."
    );
  }

  return [
    "Planning input: Jira summary + description (issue description; routing line removed when present).",
    "",
    "**Summary**",
    summary || "(none)",
    "",
    "**Description**",
    descPlain || "(none)",
  ].join("\n");
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
  const storyScope = buildPlanningInputFromIssue(issue);

  const draft = await runDeveloperPlan({
    llm,
    issue,
    architectPlanText: storyScope,
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

  const storyScope = buildPlanningInputFromIssue(issue);

  const executeResult = await runDeveloperExecute({
    llm,
    issue,
    architectPlanText: storyScope,
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
 * Single-call developer: one LLM, full JSON.
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
  const storyScope = buildPlanningInputFromIssue(issue);

  const developerResult = await runDeveloper({
    llm,
    issue,
    architectPlanText: storyScope,
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
    `Developer output for ${issueKey}.\n\n${developerResult.implementationPlan || ""}`
  );

  return {
    issueKey,
    targetRepoPath: resolvedRepoPath,
    ...developerResult,
  };
}
