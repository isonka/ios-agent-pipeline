import { jiraDescriptionPlain } from "../jira/jiraDescriptionPlain.js";
import { extractAgentFolderLine } from "../services/agentFolderFromDescription.js";
import { fetchLatestRefinedStoryPlain } from "../services/refinedStoryFromComments.js";
import { resolveTargetRepoPath } from "../services/repoPath.js";

/**
 * After @architect approved: copy latest "Refined story (claude.md: …)" comment body into issue description.
 * Preserves an existing `Agent folder: …` line at the top of the description when present.
 */
export async function runArchitectApprovedJob({ jira, issueKey, targetRepoPath, targetFallback }) {
  await resolveTargetRepoPath(targetRepoPath || "", targetFallback);
  const issue = await jira.getIssue(issueKey);
  const refinedPlain = await fetchLatestRefinedStoryPlain(jira, issueKey);
  if (!refinedPlain) {
    throw new Error(
      'No Jira comment starting with "Refined story (claude.md:" found. Run @architect refine (or the refine hook) first.'
    );
  }

  const currentPlain = jiraDescriptionPlain(issue.fields?.description);
  const folderLine = extractAgentFolderLine(currentPlain);
  const newDescription = folderLine ? `${folderLine}\n\n${refinedPlain}` : refinedPlain;

  await jira.updateIssueDescription(issueKey, newDescription);
  await jira.addCommentParagraphs(
    issueKey,
    "Architect **approved**: issue description was updated from the latest refined-story comment (Agent folder line kept when it was already in the description)."
  );
}
