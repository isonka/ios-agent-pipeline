import { callClaude } from "../config/llm.js";
import { getProjectContextForPromptCached } from "../project/context.js";

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
export async function runArchitect(issue, projectContext = "") {
  const issueId = issue.key || issue.number || "UNKNOWN";
  const title = issue.title || issue.fields?.summary || "Untitled";
  const body = issue.body || issue.fields?.description || "No description.";
  const resolvedProjectContext = projectContext || await getProjectContextForPromptCached();
  const userMessage = `Break down. iOS subtasks.

#${issueId}: ${title}

${body}

Project context:
${resolvedProjectContext}

Hard constraint:
- Each subtask must be directly executable with zero interpretation.
- Include exact file paths/modules, acceptance checks, and explicit done criteria.`;

  const raw = await callClaude(SYSTEM_PROMPT, userMessage);

  try {
    return JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch {
    throw new Error(`Architect returned invalid JSON:\n${raw}`);
  }
}