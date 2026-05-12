import "dotenv/config";
import fs from "fs/promises";
import path from "path";

const REQUIRED_PROVIDER = "bedrock";
const OPTIONAL_LEGACY_KEYS = new Set([
  "WEBHOOK_SECRET",
  "JIRA_WEBHOOK_SECRET",
]);

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === "";
}

async function getRequiredKeysFromEnvExample() {
  const envExamplePath = path.resolve(process.cwd(), ".env.example");
  const raw = await fs.readFile(envExamplePath, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const eqIndex = line.indexOf("=");
      if (eqIndex < 0) return null;
      const key = line.slice(0, eqIndex).trim();
      const exampleValue = line.slice(eqIndex + 1).trim();
      if (!key || exampleValue === "") return null;
      return key;
    })
    .filter(Boolean);
}

export async function validateEnv() {
  const provider = String(process.env.LLM_PROVIDER || REQUIRED_PROVIDER).toLowerCase();
  if (provider !== REQUIRED_PROVIDER) {
    throw new Error(`Unsupported LLM_PROVIDER '${provider}'. Only '${REQUIRED_PROVIDER}' is allowed.`);
  }

  const requiredKeys = await getRequiredKeysFromEnvExample();
  const missingKeys = requiredKeys.filter((key) => {
    if (OPTIONAL_LEGACY_KEYS.has(key)) return false;
    return isBlank(process.env[key]);
  });
  if (missingKeys.length > 0) {
    throw new Error(`Missing required env vars from .env.example: ${missingKeys.join(", ")}`);
  }
}

export function envConfig() {
  return {
    port: Number(process.env.PORT || 3000),
    bedrockRegion: process.env.AWS_REGION,
    bedrockModelId: process.env.BEDROCK_MODEL_ID,
    llmMaxTokens: Number(process.env.LLM_MAX_TOKENS || 4096),
    targetProjectPathFallback: process.env.TARGET_PROJECT_PATH || "",
    jiraBaseUrl: process.env.JIRA_BASE_URL,
    jiraEmail: process.env.JIRA_EMAIL,
    jiraApiToken: process.env.JIRA_API_TOKEN,
    jiraProjectKey: process.env.JIRA_PROJECT_KEY,
    jiraSubtaskTargetStatus: process.env.JIRA_SUBTASK_TARGET_STATUS || "",
    runStateDir: process.env.PIPELINE_RUN_STATE_DIR || ".data/pipeline-runs",
  };
}
