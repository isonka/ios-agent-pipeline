import { jiraDescriptionPlain } from "../jira/jiraDescriptionPlain.js";
import { stripDiffMarkdownFences } from "../services/applyUnifiedDiffToRepo.js";
import { extractJsonCandidate, generateJsonWithRepair } from "./llmJson.js";

const DEVELOPER_SYSTEM_PROMPT = "You are a Senior iOS Developer agent. Output only valid JSON.";

const DEVELOPER_EXECUTE_SYSTEM_PROMPT =
  "You are a Senior iOS Developer agent. You output git unified diffs that `git apply` accepts. " +
  "Prefer a raw diff (no JSON). If you use JSON, it must parse: one object with string field patchProposal only; escape quotes and newlines inside the string.";

const DEVELOPER_FULL_SCHEMA =
  '{"implementationPlan":"short plan","patchProposal":"unified diff patch text only","riskNotes":"main risks","testStubs":"tests developer expects to add/run"}';

const DEVELOPER_PLAN_SCHEMA =
  '{"implementationPlan":"short plan","riskNotes":"main risks","testStubs":"tests developer expects to add/run"}';

const DEVELOPER_EXECUTE_SCHEMA = '{"patchProposal":"unified diff patch text only"}';

function looksLikeUnifiedDiff(text) {
  const s = String(text || "").trim();
  return /^diff --git/m.test(s) || /^---\s+a\//m.test(s);
}

function normalizePatchProposal(text) {
  const d = String(text || "").replace(/\r\n/g, "\n");
  return d.endsWith("\n") ? d : `${d}\n`;
}

/**
 * Execute step must accept raw diffs: JSON wrapping breaks when hunks contain `{`/`}` (extractJsonCandidate
 * would slice the wrong span). Prefer raw diff, then JSON.
 */
export function extractPatchFromDeveloperExecuteResponse(text) {
  if (!text || !String(text).trim()) return null;

  const afterFence = stripDiffMarkdownFences(text);
  const trimmed = afterFence.trim();
  if (looksLikeUnifiedDiff(trimmed)) {
    return normalizePatchProposal(trimmed);
  }

  try {
    const jsonCandidate = extractJsonCandidate(text);
    const j = JSON.parse(jsonCandidate);
    if (typeof j?.patchProposal === "string" && j.patchProposal.trim()) {
      return normalizePatchProposal(stripDiffMarkdownFences(j.patchProposal));
    }
  } catch {
    // ignore
  }

  return null;
}

function buildDeveloperBaseParts({ issue, architectPlanText, context }) {
  const description = jiraDescriptionPlain(issue.fields?.description).slice(0, 8000);
  return [
    `ISSUE ${issue.key}: ${issue.fields?.summary || ""}`,
    description ? `DESCRIPTION\n${description}` : "",
    "",
    "STORY_SCOPE",
    architectPlanText,
    "",
    "DOCS",
    ...context.docs.map((doc) => `--- ${doc.path}\n${doc.content}`),
  ]
    .filter(Boolean)
    .join("\n");
}

function buildDeveloperFullPrompt(params) {
  return [
    buildDeveloperBaseParts(params),
    "",
    `SCHEMA ${DEVELOPER_FULL_SCHEMA}`,
    "JSON only.",
  ].join("\n");
}

function buildDeveloperPlanPrompt(params) {
  return [
    buildDeveloperBaseParts(params),
    "",
    "TASK: Produce an implementation plan only. Do not output a code patch yet.",
    `SCHEMA ${DEVELOPER_PLAN_SCHEMA}`,
    "JSON only.",
  ].join("\n");
}

function buildDeveloperExecutePrompt({ issue, architectPlanText, developerDraft, context }) {
  const draftBlock = [
    "APPROVED_DEVELOPER_PLAN",
    `implementationPlan:\n${developerDraft.implementationPlan || ""}`,
    "",
    `riskNotes:\n${developerDraft.riskNotes || ""}`,
    "",
    `testStubs:\n${developerDraft.testStubs || ""}`,
  ].join("\n");

  return [
    buildDeveloperBaseParts({ issue, architectPlanText, context }),
    "",
    draftBlock,
    "",
    "TASK: The plan above was approved. Output a unified diff that implements it (`git apply` must accept it).",
    "Every hunk line must start with space, +, -, or \\ (Git format). Never emit a completely empty line inside a hunk—use a single space for a blank context line, or + / - for added/removed lines.",
    "OUTPUT (choose one):",
    "— Preferred: raw unified diff only. First line `diff --git` or `--- a/`. No prose, no JSON.",
    "— Or: valid JSON only, exactly " + DEVELOPER_EXECUTE_SCHEMA + " (escape every quote and newline inside patchProposal).",
  ].join("\n");
}

export async function runDeveloperPlan({ llm, issue, architectPlanText, context }) {
  const parsed = await generateJsonWithRepair({
    llm,
    systemPrompt: DEVELOPER_SYSTEM_PROMPT,
    userPrompt: buildDeveloperPlanPrompt({ issue, architectPlanText, context }),
    failurePrefix: "Developer plan returned non-JSON content",
    repairSchemaDescription: DEVELOPER_PLAN_SCHEMA,
  });

  if (typeof parsed?.implementationPlan !== "string") {
    throw new Error("Developer plan output missing implementationPlan string.");
  }

  return {
    implementationPlan: parsed.implementationPlan,
    riskNotes: typeof parsed.riskNotes === "string" ? parsed.riskNotes : "",
    testStubs: typeof parsed.testStubs === "string" ? parsed.testStubs : "",
  };
}

export async function runDeveloperExecute({ llm, issue, architectPlanText, developerDraft, context }) {
  const userPrompt = buildDeveloperExecutePrompt({ issue, architectPlanText, developerDraft, context });

  const firstText = await llm.generateText({
    systemPrompt: DEVELOPER_EXECUTE_SYSTEM_PROMPT,
    userPrompt,
    temperature: 0,
  });

  let patch = extractPatchFromDeveloperExecuteResponse(firstText);
  if (!patch) {
    const repairedText = await llm.generateText({
      systemPrompt: DEVELOPER_EXECUTE_SYSTEM_PROMPT,
      userPrompt: [
        userPrompt,
        "",
        "YOUR_PREVIOUS_REPLY_WAS_NOT_A_USABLE_PATCH.",
        "Output ONLY a raw unified diff now. First line MUST be `diff --git` or `--- a/`.",
        "Do not use JSON. Do not wrap in markdown fences.",
        "",
        "PREVIOUS:",
        String(firstText).slice(0, 80000),
      ].join("\n"),
      temperature: 0,
    });
    patch = extractPatchFromDeveloperExecuteResponse(repairedText);
  }

  if (!patch?.trim()) {
    const preview = String(firstText || "")
      .slice(0, 400)
      .replace(/\s+/g, " ");
    throw new Error(
      `Developer execute returned no usable unified diff (raw diff or JSON with patchProposal). Preview: ${preview}`
    );
  }

  return { patchProposal: patch };
}

/** One LLM call: full developer JSON (plan + patch + notes). */
export async function runDeveloper({ llm, issue, architectPlanText, context }) {
  const parsed = await generateJsonWithRepair({
    llm,
    systemPrompt: DEVELOPER_SYSTEM_PROMPT,
    userPrompt: buildDeveloperFullPrompt({ issue, architectPlanText, context }),
    failurePrefix: "Developer returned non-JSON content",
    repairSchemaDescription: DEVELOPER_FULL_SCHEMA,
  });

  if (typeof parsed?.implementationPlan !== "string") {
    throw new Error("Developer output missing implementationPlan string.");
  }

  return parsed;
}
