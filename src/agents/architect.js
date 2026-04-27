function buildArchitectPrompt(issue, context) {
  return [
    `Jira issue: ${issue.key} - ${issue.fields?.summary || ""}`,
    "",
    "Project markdown docs:",
    ...context.docs.map((doc) => `--- ${doc.path}\n${doc.content}`),
    "",
    "Return JSON with schema:",
    "{",
    '  "summary": "short architecture summary",',
    '  "subtasks": [',
    '    { "title": "string", "body": "clear developer task contract with acceptance criteria" }',
    "  ]",
    "}",
    "Create 3-6 subtasks only.",
  ].join("\n");
}

export async function runArchitect({ llm, issue, context }) {
  const text = await llm.generateText({
    systemPrompt: "You are an iOS Architect agent. Output only valid JSON.",
    userPrompt: buildArchitectPrompt(issue, context),
    temperature: 0.1,
  });

  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed.subtasks)) {
    throw new Error("Architect output missing subtasks array.");
  }

  return parsed;
}
