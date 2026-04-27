import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const MAX_SCAN_FILES = 4000;
const MAX_LIST_ITEMS = 20;

async function walkProjectFiles(dir, acc = []) {
  if (acc.length >= MAX_SCAN_FILES) return acc;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (acc.length >= MAX_SCAN_FILES) break;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if ([".git", "node_modules", "Pods", "Carthage", "build", "DerivedData"].includes(entry.name)) {
        continue;
      }
      await walkProjectFiles(fullPath, acc);
      continue;
    }
    acc.push(fullPath);
  }
  return acc;
}

function toRelative(projectPath, absPath) {
  return absPath.replace(`${projectPath}${path.sep}`, "");
}

function limit(items) {
  return items.slice(0, MAX_LIST_ITEMS);
}

export async function buildProjectUnderstanding(projectPath) {
  const info = await stat(projectPath).catch(() => null);
  if (!info?.isDirectory()) {
    throw new Error(`TARGET_PROJECT_PATH does not exist or is not a directory: ${projectPath}`);
  }

  const topEntries = await readdir(projectPath, { withFileTypes: true });
  const topLevel = topEntries.map((e) => e.name).sort();
  const files = await walkProjectFiles(projectPath);
  const relFiles = files.map((f) => toRelative(projectPath, f));

  const swiftFiles = relFiles.filter((f) => f.endsWith(".swift"));
  const coordinators = swiftFiles.filter((f) => /Coordinator\.swift$/i.test(f));
  const viewModels = swiftFiles.filter((f) => /ViewModel\.swift$/i.test(f));
  const viewControllers = swiftFiles.filter((f) => /ViewController\.swift$/i.test(f));
  const views = swiftFiles.filter((f) => /View\.swift$/i.test(f));

  const featureDirs = Array.from(
    new Set(
      swiftFiles
        .filter((f) => f.includes("Feature") || f.includes("Features"))
        .map((f) => f.split("/").slice(0, 3).join("/"))
    )
  ).sort();

  return {
    projectPath,
    topLevel,
    counts: {
      totalFiles: relFiles.length,
      swiftFiles: swiftFiles.length,
      coordinators: coordinators.length,
      viewModels: viewModels.length,
      viewControllers: viewControllers.length,
      views: views.length,
    },
    examples: {
      coordinators: limit(coordinators),
      viewModels: limit(viewModels),
      viewControllers: limit(viewControllers),
      views: limit(views),
      featureDirs: limit(featureDirs),
    },
  };
}

export function formatProjectUnderstandingForPrompt(understanding) {
  const ex = understanding.examples;
  return [
    `Project path: ${understanding.projectPath}`,
    `Top-level directories/files: ${understanding.topLevel.join(", ")}`,
    `Counts: totalFiles=${understanding.counts.totalFiles}, swiftFiles=${understanding.counts.swiftFiles}, coordinators=${understanding.counts.coordinators}, viewModels=${understanding.counts.viewModels}, viewControllers=${understanding.counts.viewControllers}, views=${understanding.counts.views}`,
    "",
    "Existing project examples (must be reused when creating subtasks):",
    `- Coordinators: ${ex.coordinators.join(", ") || "none"}`,
    `- ViewModels: ${ex.viewModels.join(", ") || "none"}`,
    `- ViewControllers: ${ex.viewControllers.join(", ") || "none"}`,
    `- SwiftUI Views: ${ex.views.join(", ") || "none"}`,
    `- Feature directories: ${ex.featureDirs.join(", ") || "none"}`,
  ].join("\n");
}
