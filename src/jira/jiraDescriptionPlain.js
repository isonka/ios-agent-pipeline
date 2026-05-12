/**
 * Extract plain text from Jira Cloud issue description (string or Atlassian Document Format).
 */
export function jiraDescriptionPlain(description) {
  if (!description) return "";
  if (typeof description === "string") return description.trim();

  const blockTexts = [];

  const textFromInlines = (nodes) => {
    if (!Array.isArray(nodes)) return "";
    const bits = [];
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      if (node.type === "text" && typeof node.text === "string") {
        bits.push(node.text);
      } else if (Array.isArray(node.content)) {
        bits.push(textFromInlines(node.content));
      }
    }
    return bits.join("");
  };

  const walkBlocks = (blocks) => {
    if (!Array.isArray(blocks)) return;
    for (const block of blocks) {
      if (!block || typeof block !== "object") continue;
      if (Array.isArray(block.content)) {
        const t = textFromInlines(block.content);
        if (t) blockTexts.push(t);
      }
    }
  };

  if (description.type === "doc" && Array.isArray(description.content)) {
    walkBlocks(description.content);
  } else if (typeof description === "object") {
    walkBlocks([description]);
  }

  return blockTexts.join("\n").replace(/\r\n/g, "\n").trim();
}
