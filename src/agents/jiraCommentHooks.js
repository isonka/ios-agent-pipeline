import { shouldTriggerArchitectRefineFromComment } from "./architectRefineStory.js";

function shouldTriggerArchitectApprovedFromComment(commentBody) {
  const text = String(commentBody || "").toLowerCase();
  if (!text.includes("@architect")) return false;
  if (/\brefine\b/.test(text)) return false;
  if (!/\bapproved\b/.test(text)) return false;
  return true;
}

function shouldTriggerArchitectCheckPlanFromComment(commentBody) {
  const text = String(commentBody || "").toLowerCase();
  if (!text.includes("@architect")) return false;
  if (/\brefine\b/.test(text)) return false;
  if (!/\bcheck\s+plan\b/.test(text)) return false;
  return true;
}

/**
 * @param {string} commentBody
 * @returns {"architect_refine" | "architect_check_plan" | "architect_approved" | "developer_plan" | "developer_execute" | null}
 */
export function resolveJiraCommentHook(commentBody) {
  if (shouldTriggerArchitectRefineFromComment(commentBody)) {
    return "architect_refine";
  }
  if (shouldTriggerArchitectCheckPlanFromComment(commentBody)) {
    return "architect_check_plan";
  }
  if (shouldTriggerArchitectApprovedFromComment(commentBody)) {
    return "architect_approved";
  }
  const text = String(commentBody || "").toLowerCase();
  if (!text.includes("@developer")) {
    return null;
  }
  const approved = text.includes("plan is approved") || text.includes("plan was approved");
  if (approved && /\bstart\s+implementation\b/.test(text)) {
    return "developer_execute";
  }
  if (/\bplan\b/.test(text)) {
    return "developer_plan";
  }
  return null;
}
