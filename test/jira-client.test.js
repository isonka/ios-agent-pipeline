import test from "node:test";
import assert from "node:assert/strict";

function makeResponse({ ok = true, status = 200, json = {}, text = "" } = {}) {
  return {
    ok,
    status,
    async json() {
      return json;
    },
    async text() {
      return text;
    },
  };
}

async function importFreshJiraClient() {
  const mod = await import(`../jira/client.js?test=${Date.now()}-${Math.random()}`);
  return mod;
}

test("throws when required Jira config is missing", async () => {
  delete process.env.JIRA_BASE_URL;
  delete process.env.JIRA_EMAIL;
  delete process.env.JIRA_API_TOKEN;

  global.fetch = async () => {
    throw new Error("fetch should not be called");
  };

  const jira = await importFreshJiraClient();
  await assert.rejects(
    () => jira.getIssue("IOS-1"),
    /Missing Jira configuration/
  );
});

test("getCurrentUser caches /myself response", async () => {
  process.env.JIRA_BASE_URL = "https://example.atlassian.net";
  process.env.JIRA_EMAIL = "agent@example.com";
  process.env.JIRA_API_TOKEN = "token";

  const responses = [{ accountId: "abc-123", displayName: "Agent User" }];
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    return makeResponse({ json: responses.shift() });
  };

  const jira = await importFreshJiraClient();
  const first = await jira.getCurrentUser();
  const second = await jira.getCurrentUser();

  assert.equal(first.accountId, "abc-123");
  assert.equal(second.accountId, "abc-123");
  assert.equal(fetchCalls, 1);
});

test("isAssignedToCurrentUser returns true only for matching assignee", async () => {
  process.env.JIRA_BASE_URL = "https://example.atlassian.net";
  process.env.JIRA_EMAIL = "agent@example.com";
  process.env.JIRA_API_TOKEN = "token";

  global.fetch = async () => makeResponse({ json: { accountId: "owner-1" } });

  const jira = await importFreshJiraClient();

  const matching = await jira.isAssignedToCurrentUser({
    fields: { assignee: { accountId: "owner-1" } },
  });
  const notMatching = await jira.isAssignedToCurrentUser({
    fields: { assignee: { accountId: "owner-2" } },
  });
  const unassigned = await jira.isAssignedToCurrentUser({
    fields: { assignee: null },
  });

  assert.equal(matching, true);
  assert.equal(notMatching, false);
  assert.equal(unassigned, false);
});

test("createSubtask sends expected Jira payload", async () => {
  process.env.JIRA_BASE_URL = "https://example.atlassian.net";
  process.env.JIRA_EMAIL = "agent@example.com";
  process.env.JIRA_API_TOKEN = "token";
  process.env.JIRA_PROJECT_KEY = "IOS";

  let capturedUrl = "";
  let capturedMethod = "";
  let capturedBody = "";
  global.fetch = async (url, options) => {
    capturedUrl = url;
    capturedMethod = options.method;
    capturedBody = options.body;
    return makeResponse({ json: { key: "IOS-55" } });
  };

  const jira = await importFreshJiraClient();
  const parentIssue = { key: "IOS-10", fields: { project: { key: "IOS" } } };
  const result = await jira.createSubtask(parentIssue, {
    title: "Implement API mapper",
    body: "Exact steps and acceptance criteria.",
  });

  assert.equal(result.key, "IOS-55");
  assert.equal(capturedMethod, "POST");
  assert.match(capturedUrl, /\/rest\/api\/3\/issue$/);

  const parsed = JSON.parse(capturedBody);
  assert.equal(parsed.fields.parent.key, "IOS-10");
  assert.equal(parsed.fields.project.key, "IOS");
  assert.equal(parsed.fields.summary, "Implement API mapper");
  assert.equal(parsed.fields.issuetype.name, "Sub-task");
  assert.equal(
    parsed.fields.description.content[0].content[0].text,
    "Exact steps and acceptance criteria."
  );
});

