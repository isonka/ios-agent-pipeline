function buildDeveloperPrompt({ issue, subtaskKey, subtaskSummary, context }) {
  return [
    `Parent issue: ${issue.key} - ${issue.fields?.summary || ""}`,
    `Selected subtask: ${subtaskKey} - ${subtaskSummary || ""}`,
    "",
    "Project markdown docs:",
    ...context.docs.map((doc) => `--- ${doc.path}\n${doc.content}`),
    "",
    "Return JSON with schema:",
    "{",
    '  "implementationPlan": "short plan",',
    '  "patchProposal": "unified diff patch text only",',
    '  "riskNotes": "main risks",',
    '  "testStubs": "tests developer expects to add/run"',
    "}",
  ].join("\n");
}

export async function runDeveloper({ llm, issue, subtaskKey, subtaskSummary, context }) {
  const text = await llm.generateText({
    systemPrompt: "You are a Senior iOS Developer agent. Output only valid JSON.",
    userPrompt: buildDeveloperPrompt({ issue, subtaskKey, subtaskSummary, context }),
    temperature: 0.1,
  });

  return JSON.parse(text);
}
