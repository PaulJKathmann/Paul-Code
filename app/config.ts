import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { AgentConfig } from "./types.js";

const DEFAULT_CONFIG: AgentConfig = {
    model: "gpt-5.2",
    maxIterations: 5,
    baseURL: "https://api.openai.com/v1",
    apiKey: "",
};

function loadProjectConfig(): Partial<AgentConfig> {
  const configPath = join(process.cwd(), ".paulcode.json");
  if (!existsSync(configPath)) return {};

  try {
    const raw = readFileSync(configPath, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`Warning: failed to parse .paulcode.json: ${err}`);
    return {};
  }
}

function loadEnvConfig(): Partial<AgentConfig> {
  const env: Partial<AgentConfig> = {};

  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) env.apiKey = apiKey;

  return env;
}

function loadCLIConfig(argv: string[]): Partial<AgentConfig> {
  const cli: Partial<AgentConfig> = {};
  const modelIdx = argv.indexOf("--model");
  if (modelIdx !== -1 && argv[modelIdx + 1]) {
    cli.model = argv[modelIdx + 1];
  }
  const maxIterIdx = argv.indexOf("--max-iterations");
  if (maxIterIdx !== -1 && argv[maxIterIdx + 1]) {
    cli.maxIterations = parseInt(argv[maxIterIdx + 1], 10);
  }
  return cli;
}

export function loadConfig(): AgentConfig {
  const projectConfig = loadProjectConfig();
  const envConfig = loadEnvConfig();
  const cliConfig = loadCLIConfig(process.argv.slice(2));

  // Merge: defaults ← project ← env ← CLI (last wins)
  const merged: AgentConfig = {
    ...DEFAULT_CONFIG,
    ...projectConfig,
    ...envConfig,
    ...cliConfig,
  };

  if (!merged.apiKey) {
    throw new Error(
      "No API key found. Set OPENAI_API_KEY environment variable."
    );
  }

  return merged;
}

