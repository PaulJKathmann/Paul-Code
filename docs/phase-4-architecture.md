# Phase 4: Architecture

[← Phase 3](phase-3-streaming-output.md) | [Back to Roadmap](../ROADMAP.md) | [Next: Phase 5 →](phase-5-context-management.md)

---

Phase 4 is a refactor, not a feature. You are not adding new capabilities — you are restructuring the code so that future capabilities are easy to add. Right now, `main.ts` contains the CLI parsing, the agent loop, the system prompt, and the tool dispatch all in one file, with `tools.ts` holding every tool definition and implementation. This works at 150 lines. It does not work at 500.

By the end of this phase, adding a new tool means creating one file and registering it. Changing the model means editing a config file. The agent loop, the tools, the configuration, and the CLI are all separate modules with clear boundaries. This is the last "linear" phase — after this, Phases 5-8 can be done in any order.

---

## 4.1 The Tool Registry Pattern

### What and Why

Look at your current tool dispatch in `main.ts`:

```typescript
if (tool_name === "read_file") {
  const result = readFile(file_path);
  // ...
} else if (tool_name === "write_file") {
  // ...
} else if (tool_name === "Bash") {
  // ...
} else {
  console.log(`Unknown tool called: ${tool_name}`);
}
```

Every new tool means adding another `else if` branch here AND adding the schema to the tools array in `tools.ts`. Two places to change, easy to forget one, and the dispatch logic grows linearly. The tool registry pattern collapses this into a data structure.

### The ToolDefinition Interface

Each tool is a self-contained object: its schema (what the model sees) and its executor (what runs when called).

```typescript
// src/types.ts

export interface ToolDefinition {
  /** The tool schema sent to the API */
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** The function that executes this tool */
  execute: (args: Record<string, unknown>) => Promise<string> | string;
}
```

### One Tool Per File

Each tool file exports a single `ToolDefinition`. Here is `read_file` extracted:

```typescript
// src/tools/read_file.ts
import { readFileSync } from "fs";
import type { ToolDefinition } from "../types.js";

export const readFileTool: ToolDefinition = {
  name: "read_file",
  description: "Read and return the contents of a file.",
  parameters: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "Path to the file to read" },
    },
    required: ["file_path"],
  },
  execute(args) {
    const filePath = args.file_path as string;
    try {
      return readFileSync(filePath, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return `Error: file not found: ${filePath}`;
      }
      return `Error reading file: ${err}`;
    }
  },
};
```

The schema and the implementation live together. No cross-file coordination needed.

### The Registry (tools/index.ts)

The registry collects all tools, exports the API schemas for the `tools` parameter, and provides a dispatch function.

```typescript
// src/tools/index.ts
import type { ToolDefinition } from "../types.js";
import { readFileTool } from "./read_file.js";
import { writeFileTool } from "./write_file.js";
import { editFileTool } from "./edit_file.js";
import { bashTool } from "./bash.js";
import { grepSearchTool, globFindTool, listDirectoryTool } from "./search.js";

const allTools: ToolDefinition[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  bashTool,
  grepSearchTool,
  globFindTool,
  listDirectoryTool,
];

/** Tool schemas for the OpenAI API `tools` parameter */
export const toolSchemas = allTools.map((t) => ({
  type: "function" as const,
  function: {
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  },
}));

/** Map from tool name to executor — used for dispatch */
const toolMap = new Map<string, ToolDefinition>(
  allTools.map((t) => [t.name, t])
);

/** Execute a tool by name. Returns the result string. */
export async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const tool = toolMap.get(name);
  if (!tool) return `Error: unknown tool "${name}"`;
  return await tool.execute(args);
}
```

### How the Agent Loop Uses It

The entire dispatch block in the agent loop becomes:

```typescript
import { toolSchemas, executeTool } from "./tools/index.js";

// In the API call:
const stream = await client.chat.completions.create({
  model, messages, tools: toolSchemas, stream: true,
});

// In the tool execution loop:
for (const toolCall of message.tool_calls ?? []) {
  const args = JSON.parse(toolCall.function.arguments);
  const result = await executeTool(toolCall.function.name, args);
  messages.push({
    role: "tool",
    tool_call_id: toolCall.id,
    content: result,
  });
}
```

No `if/else` chain. No switch statement. The dispatch is a map lookup.

### Adding a New Tool

After this refactor, adding a tool is three steps:

