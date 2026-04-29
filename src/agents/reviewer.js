function buildReviewerPrompt({ issueKey, diff, testerReport }) {
  return [
    `ISSUE ${issueKey}`,
    "DIFF",
    diff,
    "TEST",
    JSON.stringify(testerReport, null, 2),
    'SCHEMA {"verdict":"APPROVE|REQUEST_CHANGES","summary":"short review summary","requiredChanges":["..."]}',
    "JSON only.",
  ].join("\n");
}

export async function runReviewer({ llm, issueKey, diff, testerReport }) {
  const text = await llm.generateText({
    systemPrompt: "You are a strict iOS Code Reviewer agent. Output only valid JSON.",
    userPrompt: buildReviewerPrompt({ issueKey, diff, testerReport }),
    temperature: 0,
  });
  return JSON.parse(text);
}
