const ARCHITECT_SYSTEM_PROMPT = "You are an iOS Architect agent. Output only valid JSON.";
const MEMORY_SCHEMA =
  '{"projectOverview":"string","architecture":"string","iosConventions":["string"],"keyComponents":[{"name":"string","responsibility":"string"}],"deliveryGuidance":"string","knownRisks":["string"]}';
const SUBTASK_SCHEMA =
  '{"summary":"string","subtasks":[{"title":"string","body":"string with acceptance criteria","storyPoints":1,"changedFiles":["path/from/evidence"],"suggestedSkill":"path/to/SKILL.md or null"}]}';

function j(value) {
  return JSON.stringify(value);
}

function buildArchitectMemoryPrompt(context) {
  return [
    "Make project memory.",
    "Use docs.",
    "JSON only.",
    "DOCS",
    ...context.docs.map((doc) => `--- ${doc.path}\n${doc.content}`),
    `SCHEMA ${MEMORY_SCHEMA}`,
  ].join("\n");
}

function buildArchitectPrompt(issue, architectMemory, implementationContext) {
  const evidencePaths = (implementationContext?.matches || []).map((match) => match.path);
  const skillDocs = implementationContext?.skillDocs || [];
  return [
    `ISSUE ${issue.key}: ${issue.fields?.summary || ""}`,
    `MEM ${j(architectMemory)}`,
    `EVIDENCE ${j(evidencePaths)}`,
    `SKILLS ${j(skillDocs)}`,
    "RULES",
    "- no discovery subtasks",
    "- implementation tasks only",
    "- changedFiles must be from EVIDENCE",
    "- storyPoints integer 1..3",
    "- suggestedSkill must be null or from SKILLS",
    "- 3 to 6 subtasks",
    `SCHEMA ${SUBTASK_SCHEMA}`,
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
        "Fix to strict JSON.",
        `SCHEMA ${repairSchemaDescription}`,
        "No prose. No markdown.",
        "INPUT",
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
    repairSchemaDescription: MEMORY_SCHEMA,
  });

  if (!parsed?.projectOverview || !Array.isArray(parsed?.keyComponents)) {
    throw new Error("Architect memory missing required projectOverview/keyComponents.");
  }
  return parsed;
}

export async function runArchitect({ llm, issue, architectMemory, implementationContext }) {
  const evidencePaths = new Set(
    (implementationContext?.matches || []).map((item) => String(item.path || "").trim()).filter(Boolean)
  );
  const skillDocs = new Set((implementationContext?.skillDocs || []).map((item) => String(item || "").trim()));
  const parsed = await generateJsonWithRepair({
    llm,
    userPrompt: buildArchitectPrompt(issue, architectMemory, implementationContext),
    failurePrefix: "Architect returned non-JSON content",
    repairSchemaDescription: SUBTASK_SCHEMA,
  });

  if (!Array.isArray(parsed.subtasks)) {
    throw new Error("Architect output missing subtasks array.");
  }

  for (const [index, subtask] of parsed.subtasks.entries()) {
    const points = Number(subtask?.storyPoints);
    if (!Number.isInteger(points) || points < 1 || points > 3) {
      throw new Error(`Architect subtask ${index + 1} has invalid storyPoints. Expected integer 1-3.`);
    }
    if (!Array.isArray(subtask?.changedFiles) || subtask.changedFiles.length === 0) {
      throw new Error(`Architect subtask ${index + 1} must include changedFiles.`);
    }
    const hasOnlyEvidencePaths = subtask.changedFiles.every((filePath) => evidencePaths.has(filePath));
    if (!hasOnlyEvidencePaths) {
      throw new Error(
        `Architect subtask ${index + 1} references changedFiles outside discovered implementation evidence.`
      );
    }
    if (!(subtask.suggestedSkill === null || skillDocs.has(String(subtask.suggestedSkill || "").trim()))) {
      throw new Error(
        `Architect subtask ${index + 1} has suggestedSkill outside discovered repo skill docs.`
      );
    }
  }

  return parsed;
}
