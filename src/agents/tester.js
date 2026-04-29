function buildTesterPrompt({ issueKey, diff, context }) {
  return [
    `ISSUE ${issueKey}`,
    "DIFF",
    diff,
    "DOCS",
    ...context.docs.map((doc) => `--- ${doc.path}\n${doc.content}`),
    'SCHEMA {"verdict":"PASS|FAIL","reason":"why","testPlan":"manual+automated checks","bugsFound":["..."]}',
    "JSON only.",
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
