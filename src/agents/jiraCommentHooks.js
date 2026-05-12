import { shouldTriggerArchitectRefineFromComment } from "./architectRefineStory.js";

/**
 * @param {string} commentBody
 * @returns {"architect_refine" | "developer_plan" | "developer_execute" | null}
 */
export function resolveJiraCommentHook(commentBody) {
  if (shouldTriggerArchitectRefineFromComment(commentBody)) {
    return "architect_refine";
  }
  const text = String(commentBody || "").toLowerCase();
  if (!text.includes("@developer")) {
    return null;
  }
  // Stricter execute first (comment often mentions "plan" in both flows).
  const approved = text.includes("plan is approved") || text.includes("plan was approved");
  if (approved && /\bstart\s+implementation\b/.test(text)) {
    return "developer_execute";
  }
  if (/\bplan\b/.test(text)) {
    return "developer_plan";
  }
  return null;
}
