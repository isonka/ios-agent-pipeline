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

function extractJsonCandidate(text) {
  if (!text) return "";
  const trimmed = text.trim();

  if (trimmed.startsWith("```")) {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) return fenced[1].trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

export async function runArchitect({ llm, issue, context }) {
  const text = await llm.generateText({
    systemPrompt: "You are an iOS Architect agent. Output only valid JSON.",
    userPrompt: buildArchitectPrompt(issue, context),
    temperature: 0.1,
  });

  let parsed;
  const jsonCandidate = extractJsonCandidate(text);
  try {
    parsed = JSON.parse(jsonCandidate);
  } catch {
    const preview = String(text || "").slice(0, 300).replace(/\s+/g, " ");
    throw new Error(`Architect returned non-JSON content. Preview: ${preview}`);
  }

  if (!Array.isArray(parsed.subtasks)) {
    throw new Error("Architect output missing subtasks array.");
  }

  return parsed;
}
