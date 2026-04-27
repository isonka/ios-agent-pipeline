import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

export class BedrockClaudeClient {
  constructor({ region, modelId, maxTokens }) {
    this.modelId = modelId;
    this.maxTokens = maxTokens;
    this.client = new BedrockRuntimeClient({ region });
  }

  async generateText({ systemPrompt, userPrompt, temperature = 0.1 }) {
    const input = {
      modelId: this.modelId,
      system: [{ text: systemPrompt }],
      messages: [{ role: "user", content: [{ text: userPrompt }] }],
      inferenceConfig: {
        maxTokens: this.maxTokens,
        temperature,
      },
    };

    const output = await this.client.send(new ConverseCommand(input));
    return output?.output?.message?.content?.[0]?.text || "";
  }
}
