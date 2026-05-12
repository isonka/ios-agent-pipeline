function buildAuthHeader(email, apiToken) {
  const value = Buffer.from(`${email}:${apiToken}`).toString("base64");
  return `Basic ${value}`;
}

export class JiraClient {
  constructor({ baseUrl, email, apiToken, projectKey }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.projectKey = projectKey;
    this.headers = {
      Authorization: buildAuthHeader(email, apiToken),
      Accept: "application/json",
      "Content-Type": "application/json",
    };
  }

  async request(method, endpoint, body) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method,
      headers: this.headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Jira ${method} ${endpoint} failed (${response.status}): ${text}`);
    }

    if (response.status === 204) return null;
    return response.json();
  }

  async updateIssueDescription(issueKey, plainText) {
    const chunks = String(plainText || "")
      .split(/\n\n+/)
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => chunk.slice(0, 15000));

    const content =
      chunks.length > 0
        ? chunks.map((chunk) => ({
            type: "paragraph",
            content: [{ type: "text", text: chunk.replace(/\u0000/g, "") }],
          }))
        : [{ type: "paragraph", content: [{ type: "text", text: "" }] }];

    return this.request("PUT", `/rest/api/3/issue/${encodeURIComponent(issueKey)}`, {
      fields: {
        description: {
          type: "doc",
          version: 1,
          content,
        },
      },
    });
  }

  async listIssueComments(issueKey, maxResults = 80) {
    const key = encodeURIComponent(issueKey);
    return this.request("GET", `/rest/api/3/issue/${key}/comment?maxResults=${maxResults}`);
  }

  async getIssue(issueKey) {
    return this.request("GET", `/rest/api/3/issue/${issueKey}`);
  }

  async addComment(issueKey, text) {
    // Jira POST /issue/{key}/comment expects top-level { body: <ADF document> } (single "body").
    return this.request("POST", `/rest/api/3/issue/${issueKey}/comment`, {
      body: {
        type: "doc",
        version: 1,
        content: [{ type: "paragraph", content: [{ type: "text", text: String(text) }] }],
      },
    });
  }

  /**
   * Split on blank lines into separate ADF paragraphs so markdown-ish refine output renders readably.
   */
  async addCommentParagraphs(issueKey, text) {
    const chunks = String(text)
      .split(/\n\n+/)
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => chunk.slice(0, 15000));

    const content = chunks.map((chunk) => ({
      type: "paragraph",
      content: [{ type: "text", text: chunk.replace(/\u0000/g, "") }],
    }));

    const docContent =
      content.length > 0
        ? content
        : [{ type: "paragraph", content: [{ type: "text", text: String(text).slice(0, 15000) }] }];

    return this.request("POST", `/rest/api/3/issue/${issueKey}/comment`, {
      body: {
        type: "doc",
        version: 1,
        content: docContent,
      },
    });
  }
}
