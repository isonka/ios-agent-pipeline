import { jiraDescriptionPlain } from "../jira/jiraDescriptionPlain.js";
import { generateJsonWithRepair } from "./llmJson.js";

const ARCHITECT_SYSTEM_PROMPT = "You are an iOS Architect agent. Output only valid JSON.";
const SUBTASK_SCHEMA =
  '{"summary":"string","subtasks":[{"title":"string","body":"string with acceptance criteria","storyPoints":1,"changedFiles":["path/from/evidence"],"suggestedSkill":"path/to/SKILL.md or null"}]}';

function j(value) {
  return JSON.stringify(value);
}

function buildArchitectPrompt(issue, implementationContext) {
  const evidencePaths = (implementationContext?.matches || []).map((match) => match.path);
  const skillDocs = implementationContext?.skillDocs || [];
  const descPlain = jiraDescriptionPlain(issue.fields?.description).slice(0, 6000);

  const parts = [
    `ISSUE ${issue.key}: ${issue.fields?.summary || ""}`,
    descPlain ? `DESCRIPTION\n${descPlain}` : "",
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
  ];
  return parts.filter(Boolean).join("\n");
}

export async function runArchitect({ llm, issue, implementationContext }) {
  const evidencePaths = new Set(
    (implementationContext?.matches || []).map((item) => String(item.path || "").trim()).filter(Boolean)
  );
  const skillDocs = new Set((implementationContext?.skillDocs || []).map((item) => String(item || "").trim()));
  const parsed = await generateJsonWithRepair({
    llm,
    systemPrompt: ARCHITECT_SYSTEM_PROMPT,
    userPrompt: buildArchitectPrompt(issue, implementationContext),
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
