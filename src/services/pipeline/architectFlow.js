import { buildProjectContext } from "../projectContext.js";
import {
  getArchitectMemoryRelativePath,
  loadArchitectMemory,
  saveArchitectMemory,
} from "../architectMemory.js";
import { buildIssueImplementationContext } from "../storyImplementationContext.js";
import { generateArchitectMemory, runArchitect } from "../../agents/architect.js";
import { buildUIKitToSwiftUISubtasks } from "./deterministicPlanner.js";
import { mergeImplementationSignals } from "./memorySignals.js";
import { resolvePrimaryModule, isUIKitToSwiftUIMigrationStory } from "./moduleResolution.js";
import { formatSubtaskDescription } from "./subtaskDescription.js";

export async function ensureArchitectMemory({
  llm,
  targetRepoPath,
  forceRegenerate = false,
}) {
  if (!forceRegenerate) {
    const existingMemory = await loadArchitectMemory(targetRepoPath);
    if (existingMemory) {
      return {
        architectMemory: existingMemory.content,
        architectMemoryGenerated: false,
        architectMemoryPath: getArchitectMemoryRelativePath(),
      };
    }
  }

  const context = await buildProjectContext(targetRepoPath);
  const generatedMemory = await generateArchitectMemory({
    llm,
    context,
  });
  const architectMemory = {
    generatedAt: new Date().toISOString(),
    sourceDocuments: context.docPaths,
    content: generatedMemory,
  };
  await saveArchitectMemory(targetRepoPath, architectMemory);

  return {
    architectMemory: architectMemory.content,
    architectMemoryGenerated: true,
    architectMemoryPath: getArchitectMemoryRelativePath(),
  };
}

export async function createArchitectSubtasks({
  llm,
  jira,
  issue,
  targetRepoPath,
  architectMemory,
  architectMemoryPath,
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
          throw new Error(
            `Low confidence module resolution for UIKit->SwiftUI story. ${resolvedModule.reason}`
          );
        }
        return buildUIKitToSwiftUISubtasks(issue, implementationContext, resolvedModule);
      })()
    : await runArchitect({
        llm,
        issue,
        architectMemory,
        implementationContext,
      });

  let architectMemoryUpdated = false;
  let architectMemoryAddedSignals = 0;
  if (architectMemoryPath) {
    const persistedMemory = await loadArchitectMemory(targetRepoPath);
    if (persistedMemory?.content) {
      const mergeResult = mergeImplementationSignals(
        persistedMemory.content,
        implementationContext,
        issue.key
      );
      architectMemoryUpdated = mergeResult.updated;
      architectMemoryAddedSignals = mergeResult.addedSignals;
      if (mergeResult.updated) {
        await saveArchitectMemory(targetRepoPath, {
          ...persistedMemory,
          content: mergeResult.mergedContent,
          updatedAt: new Date().toISOString(),
        });
      }
    }
  }

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
    architectMemoryUpdated,
    architectMemoryAddedSignals,
    createdSubtasks,
  };
}
