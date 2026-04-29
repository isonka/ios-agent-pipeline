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

  async getIssue(issueKey) {
    return this.request("GET", `/rest/api/3/issue/${issueKey}`);
  }

  async addComment(issueKey, body) {
    return this.request("POST", `/rest/api/3/issue/${issueKey}/comment`, {
      body: {
        type: "doc",
        version: 1,
        content: [{ type: "paragraph", content: [{ type: "text", text: body }] }],
      },
    });
  }

  async createSubtask(parentIssueKey, title, description) {
    return this.request("POST", "/rest/api/3/issue", {
      fields: {
        project: { key: this.projectKey },
        parent: { key: parentIssueKey },
        summary: title,
        description: {
          type: "doc",
          version: 1,
          content: [{ type: "paragraph", content: [{ type: "text", text: description }] }],
        },
        issuetype: { name: "Sub-task" },
      },
    });
  }

  async getIssueTransitions(issueKey) {
    const payload = await this.request("GET", `/rest/api/3/issue/${issueKey}/transitions`);
    return payload?.transitions || [];
  }

  async transitionIssueToStatus(issueKey, statusName) {
    const transitions = await this.getIssueTransitions(issueKey);
    const normalizedTarget = String(statusName || "").trim().toLowerCase();
    const match = transitions.find((transition) => {
      const toName = String(transition?.to?.name || "").trim().toLowerCase();
      return toName === normalizedTarget;
    });

    if (!match) {
      const available = transitions.map((transition) => transition?.to?.name).filter(Boolean);
      throw new Error(
        `No Jira transition from ${issueKey} to status '${statusName}'. Available: ${available.join(", ")}`
      );
    }

    await this.request("POST", `/rest/api/3/issue/${issueKey}/transitions`, {
      transition: { id: match.id },
    });
  }
}
