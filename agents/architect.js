import { callClaude } from "../config/llm.js";
import { getProjectContextForPromptCached } from "../project/context.js";
import { parseModelJson } from "../utils/llmJson.js";
import { appendAgentFeedback, formatAgentMemoryForPrompt, loadAgentMemory } from "../project/agentMemory.js";
import { buildProjectUnderstanding, formatProjectUnderstandingForPrompt } from "../project/projectUnderstanding.js";

const SYSTEM_PROMPT = `iOS architect. Break task into subtasks for developer.

Rules:
- No filler words. No pleasantries. No hedging.
- Each subtask self-contained. Developer sees ONLY subtask body. Include all context.
- Code blocks normal. Technical terms exact. Articles gone.
- Use only concrete paths and symbols grounded in provided project context.
- Never use placeholders like [ModulePath], "e.g.", "from audit", "same directory", or "coordinator/factory file".
- If a concrete path/symbol cannot be identified from context, mark it as an explicit unresolved question in "dependencies" instead of inventing.

JSON only. No fences. No preamble:
{
  "summary": "architectural overview",
  "subtasks": [
    {
      "title": "imperative title",
      "body": "**Pattern:** MVVM/TCA\\n**Components:** files/classes\\n**Models:** Swift structs/enums\\n**Criteria:** measurable outcomes\\n**Edge cases:** risks\\n**Estimate:** S|M|L",
      "labels": ["agent:developer"],
      "estimate": "S|M|L"
    }
  ],
  "risks": ["risk"],
  "dependencies": ["dep"]
}`;

const FORBIDDEN_GENERIC_PATTERNS = [
  /\[[^\]]+\]/, // placeholders like [DiscoverModulePath]
  /\be\.g\./i,
  /\bfrom audit\b/i,
  /\bsame directory\b/i,
  /\bcoordinator\/factory file\b/i,
  /\bthat instantiates\b/i,
];

const CONCRETE_PATH_PATTERN = /[A-Za-z0-9_\-./]+\.swift\b|[A-Za-z0-9_\-]+\/[A-Za-z0-9_\-/]+/;

function validateArchitectOutput(output) {
  const subtasks = Array.isArray(output?.subtasks) ? output.subtasks : [];
  if (!subtasks.length) {
    throw new Error("Architect output must include at least one subtask.");
  }
  for (const subtask of subtasks) {
    const title = String(subtask?.title || "");
    const body = String(subtask?.body || "");
    const text = `${title}\n${body}`;
    if (FORBIDDEN_GENERIC_PATTERNS.some((pattern) => pattern.test(text))) {
      throw new Error(
        "Architect output is generic/non-grounded. It must reference concrete existing paths/symbols from project context."
      );
    }
    if (!CONCRETE_PATH_PATTERN.test(text)) {
      throw new Error(
        "Architect output is not concrete enough. Each subtask must include explicit file paths/symbol references."
      );
    }
  }
}

async function ensureArchitectBootstrapMemory(issue, memory, understandingText) {
  const hasBootstrap = (memory.feedback || []).some((item) => item.source === "auto_project_bootstrap");
  if (hasBootstrap) return memory;

  const issueKey = issue?.key || issue?.number || "unknown";
  await appendAgentFeedback("architect", {
    issueKey,
    rating: "bootstrap",
    whatWorked: "Project understanding initialized.",
    whatFailed: "",
    expectations: "Always create subtasks grounded in existing files and architecture patterns.",
    notes: understandingText,
    source: "auto_project_bootstrap",
  });
  return loadAgentMemory("architect");
}

/**
 * Architect agent — breaks down an issue into subtasks.
 * @param {object} issue  Gitea issue object
 * @returns {Promise<{summary, subtasks, risks, dependencies}>}
 */
export async function runArchitect(issue, projectContext = "", deps = {}) {
  const llmCall = deps.llmCall || callClaude;
  const getProjectContext = deps.getProjectContext || getProjectContextForPromptCached;
  const getMemory = deps.getMemory || (() => loadAgentMemory("architect"));
  const getProjectUnderstanding = deps.getProjectUnderstanding || (async () => {
    const projectPath = process.env.TARGET_PROJECT_PATH;
    if (!projectPath) {
      throw new Error("Missing TARGET_PROJECT_PATH. Set it in your environment.");
    }
    const understanding = await buildProjectUnderstanding(projectPath);
    return formatProjectUnderstandingForPrompt(understanding);
  });
  const issueId = issue.key || issue.number || "UNKNOWN";
  const title = issue.title || issue.fields?.summary || "Untitled";
  const body = issue.body || issue.fields?.description || "No description.";
  const resolvedProjectContext = projectContext || await getProjectContext();
  const understandingText = await getProjectUnderstanding();
  const loadedMemory = await getMemory();
  const memory = await ensureArchitectBootstrapMemory(issue, loadedMemory, understandingText);
  const memoryForPrompt = formatAgentMemoryForPrompt(memory);
  const userMessage = `Break down. iOS subtasks.

#${issueId}: ${title}

${body}

Project context:
${resolvedProjectContext}

Project understanding:
${understandingText}

Architect memory (developer feedback from prior tasks):
${memoryForPrompt}

Hard constraint:
- Each subtask must be directly executable with zero interpretation.
- Include exact file paths/modules, acceptance checks, and explicit done criteria.`;

  const raw = await llmCall(SYSTEM_PROMPT, userMessage);
  const parsed = parseModelJson(raw, "Architect");
  validateArchitectOutput(parsed);
  return parsed;
}