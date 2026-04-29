import { buildProjectContext } from "../projectContext.js";
import {
  getArchitectMemoryRelativePath,
  loadArchitectMemory,
  saveArchitectMemory,
} from "../architectMemory.js";
import { generateArchitectMemory, runArchitect } from "../../agents/architect.js";

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
  architectMemory,
  jiraSubtaskTargetStatus,
}) {
  const architectResult = await runArchitect({
    llm,
    issue,
    architectMemory,
  });

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
    createdSubtasks,
  };
}
