import { callClaude } from "../config/llm.js";
import { getProjectContextForPromptCached } from "../project/context.js";
import { parseModelJson } from "../utils/llmJson.js";
import { formatAgentMemoryForPrompt, loadAgentMemory } from "../project/agentMemory.js";

const SYSTEM_PROMPT = `iOS architect. Break task into subtasks for developer.

Rules:
- No filler words. No pleasantries. No hedging.
- Each subtask self-contained. Developer sees ONLY subtask body. Include all context.
- Code blocks normal. Technical terms exact. Articles gone.

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

/**
 * Architect agent — breaks down an issue into subtasks.
 * @param {object} issue  Gitea issue object
 * @returns {Promise<{summary, subtasks, risks, dependencies}>}
 */
export async function runArchitect(issue, projectContext = "", deps = {}) {
  const llmCall = deps.llmCall || callClaude;
  const getProjectContext = deps.getProjectContext || getProjectContextForPromptCached;
  const getMemory = deps.getMemory || (() => loadAgentMemory("architect"));
  const issueId = issue.key || issue.number || "UNKNOWN";
  const title = issue.title || issue.fields?.summary || "Untitled";
  const body = issue.body || issue.fields?.description || "No description.";
  const resolvedProjectContext = projectContext || await getProjectContext();
  const memory = await getMemory();
  const memoryForPrompt = formatAgentMemoryForPrompt(memory);
  const userMessage = `Break down. iOS subtasks.

#${issueId}: ${title}

${body}

Project context:
${resolvedProjectContext}

Architect memory (developer feedback from prior tasks):
${memoryForPrompt}

Hard constraint:
- Each subtask must be directly executable with zero interpretation.
- Include exact file paths/modules, acceptance checks, and explicit done criteria.`;

  const raw = await llmCall(SYSTEM_PROMPT, userMessage);
  return parseModelJson(raw, "Architect");
}