1. Create `src/tools/my_tool.ts` exporting a `ToolDefinition`
2. Import it in `src/tools/index.ts`
3. Add it to the `allTools` array

The agent loop, the API call, the streaming accumulator — none of them change.

---

## 4.2 Module Extraction

### The Target File Layout

```
src/
├── main.ts              # Entry point — CLI parsing, starts agent
├── agent.ts             # Agent loop — streaming, tool execution, iteration guard
├── system-prompt.ts     # Builds the system prompt string
├── types.ts             # Shared interfaces
└── tools/
    ├── index.ts          # Registry + dispatch
    ├── read_file.ts
    ├── write_file.ts
    ├── edit_file.ts
    ├── bash.ts
    └── search.ts         # grep_search, glob_find, list_directory
```

### types.ts — Shared Interfaces

This file is imported by everything else. It has no dependencies of its own.

```typescript
// src/types.ts

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string> | string;
}

export interface AgentConfig {
  model: string;
  maxIterations: number;
  apiKey: string;
  baseURL: string;
}
```

### system-prompt.ts — Dynamic Prompt Builder

The system prompt is not static — it includes the working directory at runtime. Extract it into a function so it can grow later (adding git status, project file list, loaded config).

```typescript
// src/system-prompt.ts

export function buildSystemPrompt(): string {
  const cwd = process.cwd();

  return `You are Paul Code, an AI coding assistant that runs in the user's terminal.
You help with software engineering tasks: reading code, writing files,
running commands, debugging, and answering questions about codebases.

You are operating in: ${cwd}

Rules:
- ALWAYS read a file before editing it. Never guess at file contents.
- Prefer small, focused changes over large rewrites.
- Briefly explain what you're about to do before doing it.
- When you encounter an error, read the relevant code and diagnose before retrying.
- If a task is ambiguous, ask the user to clarify rather than guessing.
- After making changes, verify them (e.g., run the relevant test or read the file back).`;
}
```

Why a function instead of a `const`? Because `process.cwd()` should be evaluated at startup, not at import time. And in later phases you will add dynamic content — git branch, project config, loaded CLAUDE.md files — that must be computed fresh.

### agent.ts — The Agent Loop

This is the core module. It takes a client and config, owns the message history, and runs the streaming loop with tool execution.

```typescript
// src/agent.ts
import type OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessage,
} from "openai/resources/chat/completions/completions.js";
import type { AgentConfig } from "./types.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { toolSchemas, executeTool } from "./tools/index.js";

interface ToolCallAccumulator {
  id: string;
  function: { name: string; arguments: string };
}

async function processStream(
  client: OpenAI,
  messages: ChatCompletionMessageParam[],
  model: string
): Promise<ChatCompletionMessage> {
  const stream = await client.chat.completions.create({
    model,
    messages,
    tools: toolSchemas,
    stream: true,
  });

  const contentParts: string[] = [];
  const toolCallAccumulators = new Map<number, ToolCallAccumulator>();

  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    if (!choice) continue;

    if (choice.delta.content) {
      process.stdout.write(choice.delta.content);
      contentParts.push(choice.delta.content);
    }

    if (choice.delta.tool_calls) {
      for (const tc of choice.delta.tool_calls) {
        if (!toolCallAccumulators.has(tc.index)) {
          toolCallAccumulators.set(tc.index, {
            id: tc.id || "",
            function: { name: tc.function?.name || "", arguments: "" },
          });
        }
        const acc = toolCallAccumulators.get(tc.index)!;
        if (tc.id) acc.id = tc.id;
        if (tc.function?.name) acc.function.name += tc.function.name;
        if (tc.function?.arguments) acc.function.arguments += tc.function.arguments;
      }
    }
  }

  if (contentParts.length > 0) process.stdout.write("\n");

  const fullContent = contentParts.join("") || null;
  const toolCalls =
    toolCallAccumulators.size > 0
      ? Array.from(toolCallAccumulators.entries())
          .sort(([a], [b]) => a - b)
          .map(([_, acc]) => ({
            id: acc.id,
            type: "function" as const,
            function: { name: acc.function.name, arguments: acc.function.arguments },
          }))
      : undefined;

  return { role: "assistant", content: fullContent, tool_calls: toolCalls, refusal: null };
}

export async function runAgentLoop(
  client: OpenAI,
  messages: ChatCompletionMessageParam[],
  config: AgentConfig
): Promise<string> {
  const systemPrompt = buildSystemPrompt();
  let iterations = 0;
  const warningThreshold = Math.floor(config.maxIterations * 0.8);

  while (true) {
    if (iterations >= config.maxIterations) {
      const msg = `Stopped: reached maximum of ${config.maxIterations} iterations.`;
      console.warn(msg);
      return msg;
    }

    if (iterations === warningThreshold) {
      messages.push({
        role: "system",
        content:
          `You have used ${iterations} of ${config.maxIterations} allowed iterations. ` +
          `Wrap up your current task.`,
      });
    }

    iterations++;

    const assistantMessage = await processStream(
      client,
      [{ role: "system", content: systemPrompt }, ...messages],
      config.model
    );
    messages.push(assistantMessage);

    const toolCalls = assistantMessage.tool_calls ?? [];
    if (toolCalls.length === 0) {
      return assistantMessage.content ?? "";
    }

    for (const toolCall of toolCalls) {
      const args = JSON.parse(toolCall.function.arguments);
      console.log(`[tool: ${toolCall.function.name}]`);
      const result = await executeTool(toolCall.function.name, args);
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      });
    }
  }
}
```

