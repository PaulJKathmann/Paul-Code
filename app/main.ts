import OpenAI from "openai";
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions/completions.mjs';
import { runAgentLoop, runInteractiveMode } from "./agent.ts";
import { parseArgs } from "node:util";
import { loadConfig } from "./config.ts";
type MessageHistoryItem = ChatCompletionMessageParam;

process.on("SIGINT", () => {
  console.log("\nInterrupted. Goodbye.");
  process.exit(0);
});

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      prompt: { type: "string", short: "p" },
      model: { type: "string" },
      "max-iterations": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: false,
  });
  if (values.help) {
    console.log(`Usage: paul-code [options]
      -p, --prompt <text>     Single-shot mode
      --model <name>          Override model
      --max-iterations <n>    Override max iterations
      -h, --help              Show help`);
    process.exit(0);
  }
  const config = loadConfig();
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  })
  const messageHistory: ChatCompletionMessageParam[] = [];

  if (values.prompt && typeof values.prompt === "string") {
    // Headless (single shot mode)
    messageHistory.push({ role: "user", content: values.prompt });
    const result = await runAgentLoop(client, messageHistory, config);
    console.log(result);
  } else {
    // Interactive mode
    await runInteractiveMode(client, messageHistory, config);
  } 
}

main().catch((err) => {
  console.error(err);
  process.exit(1);  
});