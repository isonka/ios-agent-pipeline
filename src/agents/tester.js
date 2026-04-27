function buildTesterPrompt({ issueKey, diff, context }) {
  return [
    `Issue: ${issueKey}`,
    "",
    "Diff to validate:",
    diff,
    "",
    "Project markdown docs:",
    ...context.docs.map((doc) => `--- ${doc.path}\n${doc.content}`),
    "",
    "Return JSON with schema:",
    "{",
    '  "verdict": "PASS|FAIL",',
    '  "reason": "why",',
    '  "testPlan": "manual+automated checks",',
    '  "bugsFound": ["..."]',
    "}",
  ].join("\n");
}

export async function runTester({ llm, issueKey, diff, context }) {
  const text = await llm.generateText({
    systemPrompt: "You are an iOS Tester agent. Output only valid JSON.",
    userPrompt: buildTesterPrompt({ issueKey, diff, context }),
    temperature: 0.1,
  });
  return JSON.parse(text);
}
