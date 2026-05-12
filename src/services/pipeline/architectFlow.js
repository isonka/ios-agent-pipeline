import { buildIssueImplementationContext } from "../storyImplementationContext.js";
import { runArchitect } from "../../agents/architect.js";
import { buildUIKitToSwiftUISubtasks } from "./deterministicPlanner.js";
import { resolvePrimaryModule, isUIKitToSwiftUIMigrationStory } from "./moduleResolution.js";
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

  const resolvedModule = resolvePrimaryModule(issue, implementationContext);
  const architectResult = isUIKitToSwiftUIMigrationStory(issue)
    ? (() => {
        if (!resolvedModule.primary || resolvedModule.confidence === "low") {
          const topCandidates = (resolvedModule.ranked || [])
            .slice(0, 3)
            .map((item) => `${item.moduleName}:${item.score}`)
            .join(", ");
          throw new Error(
            `Low confidence module resolution for UIKit->SwiftUI story. ${resolvedModule.reason} Top candidates: ${topCandidates || "none"}`
          );
        }
        return buildUIKitToSwiftUISubtasks(issue, implementationContext, resolvedModule);
      })()
    : await runArchitect({
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
    moduleResolution: architectResult.moduleResolution || null,
    implementationContext,
    planItems,
  };
}
