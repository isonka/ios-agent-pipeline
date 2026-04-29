function buildArchitectMemoryPrompt(context) {
  return [
    "You are preparing reusable project memory for future iOS delivery tasks.",
    "Study the provided docs and return JSON only.",
    "",
    "Project docs:",
    ...context.docs.map((doc) => `--- ${doc.path}\n${doc.content}`),
    "",
    "Return JSON with schema:",
    "{",
    '  "projectOverview": "high-level purpose and scope",',
    '  "architecture": "important architecture and module boundaries",',
    '  "iosConventions": ["coding, testing, tooling conventions"],',
    '  "keyComponents": [',
    '    { "name": "component/module", "responsibility": "what it owns" }',
    "  ],",
    '  "deliveryGuidance": "how architect should split stories for developer agent",',
    '  "knownRisks": ["risk items architect should watch"]',
    "}",
  ].join("\n");
}

function buildArchitectPrompt(issue, architectMemory) {
  return [
    `Jira issue: ${issue.key} - ${issue.fields?.summary || ""}`,
    "",
    "Reusable project memory:",
    JSON.stringify(architectMemory, null, 2),
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

function parseJsonResponse(text, failurePrefix) {
  const jsonCandidate = extractJsonCandidate(text);
  try {
    return JSON.parse(jsonCandidate);
  } catch {
    const preview = String(text || "").slice(0, 300).replace(/\s+/g, " ");
    throw new Error(`${failurePrefix}. Preview: ${preview}`);
  }
}

export async function generateArchitectMemory({ llm, context }) {
  const text = await llm.generateText({
    systemPrompt: "You are an iOS Architect agent. Output only valid JSON.",
    userPrompt: buildArchitectMemoryPrompt(context),
    temperature: 0.1,
  });

  const parsed = parseJsonResponse(text, "Architect memory generation returned non-JSON content");
  if (!parsed?.projectOverview || !Array.isArray(parsed?.keyComponents)) {
    throw new Error("Architect memory missing required projectOverview/keyComponents.");
  }
  return parsed;
}

export async function runArchitect({ llm, issue, architectMemory }) {
  const text = await llm.generateText({
    systemPrompt: "You are an iOS Architect agent. Output only valid JSON.",
    userPrompt: buildArchitectPrompt(issue, architectMemory),
    temperature: 0.1,
  });

  const parsed = parseJsonResponse(text, "Architect returned non-JSON content");

  if (!Array.isArray(parsed.subtasks)) {
    throw new Error("Architect output missing subtasks array.");
  }

  return parsed;
}
