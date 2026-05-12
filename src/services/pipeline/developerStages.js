import { jiraDescriptionPlain } from "../../jira/jiraDescriptionPlain.js";
import { stripAgentFolderLines } from "../agentFolderFromDescription.js";
import { resolveTargetRepoPath } from "../repoPath.js";
import { buildProjectContext } from "../projectContext.js";
import { runDeveloper, runDeveloperPlan, runDeveloperExecute } from "../../agents/developer.js";
import {
  serializeDeveloperPlanComment,
  fetchLatestDeveloperDraftFromComments,
} from "../developerDraftFromComments.js";

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
 * Developer plan only: posts one Jira comment (human plan + JSON draft). Next turn: @architect check plan (or POST /pipeline/architect-check-plan).
 */
export async function runDeveloperPlanPipeline({ llm, jira, issueKey, targetRepoPath, targetFallback }) {
  const resolvedRepoPath = await resolveTargetRepoPath(targetRepoPath || "", targetFallback);
  const issue = await jira.getIssue(issueKey);
  const context = await buildProjectContext(resolvedRepoPath);
  const storyScope = buildPlanningInputFromIssue(issue);

  const draft = await runDeveloperPlan({
    llm,
    issue,
    architectPlanText: storyScope,
    context,
  });

  const commentBody = serializeDeveloperPlanComment({ issueKey, draft });
  await jira.addComment(issueKey, commentBody);

  return {
    issueKey,
    targetRepoPath: resolvedRepoPath,
    ...draft,
  };
}

/**
 * After approved plan draft: reads latest developer plan from Jira comments, generates patch, posts implementation comment. No run-state file.
 */
export async function runDeveloperExecutePipeline({
  llm,
  jira,
  issueKey,
  targetRepoPath,
  targetFallback,
}) {
  const resolvedRepoPath = await resolveTargetRepoPath(targetRepoPath || "", targetFallback);
  const issue = await jira.getIssue(issueKey);
  const context = await buildProjectContext(resolvedRepoPath);
  const draft = await fetchLatestDeveloperDraftFromComments(jira, issueKey);
  if (!draft) {
    throw new Error(
      "No developer plan draft in Jira comments (missing pipeline marker). Run POST /pipeline/developer-plan (or @developer plan) first."
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
 * Single-call developer: one LLM, full JSON. Result only in HTTP response + Jira comment (no run-state).
 */
export async function runDeveloperFullPipeline({
  llm,
  jira,
  issueKey,
  targetRepoPath,
  targetFallback,
}) {
  const resolvedRepoPath = await resolveTargetRepoPath(targetRepoPath || "", targetFallback);
  const issue = await jira.getIssue(issueKey);
  const context = await buildProjectContext(resolvedRepoPath);
  const storyScope = buildPlanningInputFromIssue(issue);

  const developerResult = await runDeveloper({
    llm,
    issue,
    architectPlanText: storyScope,
    context,
  });

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
