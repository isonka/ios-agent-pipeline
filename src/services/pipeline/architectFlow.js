import { buildProjectContext } from "../projectContext.js";
import {
  getArchitectMemoryRelativePath,
  loadArchitectMemory,
  saveArchitectMemory,
} from "../architectMemory.js";
import { buildIssueImplementationContext } from "../storyImplementationContext.js";
import { generateArchitectMemory, runArchitect } from "../../agents/architect.js";

function normalizePath(pathValue) {
  return String(pathValue || "").trim().toLowerCase();
}

function mergeImplementationSignals(existingMemoryContent, implementationContext, issueKey) {
  const existingSignals = Array.isArray(existingMemoryContent?.implementationSignals)
    ? existingMemoryContent.implementationSignals
    : [];
  const existingPaths = new Set(existingSignals.map((item) => normalizePath(item.path)));

  const newSignals = [];
  for (const match of implementationContext.matches || []) {
    const normalizedPath = normalizePath(match.path);
    if (!normalizedPath || existingPaths.has(normalizedPath)) continue;
    existingPaths.add(normalizedPath);
    newSignals.push({
      path: match.path,
      reason: match.reason,
      learnedFromIssue: issueKey,
      learnedAt: new Date().toISOString(),
    });
  }

  if (!newSignals.length) {
    return {
      mergedContent: existingMemoryContent,
      updated: false,
      addedSignals: 0,
    };
  }

  return {
    mergedContent: {
      ...existingMemoryContent,
      implementationSignals: [...existingSignals, ...newSignals],
    },
    updated: true,
    addedSignals: newSignals.length,
  };
}

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

  const architectResult = await runArchitect({
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
    const created = await jira.createSubtask(issue.key, subtask.title, subtask.body);
    if (jiraSubtaskTargetStatus) {
      await jira.transitionIssueToStatus(created.key, jiraSubtaskTargetStatus);
    }
    createdSubtasks.push({ key: created.key, title: subtask.title, body: subtask.body });
  }

  return {
    summary: architectResult.summary,
    implementationContext,
    architectMemoryUpdated,
    architectMemoryAddedSignals,
    createdSubtasks,
  };
}
