function buildDeveloperPrompt({ issue, subtaskKey, subtaskSummary, context }) {
  return [
    `ISSUE ${issue.key}: ${issue.fields?.summary || ""}`,
    `SUBTASK ${subtaskKey}: ${subtaskSummary || ""}`,
    "DOCS",
    ...context.docs.map((doc) => `--- ${doc.path}\n${doc.content}`),
    'SCHEMA {"implementationPlan":"short plan","patchProposal":"unified diff patch text only","riskNotes":"main risks","testStubs":"tests developer expects to add/run"}',
    "JSON only.",
  ].join("\n");
}

export async function runDeveloper({ llm, issue, subtaskKey, subtaskSummary, context }) {
  const text = await llm.generateText({
    systemPrompt: "You are a Senior iOS Developer agent. Output only valid JSON.",
    userPrompt: buildDeveloperPrompt({ issue, subtaskKey, subtaskSummary, context }),
    temperature: 0,
  });

  return JSON.parse(text);
}
