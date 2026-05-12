const SYSTEM_PROMPT =
  "You refine Jira user stories. You only read two inputs: Story (from Jira) and Context (from claude.md). " +
  "Output markdown only. Be direct and concise. Do not mention claude.md or Jira. No JSON.";

export function shouldTriggerArchitectRefineFromComment(commentBody) {
  const text = String(commentBody || "").toLowerCase();
  if (!text.includes("@architect")) return false;
  if (!/\brefine\b/.test(text)) return false;
  return true;
}

/**
 * @param {object} params
 * @param {object} params.llm
 * @param {string} [params.issueSummary] Jira summary
 * @param {string} [params.issueDescriptionPlain] Jira description (Agent folder line already removed)
 * @param {string} [params.claudeMdContent] Full claude.md text — sole engineering/product context
 */
export async function refineStoryFromClaudeMd({
  llm,
  issueSummary,
  issueDescriptionPlain,
  claudeMdContent,
}) {
  const summary = String(issueSummary || "").trim() || "(none)";
  const storyBody = String(issueDescriptionPlain || "").trim() || "(none)";
  const context = String(claudeMdContent || "").trim() || "(empty)";

  const userPrompt = [
    "STORY",
    summary,
    "",
    storyBody,
    "",
    "CONTEXT",
    context,
    "",
    "Rewrite STORY into one refined user story (markdown). Use CONTEXT only where it clarifies scope, constraints, or terminology. Do not invent requirements beyond STORY and CONTEXT.",
  ].join("\n");

  const text = await llm.generateText({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    temperature: 0,
  });

  const trimmed = String(text || "").trim();
  if (!trimmed) {
    throw new Error("Architect refine returned empty content.");
  }
  return trimmed;
}
