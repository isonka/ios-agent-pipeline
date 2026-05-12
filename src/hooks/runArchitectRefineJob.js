import { refineStoryFromClaudeMd } from "../agents/architectRefineStory.js";
import { jiraDescriptionPlain } from "../jira/jiraDescriptionPlain.js";
import { extractAgentFolderRelPath } from "../services/agentFolderFromDescription.js";
import { loadClaudeMdFromRepoFolder } from "../services/claudeMdLoader.js";
import { resolveTargetRepoPath } from "../services/repoPath.js";

export async function runArchitectRefineJob({
  jira,
  llm,
  issueKey,
  targetRepoPath,
  targetFallback,
}) {
  const resolvedRepoPath = await resolveTargetRepoPath(targetRepoPath || "", targetFallback);
  const issue = await jira.getIssue(issueKey);
  const descPlain = jiraDescriptionPlain(issue.fields?.description);
  const folder = extractAgentFolderRelPath(descPlain);
  if (!folder) {
    throw new Error(
      "Add a line to the issue description: Agent folder: <relative/path/from/repo/root> (expects claude.md in that folder)."
    );
  }

  const { content, claudeRelativePath } = await loadClaudeMdFromRepoFolder({
    repoRoot: resolvedRepoPath,
    folderRel: folder,
  });

  const refined = await refineStoryFromClaudeMd({
    llm,
    issueSummary: issue.fields?.summary,
    issueDescriptionPlain: descPlain,
    claudeMdContent: content,
    claudeRelativePath,
  });

  const header = `Architect refined story (source: ${claudeRelativePath})\n\n`;
  await jira.addCommentParagraphs(issue.key, `${header}${refined}`);
}