Notice what `agent.ts` does NOT contain: CLI parsing, configuration loading, readline, or tool implementations. It is purely the loop.

### main.ts — Thin Entry Point

After extraction, `main.ts` becomes the thinnest file in the project:

```typescript
// src/main.ts
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions/completions.js";
import { loadConfig } from "./config.js";
import { runAgentLoop } from "./agent.js";
import { runInteractiveMode } from "./interactive.js";

async function main() {
  const config = loadConfig();
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
  const messages: ChatCompletionMessageParam[] = [];

  const args = process.argv.slice(2);
  const promptIndex = args.indexOf("-p");

  if (promptIndex !== -1 && args[promptIndex + 1]) {
    // Single-shot mode
    messages.push({ role: "user", content: args[promptIndex + 1] });
    await runAgentLoop(client, messages, config);
  } else {
    // Interactive REPL
    await runInteractiveMode(client, messages, config);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
```

That is 25 lines. It parses arguments, loads config, creates the client, and delegates. Nothing else.

---

## 4.3 Configuration System

### Why a Config System

Right now, the model name is hardcoded to `"gpt-5.2"`, the API key comes from one env var, and there are no knobs for anything. You want to change the model? Edit source code. You want a different max iteration count? Edit source code. Configuration should be layered: sensible defaults, overridden by a project file, overridden by CLI flags, overridden by environment variables.

### The Config File: `.paulcode.json`

Create a `.paulcode.json` in your project root:

```json
{
  "model": "gpt-5.2",
  "maxIterations": 50,
  "baseURL": "https://openrouter.ai/api/v1"
}
```

### Config Loading and Merging

```typescript
// src/config.ts
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { AgentConfig } from "./types.js";

const DEFAULTS: AgentConfig = {
  model: "gpt-5.2",
  maxIterations: 50,
  apiKey: "",
  baseURL: "https://openrouter.ai/api/v1",
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

  const baseURL = process.env.OPENAI_BASE_URL || process.env.OPENROUTER_BASE_URL;
  if (baseURL) env.baseURL = baseURL;

  const model = process.env.PAULCODE_MODEL;
  if (model) env.model = model;

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
    ...DEFAULTS,
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
```

### Merge Order

The merge order matters. More specific sources override less specific ones:

```
Defaults (hardcoded)
  ← .paulcode.json  (project-level preferences)
    ← Environment vars  (machine-level / secrets)
      ← CLI flags  (this-invocation overrides)
```

A practical example: your `.paulcode.json` sets `model: "gpt-5.2"`. You want to try Claude for one session: `paul-code --model claude-sonnet-4-20250514`. The CLI flag wins without changing any file.

### What Not to Put in Config Files

Secrets (API keys) go in environment variables. Never in `.paulcode.json` — that file gets committed to git. The config loader enforces this by only reading `apiKey` from env vars, never from the project file.

---

## 4.4 Entry Point Restructuring

### CLI Argument Parsing

Bun ships with Node's `node:util` module, which includes `parseArgs`. This is a zero-dependency argument parser.

```typescript
// src/main.ts
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    prompt: { type: "string", short: "p" },
    model: { type: "string" },
    "max-iterations": { type: "string" },
    help: { type: "boolean", short: "h" },
  },
  allowPositionals: true,
  strict: false,
});

if (values.help) {
  console.log(`Usage: paul-code [options]
  -p, --prompt <text>     Run in single-shot mode with the given prompt
  --model <name>          Override the model (default: gpt-5.2)
  --max-iterations <n>    Override max iteration count (default: 50)
  -h, --help              Show this help message`);
  process.exit(0);
}
```

