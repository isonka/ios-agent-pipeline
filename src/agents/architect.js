const ARCHITECT_SYSTEM_PROMPT = "You are an iOS Architect agent. Output only valid JSON.";

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

function buildArchitectPrompt(issue, architectMemory, implementationContext) {
  return [
    `Jira issue: ${issue.key} - ${issue.fields?.summary || ""}`,
    "",
    "Reusable project memory:",
    JSON.stringify(architectMemory, null, 2),
    "",
    "Implementation evidence from the actual repo structure/code:",
    JSON.stringify(implementationContext, null, 2),
    "",
    "Important constraints:",
    "- Do not assume anything is a standalone module unless evidence confirms it.",
    "- Use implementation evidence first, then memory context.",
    "- If evidence is weak, create a first subtask to locate/verify ownership before migration or refactor tasks.",
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

async function generateJsonWithRepair({
  llm,
  userPrompt,
  failurePrefix,
  repairSchemaDescription,
}) {
  const firstText = await llm.generateText({
    systemPrompt: ARCHITECT_SYSTEM_PROMPT,
    userPrompt,
    temperature: 0.1,
  });

  try {
    return parseJsonResponse(firstText, failurePrefix);
  } catch {
    const repairedText = await llm.generateText({
      systemPrompt: ARCHITECT_SYSTEM_PROMPT,
      userPrompt: [
        "Convert the following response into strict valid JSON only.",
        `Schema: ${repairSchemaDescription}`,
        "Do not add markdown fences, comments, or prose.",
        "",
        "Response to repair:",
        firstText,
      ].join("\n"),
      temperature: 0,
    });
    return parseJsonResponse(repairedText, failurePrefix);
  }
}

export async function generateArchitectMemory({ llm, context }) {
  const parsed = await generateJsonWithRepair({
    llm,
    userPrompt: buildArchitectMemoryPrompt(context),
    failurePrefix: "Architect memory generation returned non-JSON content",
    repairSchemaDescription:
      '{"projectOverview":"string","architecture":"string","iosConventions":["string"],"keyComponents":[{"name":"string","responsibility":"string"}],"deliveryGuidance":"string","knownRisks":["string"]}',
  });

  if (!parsed?.projectOverview || !Array.isArray(parsed?.keyComponents)) {
    throw new Error("Architect memory missing required projectOverview/keyComponents.");
  }
  return parsed;
}

export async function runArchitect({ llm, issue, architectMemory, implementationContext }) {
  const parsed = await generateJsonWithRepair({
    llm,
    userPrompt: buildArchitectPrompt(issue, architectMemory, implementationContext),
    failurePrefix: "Architect returned non-JSON content",
    repairSchemaDescription:
      '{"summary":"string","subtasks":[{"title":"string","body":"string with acceptance criteria"}]}',
  });

  if (!Array.isArray(parsed.subtasks)) {
    throw new Error("Architect output missing subtasks array.");
  }

  return parsed;
}
