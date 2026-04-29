function issueText(issue) {
  const summary = String(issue?.fields?.summary || "");
  const description = issue?.fields?.description;
  const descriptionText = typeof description === "string" ? description : JSON.stringify(description || {});
  return `${summary} ${descriptionText}`.toLowerCase();
}

export function issueSummary(issue) {
  return String(issue?.fields?.summary || "").trim();
}

export function isUIKitToSwiftUIMigrationStory(issue) {
  const text = issueText(issue);
  return text.includes("uikit") && text.includes("swiftui") && text.includes("migrate");
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function extractAnchorTokens(issue) {
  const text = issueText(issue);
  const summary = issueSummary(issue);
  const tokens = [];
  const rawWords = text.split(/[^a-zA-Z0-9_]+/).filter(Boolean);
  for (const word of rawWords) {
    if (word.length >= 4) tokens.push(word.toLowerCase());
  }
  const camelCaseKeys = summary.match(/[a-z]+(?:[A-Z][a-z0-9]+)+/g) || [];
  for (const key of camelCaseKeys) tokens.push(key.toLowerCase());
  const quoted = [...summary.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  for (const phrase of quoted) {
    phrase
      .toLowerCase()
      .split(/[^a-zA-Z0-9_]+/)
      .filter((part) => part.length >= 4)
      .forEach((part) => tokens.push(part));
  }
  return uniqueValues(tokens).slice(0, 24);
}

function moduleBucket(path) {
  const parts = String(path || "").split("/");
  if (parts[0] === "Modules" && parts[1]) return `Modules/${parts[1]}`;
  if (parts[0] === "TargetShared" && parts[1] === "Sources" && parts[2] === "TargetShared" && parts[3]) {
    return `TargetShared/${parts[3]}`;
  }
  if (parts[0] === "TargetShared") return "TargetShared";
  if (parts[0]) return parts[0];
  return "unknown";
}

function scoreMatch(match, anchorTokens) {
  const pathLower = String(match.path || "").toLowerCase();
  const reasonLower = String(match.reason || "").toLowerCase();
  const snippetLower = String(match.snippet || "").toLowerCase();
  let score = 0;
  for (const token of anchorTokens) {
    if (!token) continue;
    if (pathLower.includes(token)) score += 4;
    if (reasonLower.includes(token)) score += 3;
    if (snippetLower.includes(token)) score += 2;
  }
  if (pathLower.endsWith(".strings")) score += 1;
  if (pathLower.includes("generated/strings") || pathLower.includes("swiftgen-strings")) score += 1;
  if (pathLower.includes("viewcontroller") || pathLower.includes("scenebuilder") || pathLower.includes("router")) {
    score += 1;
  }
  return score;
}

export function resolvePrimaryModule(issue, implementationContext) {
  const matches = implementationContext.matches || [];
  const anchorTokens = extractAnchorTokens(issue);
  const moduleScores = new Map();

  for (const match of matches) {
    const moduleName = moduleBucket(match.path);
    const score = scoreMatch(match, anchorTokens);
    const current = moduleScores.get(moduleName) || { score: 0, matches: [] };
    current.score += score;
    current.matches.push(match);
    moduleScores.set(moduleName, current);
  }

  const ranked = [...moduleScores.entries()]
    .map(([moduleName, data]) => ({ moduleName, score: data.score, matches: data.matches }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  const second = ranked[1];
  if (!best) {
    return {
      confidence: "low",
      reason: "No module candidates found from implementation matches.",
      primary: null,
      ranked,
    };
  }

  const scoreGap = best.score - (second?.score || 0);
  const confidence = best.score >= 8 && scoreGap >= 2 ? "high" : best.score >= 5 ? "medium" : "low";
  return {
    confidence,
    reason: `Best module '${best.moduleName}' score=${best.score} gap=${scoreGap}.`,
    primary: best,
    ranked,
  };
}
