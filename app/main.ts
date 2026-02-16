import OpenAI from "openai";
import type { ChatCompletionMessage, ChatCompletionToolMessageParam } from "openai/resources/chat/completions/completions.js";
import type { ChatCompletionMessageParam, ChatCompletionMessageToolCall } from 'openai/resources/chat/completions/completions.mjs';
import { runAgentLoop, runInteractiveMode } from "./agent.ts";
type MessageHistoryItem = ChatCompletionMessageParam;
const messageHistory: MessageHistoryItem[] = [];


async function main() {
  const args = process.argv.slice(2);
  const promptFlagIndex = args.indexOf("-p");
  const prompt = promptFlagIndex !== -1 ? args[promptFlagIndex + 1] : args[0];
  const apiKey = process.env.OPENAI_API_KEY;
  const baseURL = process.env.OPENAI_BASE_URL || process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";

  if (!apiKey) {
    throw new Error("API_KEY is not set");
  }
  const client = new OpenAI({
    apiKey: apiKey,
    baseURL: baseURL,
  });
  if (promptFlagIndex !== -1) {
    // Headless (single shot mode)
    messageHistory.push({ role: "user", content: prompt });
    const result = await runAgentLoop(client, messageHistory);
    console.log(result);
  } else {
    // Interactive mode
    await runInteractiveMode(client, messageHistory);
  } 
}

main();
