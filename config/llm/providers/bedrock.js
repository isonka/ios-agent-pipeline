import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { getMaxTokens } from "./shared.js";

let bedrockClient = null;

function getBedrockClient() {
  if (bedrockClient) return bedrockClient;
  const useStaticCreds = String(process.env.AWS_USE_STATIC_CREDENTIALS || "false").toLowerCase() === "true";
  const hasStaticCreds = Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
  const shouldUseStaticCreds = useStaticCreds && hasStaticCreds;

  bedrockClient = new BedrockRuntimeClient({
    region: process.env.AWS_REGION || "us-east-1",
    // Prefer default AWS SDK credential chain (SSO/profile/role).
    // Static keys are used only when explicitly enabled.
    ...(shouldUseStaticCreds && {
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    }),
  });
  return bedrockClient;
}

export async function callBedrock(systemPrompt, userMessage) {
  const modelId = process.env.BEDROCK_MODEL_ID || "anthropic.claude-sonnet-4-5";
  const client = getBedrockClient();

  const payload = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: getMaxTokens(),
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  };

  const command = new InvokeModelCommand({
    modelId,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify(payload),
  });

  const response = await client.send(command);
  const body = JSON.parse(new TextDecoder().decode(response.body));
  return body.content[0].text;
}
