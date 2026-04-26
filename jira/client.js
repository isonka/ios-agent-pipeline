const BASE = (process.env.JIRA_BASE_URL || "").replace(/\/$/, "");
const EMAIL = process.env.JIRA_EMAIL;
const TOKEN = process.env.JIRA_API_TOKEN;
const PROJECT_KEY = process.env.JIRA_PROJECT_KEY;
const BOARD_ID = process.env.JIRA_BOARD_ID || "";
const BOARD_NAME = process.env.JIRA_BOARD_NAME || "";
let cachedCurrentUser = null;
let cachedBoardId = null;

function authHeader() {
  const basic = Buffer.from(`${EMAIL}:${TOKEN}`).toString("base64");
  return `Basic ${basic}`;
}

async function jira(method, path, body) {
  if (!BASE || !EMAIL || !TOKEN) {
    throw new Error("Missing Jira configuration (JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN)");
  }

  const res = await fetch(`${BASE}/rest/api/3${path}`, {
    method,
    headers: {
      Authorization: authHeader(),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    ...(body && { body: JSON.stringify(body) }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira API ${method} ${path} -> ${res.status}: ${text}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

async function jiraAgile(method, path) {
  if (!BASE || !EMAIL || !TOKEN) {
    throw new Error("Missing Jira configuration (JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN)");
  }

  const res = await fetch(`${BASE}/rest/agile/1.0${path}`, {
    method,
    headers: {
      Authorization: authHeader(),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira Agile API ${method} ${path} -> ${res.status}: ${text}`);
  }

  return res.json();
}

export async function getIssue(issueKey) {
  return jira("GET", `/issue/${issueKey}`);
}

export async function getCurrentUser() {
  if (cachedCurrentUser) return cachedCurrentUser;
  cachedCurrentUser = await jira("GET", "/myself");
  return cachedCurrentUser;
}

export async function createSubtask(parentIssue, { title, body }) {
  const parentKey = parentIssue.key;
  const projectKey = parentIssue.fields?.project?.key || PROJECT_KEY;
  if (!projectKey) {
    throw new Error("Missing Jira project key; set JIRA_PROJECT_KEY");
  }

  // "Sub-task" is Jira Cloud default issue type name.
  return jira("POST", "/issue", {
    fields: {
      project: { key: projectKey },
      parent: { key: parentKey },
      summary: title,
      description: {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: body || "" }],
          },
        ],
      },
      issuetype: { name: "Sub-task" },
    },
  });
}

export async function addComment(issueKey, markdownBody) {
  return jira("POST", `/issue/${issueKey}/comment`, {
    body: {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: markdownBody }],
        },
      ],
    },
  });
}

export async function getTransitions(issueKey) {
  return jira("GET", `/issue/${issueKey}/transitions`);
}

export async function transitionIssueByName(issueKey, targetStatusName) {
  const transitions = await getTransitions(issueKey);
  const target = transitions.transitions?.find((t) => t.to?.name === targetStatusName);
  if (!target) return false;

  await jira("POST", `/issue/${issueKey}/transitions`, {
    transition: { id: target.id },
  });
  return true;
}

export async function isAssignedToCurrentUser(issue) {
  const me = await getCurrentUser();
  const assignee = issue?.fields?.assignee;
  if (!assignee?.accountId) return false;
  return assignee.accountId === me.accountId;
}

export async function getConfiguredBoardId() {
  if (!BOARD_ID && !BOARD_NAME) return null;
  if (cachedBoardId) return cachedBoardId;
  if (BOARD_ID) {
    cachedBoardId = BOARD_ID;
    return cachedBoardId;
  }

  let startAt = 0;
  const maxResults = 50;
  while (true) {
    const page = await jiraAgile(
      "GET",
      `/board?name=${encodeURIComponent(BOARD_NAME)}&startAt=${startAt}&maxResults=${maxResults}`
    );
    const found = page.values?.find((board) => board.name === BOARD_NAME);
    if (found?.id) {
      cachedBoardId = String(found.id);
      return cachedBoardId;
    }
    if (page.isLast || !page.values?.length) break;
    startAt += maxResults;
  }

  throw new Error(`Configured Jira board not found: ${BOARD_NAME}`);
}

export async function isIssueInConfiguredBoard(issueKey) {
  const boardId = await getConfiguredBoardId();
  if (!boardId) return true;

  const result = await jiraAgile(
    "GET",
    `/board/${boardId}/issue?jql=${encodeURIComponent(`key=${issueKey}`)}&maxResults=1`
  );
  const issues = result.issues || [];
  return issues.some((issue) => issue.key === issueKey);
}
