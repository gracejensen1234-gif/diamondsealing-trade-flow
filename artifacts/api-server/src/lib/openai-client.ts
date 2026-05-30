import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  throw new Error("OPENAI_API_KEY environment variable is not set. Set it in Replit Secrets.");
}

export const openai = new OpenAI({ apiKey });
