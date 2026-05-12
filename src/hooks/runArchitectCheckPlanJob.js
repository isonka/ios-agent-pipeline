import { runArchitectReviewDeveloperPlan } from "../agents/architectDeveloperPlanReview.js";
import { fetchLatestDeveloperDraftFromComments } from "../services/developerDraftFromComments.js";
import { buildPlanningInputFromIssue } from "../services/pipeline/developerStages.js";
import { resolveTargetRepoPath } from "../services/repoPath.js";

/**
 * Explicit turn: architect reviews the latest developer plan from Jira comments (@architect check plan).
 * Posts APPROVE/REJECT only — does not run developer-execute or architect-approved.
 */
export async function runArchitectCheckPlanJob({ jira, llm, issueKey, targetRepoPath, targetFallback }) {
  await resolveTargetRepoPath(targetRepoPath || "", targetFallback);
  const issue = await jira.getIssue(issueKey);
  const storyScope = buildPlanningInputFromIssue(issue);

  const draft = await fetchLatestDeveloperDraftFromComments(jira, issueKey);
  if (!draft) {
    throw new Error(
      "No developer plan draft in Jira comments. Run developer-plan (or @developer plan) first so a plan comment with the pipeline JSON marker exists."
    );
  }

  const review = await runArchitectReviewDeveloperPlan({
    llm,
    issue,
    storyScope,
    developerDraft: draft,
  });

  const reviewComment = [
    `Architect **check plan** (${issueKey}): **${review.decision.toUpperCase()}**`,
    "",
    review.reason || "(no reason given)",
    "",
    review.decision === "approve"
      ? "Next turn: run **developer-execute** (or `@developer` + plan approved + start implementation) when you want the patch."
      : "Next turn: revise the story or plan, then run **developer-plan** again.",
  ].join("\n");
  await jira.addCommentParagraphs(issueKey, reviewComment);

  return review;
}
