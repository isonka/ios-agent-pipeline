const API_BASE = "https://api.github.com";
const TOKEN = process.env.GITHUB_TOKEN;
const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;
const BASE_BRANCH = process.env.GITHUB_BASE_BRANCH || "main";

async function gh(method, path, body) {
  if (!TOKEN || !OWNER || !REPO) {
    throw new Error("Missing GitHub config (GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO)");
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    ...(body && { body: JSON.stringify(body) }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${method} ${path} -> ${res.status}: ${text}`);
  }

  return res.status === 204 ? null : res.json();
}

export async function createDraftPullRequest({ title, body, head, base = BASE_BRANCH }) {
  return gh("POST", `/repos/${OWNER}/${REPO}/pulls`, {
    title,
    body,
    head,
    base,
    draft: true,
  });
}