test("transitionIssueByName transitions when target status exists", async () => {
  process.env.JIRA_BASE_URL = "https://example.atlassian.net";
  process.env.JIRA_EMAIL = "agent@example.com";
  process.env.JIRA_API_TOKEN = "token";

  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, method: options.method, body: options.body });
    if (options.method === "GET") {
      return makeResponse({
        json: {
          transitions: [
            { id: "11", to: { name: "In Progress" } },
            { id: "12", to: { name: "In Review" } },
          ],
        },
      });
    }
    return makeResponse({ status: 204 });
  };

  const jira = await importFreshJiraClient();
  const changed = await jira.transitionIssueByName("IOS-200", "In Review");
  assert.equal(changed, true);

  const postCall = calls.find((c) => c.method === "POST");
  assert.ok(postCall);
  assert.match(postCall.url, /\/issue\/IOS-200\/transitions$/);
  assert.deepEqual(JSON.parse(postCall.body), { transition: { id: "12" } });
});

test("transitionIssueByName returns false when target status missing", async () => {
  process.env.JIRA_BASE_URL = "https://example.atlassian.net";
  process.env.JIRA_EMAIL = "agent@example.com";
  process.env.JIRA_API_TOKEN = "token";

  let postCalls = 0;
  global.fetch = async (_url, options) => {
    if (options.method === "POST") postCalls += 1;
    return makeResponse({
      json: {
        transitions: [{ id: "11", to: { name: "Backlog" } }],
      },
    });
  };

  const jira = await importFreshJiraClient();
  const changed = await jira.transitionIssueByName("IOS-201", "In Review");
  assert.equal(changed, false);
  assert.equal(postCalls, 0);
});

test("getConfiguredBoardId returns null when board is not configured", async () => {
  process.env.JIRA_BASE_URL = "https://example.atlassian.net";
  process.env.JIRA_EMAIL = "agent@example.com";
  process.env.JIRA_API_TOKEN = "token";
  delete process.env.JIRA_BOARD_ID;
  delete process.env.JIRA_BOARD_NAME;

  global.fetch = async () => {
    throw new Error("fetch should not be called");
  };

  const jira = await importFreshJiraClient();
  const boardId = await jira.getConfiguredBoardId();
  assert.equal(boardId, null);
});

test("getConfiguredBoardId resolves board by name", async () => {
  process.env.JIRA_BASE_URL = "https://example.atlassian.net";
  process.env.JIRA_EMAIL = "agent@example.com";
  process.env.JIRA_API_TOKEN = "token";
  delete process.env.JIRA_BOARD_ID;
  process.env.JIRA_BOARD_NAME = "SMB General Classifieds";

  global.fetch = async (url) => {
    if (String(url).includes("/rest/agile/1.0/board")) {
      return makeResponse({
        json: {
          values: [{ id: 42, name: "SMB General Classifieds" }],
          isLast: true,
        },
      });
    }
    throw new Error(`unexpected url: ${url}`);
  };

  const jira = await importFreshJiraClient();
  const boardId = await jira.getConfiguredBoardId();
  assert.equal(boardId, "42");
});

test("isIssueInConfiguredBoard returns true when issue is present", async () => {
  process.env.JIRA_BASE_URL = "https://example.atlassian.net";
  process.env.JIRA_EMAIL = "agent@example.com";
  process.env.JIRA_API_TOKEN = "token";
  process.env.JIRA_BOARD_ID = "99";
  delete process.env.JIRA_BOARD_NAME;

  global.fetch = async (url) => {
    if (String(url).includes("/rest/agile/1.0/board/99/issue")) {
      return makeResponse({ json: { issues: [{ key: "MP-123" }] } });
    }
    throw new Error(`unexpected url: ${url}`);
  };

  const jira = await importFreshJiraClient();
  const inBoard = await jira.isIssueInConfiguredBoard("MP-123");
  assert.equal(inBoard, true);
});
