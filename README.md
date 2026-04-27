# iOS Agent Pipeline (Jira + GitHub)

Status-driven multi-agent flow for an iOS repository:

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
ON_DEMAND_ONLY=false

AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_USE_STATIC_CREDENTIALS=false
BEDROCK_MODEL_ID=anthropic.claude-sonnet-4-5
LLM_PROVIDER=bedrock
LLM_MAX_TOKENS=4096
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-3-5-sonnet-latest

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
TARGET_PROJECT_PATH=/absolute/path/to/project
IOS_TEST_SCHEME=YourAppScheme
IOS_WORKSPACE=YourApp.xcworkspace
IOS_PROJECT=
IOS_SIMULATOR_NAME=Marktplaats iPhone 14 Pro
IOS_SIMULATOR_OS=18.2
IOS_SNAPSHOT_TEST_FILE=Tests/GeneratedSnapshotTests.swift

GITHUB_TOKEN=...
GITHUB_OWNER=your-org
GITHUB_REPO=
GITHUB_BASE_BRANCH=main
```

3. Start server:

```bash
npm start
```

### AWS SSO (Bedrock)

If you use AWS SSO instead of static AWS keys:

```bash
aws sso login --profile your-profile
export AWS_PROFILE=your-profile
```

Then start the server in the same shell.

Notes:

- By default, the app prefers AWS SDK default credentials chain (SSO/profile/role).
- Static keys are used only when `AWS_USE_STATIC_CREDENTIALS=true`.

## Endpoints

- `POST /pipeline/create-subtasks` with `{ "issueKey": "IOS-123", "plannedChanges": "...", "expectations": "..." }`
  - Runs Architect agent and creates Jira subtasks with explicit task contracts.
  - `plannedChanges` is required and is added to Architect memory before generation.
- `POST /pipeline/run-developer` with `{ "issueKey": "IOS-123" }`
  - Runs only Developer stage on demand and posts result to Jira.
  - `plannedChanges` is required and stored in Developer memory.
- `POST /pipeline/run-tester` with `{ "issueKey": "IOS-123", "plannedChanges": "...", "diff": "..." }`
  - Runs Tester stage on demand and records tester learning memory.
- `POST /pipeline/run-reviewer` with `{ "issueKey": "IOS-123", "plannedChanges": "...", ... }`
  - Runs PR Reviewer stage on demand and records reviewer learning memory.
- `POST /pipeline/agent-feedback`
  - Stores rejection/acceptance feedback for any agent (`architect|developer|tester|reviewer`).
- `POST /pipeline/architect-feedback` (optional)
  - Stores extra feedback for Architect memory outside the main architect run.
- `POST /jira/webhook`
  - Trigger from Jira issue webhooks for transition automation.
- `GET /health`

## Jira webhook events

Configure Jira webhook to call `http://localhost:3000/jira/webhook` for:

- Issue updated (status transitions)
- Issue created (optional)

When status changes:

- To `IN PROGRESS`: Developer agent posts execution contract.
- To `IN REVIEW`: Tester agent posts QA report, manual validation findings, integration-test assessment, ensures snapshot tests exist, runs `xcodebuild test` on configured simulator, then draft PR is created in GitHub, PR reviewer runs merge gate, and issue transitions to `DONE` only if tester and reviewer checks pass.

Board scoping (optional):

- Set either `JIRA_BOARD_ID` or `JIRA_BOARD_NAME`.
- If configured, pipeline runs only for issues that belong to that board.
- `JIRA_BOARD_ID` takes precedence over `JIRA_BOARD_NAME`.

On-demand mode:

- Set `ON_DEMAND_ONLY=true` to ignore Jira webhook automation.
- Use manual endpoints (`/pipeline/create-subtasks`, `/pipeline/run-developer`) as needed.

Architect learning loop:

- Primary loop: pass `plannedChanges` (required) when calling `/pipeline/create-subtasks`.
- Optional loop: submit extra feedback later via `/pipeline/architect-feedback`.
- Same pattern applies to Developer/Tester/Reviewer on their on-demand endpoints.
- If an output is rejected, call `/pipeline/agent-feedback` immediately so next run uses explicit failure feedback.
- Memory is persisted and injected into future prompts automatically.
- Optional env:
  - `AGENT_MEMORY_DIR` (default `.data/agent-memory`)
  - `AGENT_MEMORY_MAX_ENTRIES` (default `50`)

Project context requirements:

- `TARGET_PROJECT_PATH` should point to the iOS repository root.
- `README.md` and `CLAUDE.md` are mandatory in that repo.
- `skills` content is optional and used as extra context if present.
- Architect/Developer stages are blocked when mandatory docs are missing.
- Project context is cached on disk and reused across runs to reduce repeated prompt cost.
- Optional: `PROJECT_CONTEXT_CACHE_FILE` (default `.data/project-context-cache.json`)

Tester execution requirements:

- `IOS_TEST_SCHEME` is required for running tests.
- Set `IOS_WORKSPACE` or `IOS_PROJECT` (auto-detection is attempted if both empty).
- Snapshot baseline simulator defaults to `Marktplaats iPhone 14 Pro` on iOS `18.2`.
- Tester marks ticket as failed if manual behavior is not as expected or integration-test status is `FAIL`.

LLM provider selection:

- Set `LLM_PROVIDER` to `bedrock`, `openai`, or `anthropic`.
- Default is `bedrock`.
- Bedrock remains the first/default provider and uses AWS credentials.