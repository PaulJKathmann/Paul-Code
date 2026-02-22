import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions/completions.mjs";
import { parseArgs } from "node:util";
import { runAgentLoop, runInteractiveMode } from "./agent.ts";
import { loadConfig } from "./config.ts";
import { renderStartup } from "./banner.ts";
import { stopOwl } from "./owl.ts";

process.on("SIGINT", () => {
  stopOwl(); // Clean up any running animation
  console.log("\nGoodbye! 🦉");
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
  });
  const messageHistory: ChatCompletionMessageParam[] = [];

  if (values.prompt && typeof values.prompt === "string") {
    // Headless (single shot mode) — no banner
    messageHistory.push({ role: "user", content: values.prompt });
    const result = await runAgentLoop(client, messageHistory, config);
    console.log(result);
  } else {
    // Interactive mode — show banner
    console.log(renderStartup(config));
    await runInteractiveMode(client, messageHistory, config);
  }
}

main().catch((err) => {
  stopOwl();
  console.error(err);
  process.exit(1);
});
