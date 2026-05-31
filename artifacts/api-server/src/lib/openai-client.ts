import OpenAI from "openai";

let client: OpenAI | null = null;

export function hasOpenAIConfig(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function getOpenAIClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  if (!client) {
    client = new OpenAI({ apiKey });
  }

  return client;
}

export function getAuditModel(): string {
  return process.env.OPENAI_AUDIT_MODEL?.trim() || "gpt-4o";
}
