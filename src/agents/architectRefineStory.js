const SYSTEM_PROMPT =
  "You are a senior product architect for a software team. Write clear, actionable story text. " +
  "Do not mention that you are an AI. Output markdown only (no JSON, no fenced code block wrapping the whole answer).";

export function shouldTriggerArchitectRefineFromComment(commentBody) {
  const text = String(commentBody || "").toLowerCase();
  if (!text.includes("@architect")) return false;
  if (!/\brefine\b/.test(text)) return false;
  return true;
}

export async function refineStoryFromClaudeMd({
  llm,
  issueSummary,
  issueDescriptionPlain,
  claudeMdContent,
  claudeRelativePath,
}) {
  const userPrompt = [
    "Refine the Jira story using the repository claude.md file as extra product/engineering context.",
    "",
    "--- Jira summary ---",
    String(issueSummary || "").trim() || "(none)",
    "",
    "--- Jira description (plain text, includes Agent folder line) ---",
    String(issueDescriptionPlain || "").trim() || "(empty)",
    "",
    `--- File: ${claudeRelativePath} ---`,
    String(claudeMdContent || "").trim() || "(empty)",
    "",
    "Output requirements:",
    "- Markdown only.",
    "- Use these sections in order: ## Refined summary, ## Goal, ## Scope, ## Acceptance criteria, ## Out of scope / assumptions, ## Risks or open questions.",
    "- Ground statements in the Jira text and claude.md; do not invent product facts that are not supported by those sources.",
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