This replaces the manual `process.argv` index arithmetic. The `strict: false` option means unknown flags don't cause errors — useful as you add features incrementally.

### Graceful Shutdown

Ctrl+C sends `SIGINT`. Without a handler, the process exits immediately, potentially mid-write. Add a clean exit:

```typescript
// src/main.ts

// Handle Ctrl+C gracefully
process.on("SIGINT", () => {
  console.log("\nInterrupted. Goodbye.");
  process.exit(0);
});

// Handle uncaught errors
process.on("unhandledRejection", (err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
```

### Top-Level Error Boundary

Wrap everything in a catch so the user never sees a raw stack trace:

```typescript
main().catch((err) => {
  if (err instanceof Error) {
    console.error(`Error: ${err.message}`);
  } else {
    console.error("An unexpected error occurred:", err);
  }
  process.exit(1);
});
```

### Complete main.ts After Restructuring

Here is the full file after all Phase 4 changes:

```typescript
// src/main.ts
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions/completions.js";
import { parseArgs } from "node:util";
import { loadConfig } from "./config.js";
import { runAgentLoop } from "./agent.js";

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
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
  const messages: ChatCompletionMessageParam[] = [];

  if (values.prompt) {
    messages.push({ role: "user", content: values.prompt });
    await runAgentLoop(client, messages, config);
  } else {
    await runInteractiveMode(client, messages, config);
  }
}

async function runInteractiveMode(
  client: OpenAI,
  messages: ChatCompletionMessageParam[],
  config: import("./types.js").AgentConfig
): Promise<void> {
  const readline = await import("readline");
  console.log("Paul Code — interactive mode");
  console.log('Type /exit or press Ctrl+C to quit.\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (): Promise<string> =>
    new Promise((resolve) => rl.question("> ", resolve));

  while (true) {
    const input = (await ask()).trim();
    if (input === "/exit") {
      console.log("Goodbye.");
      break;
    }
    if (input === "") continue;

    messages.push({ role: "user", content: input });
    await runAgentLoop(client, messages, config);
    console.log();
  }

  rl.close();
}

main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
```

---

## 4.5 Migration Strategy

You do not need to do this all at once. Here is the order that minimizes breakage:

**Step 1: Create the directory structure.**

```bash
mkdir -p src/tools
```

**Step 2: Create `src/types.ts`.** Pure interfaces, no logic. Nothing breaks.

**Step 3: Move tools.** Create individual files under `src/tools/`, then build `src/tools/index.ts` that re-exports them. Update `main.ts` to import from the new location. Test: everything still works.

**Step 4: Extract `src/system-prompt.ts`.** Move the prompt string out, import it back. Test.

**Step 5: Extract `src/agent.ts`.** This is the biggest move — the `while(true)` loop, the streaming logic, the tool dispatch. `main.ts` calls `runAgentLoop()` instead of containing the loop. Test.

**Step 6: Add `src/config.ts`.** Replace the inline `process.env` reads with `loadConfig()`. Create `.paulcode.json`. Test.

**Step 7: Restructure `main.ts`.** Add `parseArgs`, graceful shutdown, error boundary. Test.

After each step, run your agent end-to-end. A common mistake is extracting everything at once and then spending an hour debugging import paths. Move one module, test, move the next.

---

## Summary

| Before | After |
|--------|-------|
| All code in 2 files (`main.ts` + `tools.ts`) | 8+ files across `src/` and `src/tools/` |
| Adding a tool = edit 2 files + add `else if` | Adding a tool = create 1 file + register |
| Model name hardcoded | Config file + env vars + CLI flags |
| Raw `process.argv` indexing | `parseArgs` from `node:util` |
| No error boundary | Top-level catch + graceful shutdown |
| Tool dispatch via `if/else` chain | Map lookup via tool registry |
| System prompt is a string constant | Function that builds prompt dynamically |

The codebase is now ready for Phases 5-8 to add features without tripping over each other. Context management (Phase 5) plugs into `agent.ts`. Safety checks (Phase 6) plug into `tools/index.ts`. Cost tracking (Phase 7) wraps around `processStream`. MCP (Phase 8) registers external tools through the same registry. The architecture enables all of it.
