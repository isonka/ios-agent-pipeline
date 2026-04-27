function buildReviewerPrompt({ issueKey, diff, testerReport }) {
  return [
    `Issue: ${issueKey}`,
    "",
    "Diff:",
    diff,
    "",
    "Tester report:",
    JSON.stringify(testerReport, null, 2),
    "",
    "Return JSON with schema:",
    "{",
    '  "verdict": "APPROVE|REQUEST_CHANGES",',
    '  "summary": "short review summary",',
    '  "requiredChanges": ["..."]',
    "}",
  ].join("\n");
}

export async function runReviewer({ llm, issueKey, diff, testerReport }) {
  const text = await llm.generateText({
    systemPrompt: "You are a strict iOS Code Reviewer agent. Output only valid JSON.",
    userPrompt: buildReviewerPrompt({ issueKey, diff, testerReport }),
    temperature: 0.1,
  });
  return JSON.parse(text);
}
