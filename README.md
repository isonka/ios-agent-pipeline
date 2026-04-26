# iOS Agent Pipeline (Jira + GitHub)

Status-driven multi-agent flow for `Marktplaats_app_iOS`:

Architect -> Developer -> Tester -> PR Reviewer

The system uses Jira workflow transitions as hard gates:

- Developer starts by moving issue to `IN PROGRESS`.
- Developer finishes by moving issue to `IN REVIEW`.
- Tester runs from `IN REVIEW`, posts strict QA verdict, then opens draft PR.
- PR Reviewer posts final review verdict.
- Pipeline moves the issue to `DONE` when testing/review stage completes.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Add env vars to `.env`:

```bash
PORT=3000
WEBHOOK_SECRET=replace_with_shared_secret

AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
BEDROCK_MODEL_ID=anthropic.claude-sonnet-4-5

JIRA_BASE_URL=https://your-domain.atlassian.net
JIRA_EMAIL=you@company.com
JIRA_API_TOKEN=...
JIRA_PROJECT_KEY=IOS
JIRA_STATUS_IN_PROGRESS=IN PROGRESS
JIRA_STATUS_IN_REVIEW=IN REVIEW
JIRA_STATUS_DONE=DONE
JIRA_BRANCH_FIELD_ID=customfield_12345
JIRA_BOARD_ID=
JIRA_BOARD_NAME=SMB General Classifieds

GITHUB_TOKEN=...
GITHUB_OWNER=your-org
GITHUB_REPO=Marktplaats_app_iOS
GITHUB_BASE_BRANCH=main
```

3. Start server:

```bash
npm start
```

## Endpoints

- `POST /pipeline/create-subtasks` with `{ "issueKey": "IOS-123" }`
  - Runs Architect agent and creates Jira subtasks with explicit task contracts.
- `POST /jira/webhook`
  - Trigger from Jira issue webhooks for transition automation.
- `GET /health`

## Jira webhook events

Configure Jira webhook to call `http://localhost:3000/jira/webhook` for:

- Issue updated (status transitions)
- Issue created (optional)

When status changes:

- To `IN PROGRESS`: Developer agent posts execution contract.
- To `IN REVIEW`: Tester agent posts QA report, draft PR is created in GitHub, reviewer verdict is added back to Jira, then issue is transitioned to `DONE`.

Board scoping (optional):

- Set either `JIRA_BOARD_ID` or `JIRA_BOARD_NAME`.
- If configured, pipeline runs only for issues that belong to that board.
- `JIRA_BOARD_ID` takes precedence over `JIRA_BOARD_NAME`.