import { jiraDescriptionPlain } from "../jira/jiraDescriptionPlain.js";

const REFINE_COMMENT_MARK = /refined story \(claude\.md:/i;

/**
 * Plain text body of the newest Jira comment that matches @architect refine output (header line stripped).
 */
export async function fetchLatestRefinedStoryPlain(jira, issueKey) {
  const data = await jira.listIssueComments(issueKey);
  const comments = Array.isArray(data?.comments) ? data.comments : [];
  const sorted = [...comments].sort((a, b) => new Date(b.created || 0) - new Date(a.created || 0));
  for (const c of sorted) {
    const plain = jiraDescriptionPlain(c.body).trim();
    if (REFINE_COMMENT_MARK.test(plain)) {
      return plain.replace(/^Refined story \(claude\.md:[^\n]+\)\s*/i, "").trim() || plain;
    }
  }
  return "";
}
