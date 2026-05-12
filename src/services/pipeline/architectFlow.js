import { buildIssueImplementationContext } from "../storyImplementationContext.js";
import { runArchitect } from "../../agents/architect.js";
import { buildUIKitToSwiftUISubtasks } from "./deterministicPlanner.js";
import { resolvePrimaryModule, isUIKitToSwiftUIMigrationStory } from "./moduleResolution.js";
import { formatSubtaskDescription } from "./subtaskDescription.js";

export async function createArchitectSubtasks({
  llm,
  jira,
  issue,
  targetRepoPath,
  jiraSubtaskTargetStatus,
}) {
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

  const createdSubtasks = [];
  for (const subtask of architectResult.subtasks) {
    const description = formatSubtaskDescription(subtask);
    const created = await jira.createSubtask(issue.key, subtask.title, description);
    if (jiraSubtaskTargetStatus) {
      await jira.transitionIssueToStatus(created.key, jiraSubtaskTargetStatus);
    }
    createdSubtasks.push({
      key: created.key,
      title: subtask.title,
      body: subtask.body,
      storyPoints: subtask.storyPoints,
      changedFiles: subtask.changedFiles,
      suggestedSkill: subtask.suggestedSkill,
    });
  }

  return {
    summary: architectResult.summary,
    moduleResolution: architectResult.moduleResolution || null,
    implementationContext,
    createdSubtasks,
  };
}
