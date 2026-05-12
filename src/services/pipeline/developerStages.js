import { jiraDescriptionPlain } from "../../jira/jiraDescriptionPlain.js";
import { stripAgentFolderLines } from "../agentFolderFromDescription.js";
import { resolveTargetRepoPath } from "../repoPath.js";
import { buildProjectContext } from "../projectContext.js";
import { runDeveloper, runDeveloperPlan, runDeveloperExecute } from "../../agents/developer.js";
import { runArchitectReviewDeveloperPlan } from "../../agents/architectDeveloperPlanReview.js";
import {
  serializeDeveloperPlanComment,
  fetchLatestDeveloperDraftFromComments,
} from "../developerDraftFromComments.js";
import { runArchitectApprovedJob } from "../../hooks/runArchitectApprovedJob.js";

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
 * Developer plan only: posts plan Jira comment, runs architect review of that plan; on approve chains developer-execute (same as manual approve+implementation).
 *
 * @param {object} [options]
 * @param {boolean} [options.skipArchitectReview] default false — if true, only posts plan (no review / no auto-execute).
 * @param {boolean} [options.autoExecuteOnArchitectApprove] default true — if architect approves, run developer-execute automatically.
 * @param {boolean} [options.autoArchitectApprovedOnPlanReview] default true — if architect approves, also run the same work as `POST /pipeline/architect-approved` (refine comment → description) before implementation; failures are skipped with a Jira note so implementation still runs.
 */
export async function runDeveloperPlanPipeline({
  llm,
  jira,
  issueKey,
  targetRepoPath,
  targetFallback,
  options = {},
}) {
  const {
    skipArchitectReview = false,
    autoExecuteOnArchitectApprove = true,
    autoArchitectApprovedOnPlanReview = true,
  } = options;

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

  const baseReturn = {
    issueKey,
    targetRepoPath: resolvedRepoPath,
    ...draft,
    architectReview: null,
    developerExecute: null,
  };

  if (skipArchitectReview) {
    return baseReturn;
  }

  const review = await runArchitectReviewDeveloperPlan({
    llm,
    issue,
    storyScope,
    developerDraft: draft,
  });

  const reviewComment = [
    `Architect **review** (developer plan for ${issueKey}): **${review.decision.toUpperCase()}**`,
    "",
    review.reason || "(no reason given)",
    "",
    review.decision === "approve" && autoExecuteOnArchitectApprove
      ? "Proceeding to **developer implementation** automatically."
      : review.decision === "approve"
        ? "Architect approved; set `autoExecuteOnArchitectApprove` or call `POST /pipeline/developer-execute` to generate the patch."
        : "Revise the plan or story and run developer-plan again when ready (or call developer-execute manually only if you accept the risk).",
  ].join("\n");
  await jira.addCommentParagraphs(issueKey, reviewComment);

  baseReturn.architectReview = review;

  if (review.decision === "approve" && autoExecuteOnArchitectApprove) {
    if (autoArchitectApprovedOnPlanReview) {
      try {
        await runArchitectApprovedJob({
          jira,
          issueKey,
          targetRepoPath,
          targetFallback,
        });
      } catch (syncErr) {
        await jira.addCommentParagraphs(
          issueKey,
          `Note: automatic **architect-approved** (copy latest refine comment into description) was skipped: ${syncErr.message}`
        );
      }
    }
    baseReturn.developerExecute = await runDeveloperExecutePipeline({
      llm,
      jira,
      issueKey,
      targetRepoPath,
      targetFallback,
    });
  }

  return baseReturn;
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
