import { buildIssueImplementationContext } from "../storyImplementationContext.js";
import { runArchitect } from "../../agents/architect.js";
import { formatSubtaskDescription } from "./subtaskDescription.js";

function buildArchitectPlanComment(summary, planItems) {
  const blocks = [`## Architect plan`, "", `**Summary:** ${summary || "(none)"}`, ""];
  for (const [index, item] of planItems.entries()) {
    blocks.push(`### ${index + 1}. ${item.title}`, "", formatSubtaskDescription(item), "");
  }
  return blocks.join("\n").trim();
}

/**
 * Runs architect on the parent Jira issue only (no Sub-task issues).
 * Persists a structured plan in the API response / run state; posts one comment on the issue.
 */
export async function runArchitectForIssue({ llm, jira, issue, targetRepoPath }) {
  const implementationContext = await buildIssueImplementationContext({
    targetRepoPath,
    issue,
  });
  if (!Array.isArray(implementationContext.matches) || implementationContext.matches.length === 0) {
    throw new Error(
      "Architect could not map this story to concrete implementation files. Refine issue summary/description and retry."
    );
  }

  const architectResult = await runArchitect({
    llm,
    issue,
    implementationContext,
  });

  const planItems = (architectResult.subtasks || []).map((subtask) => ({
    title: subtask.title,
    body: subtask.body,
    storyPoints: subtask.storyPoints,
    changedFiles: [...(subtask.changedFiles || [])],
    suggestedSkill: subtask.suggestedSkill ?? null,
  }));

  const comment = buildArchitectPlanComment(architectResult.summary, planItems);
  await jira.addCommentParagraphs(issue.key, comment);

  return {
    summary: architectResult.summary,
    implementationContext,
    planItems,
  };
}
