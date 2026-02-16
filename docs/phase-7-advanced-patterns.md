# Phase 7: Advanced Patterns

[← Phase 6](phase-6-safety-and-ux.md) | [Back to Roadmap](../ROADMAP.md) | [Next: Phase 8 →](phase-8-mcp-support.md)

---

Phase 7 adds four capabilities that separate a demo agent from a practical one: executing tool calls in parallel, delegating subtasks to child agents, persisting conversations across sessions, and tracking what each session costs. None of these change the core loop — they wrap around it.

---

## 7.1 Parallel Tool Execution

### What and Why

Models can request multiple tool calls in a single response. When the agent reads three files to understand a feature, the API returns three `read_file` tool calls at once. Right now, the agent executes them one at a time — read file A, wait, read file B, wait, read file C, wait. These are independent I/O operations with no ordering dependency. Running them in parallel cuts wall-clock time by 2-3x.

Not all tool calls are safe to parallelize. Two `bash` commands writing to the same file will race. A `write_file` followed by a `read_file` of the same path must stay ordered. The heuristic is simple: parallelize reads, serialize everything else.

### Implementation

Classify each tool as read-only or not:

```typescript
const READ_ONLY_TOOLS = new Set(["read_file", "grep_search", "glob_find", "list_directory"]);

function isReadOnly(toolName: string): boolean {
  return READ_ONLY_TOOLS.has(toolName);
}
```

Split the tool calls into a parallelizable batch and a sequential batch:

```typescript
import type { ChatCompletionMessageToolCall } from "openai/resources/chat/completions";

interface ToolResult {
  tool_call_id: string;
  content: string;
}

async function executeToolCalls(
  toolCalls: ChatCompletionMessageToolCall[],
  executeTool: (name: string, args: Record<string, unknown>) => Promise<string>,
): Promise<ToolResult[]> {
  const allReadOnly = toolCalls.every((tc) => isReadOnly(tc.function.name));

  if (allReadOnly) {
    // All reads — run in parallel
    const results = await Promise.all(
      toolCalls.map(async (tc) => {
        const args = JSON.parse(tc.function.arguments);
        const content = await executeTool(tc.function.name, args);
        return { tool_call_id: tc.id, content };
      }),
    );
    return results;
  }

  // Mixed or all writes — run sequentially
  const results: ToolResult[] = [];
  for (const tc of toolCalls) {
    const args = JSON.parse(tc.function.arguments);
    const content = await executeTool(tc.function.name, args);
    results.push({ tool_call_id: tc.id, content });
  }
  return results;
}
```

Integrate into the agent loop. The key detail: tool result messages must be pushed in the **same order** as the tool calls, regardless of which finished first. The API expects result messages to correspond to the tool call order in the preceding assistant message.

```typescript
// In the agent loop, replace the sequential for-loop:
const toolResults = await executeToolCalls(toolCalls, executeTool);

for (const result of toolResults) {
  messageHistory.push({
    role: "tool",
    tool_call_id: result.tool_call_id,
    content: result.content,
  });
}
```

### Expected Behavior

Before: Three `read_file` calls take ~300ms total (100ms each, serial).

After: Three `read_file` calls take ~100ms total (all start simultaneously).

The model sees no difference — same tool results in the same order. The user sees faster responses when the agent reads multiple files.

---

## 7.2 Sub-Agent Delegation

### What and Why

Complex tasks have two phases: exploration (read files, search code, understand structure) and action (edit files, run commands). Exploration generates a lot of messages — file contents, search results, dead ends. All of that stays in the parent conversation's context window, crowding out space for the actual work.

A sub-agent is a fresh conversation spawned to handle a focused subtask. It gets its own message history, does its work, and returns a summary to the parent. The parent never sees the sub-agent's internal tool calls — only the final answer. This keeps the parent's context clean.

### Tool Schema

```typescript
{
  name: "spawn_agent",
  description:
    "Spawn a sub-agent to handle a focused subtask. The sub-agent gets its own " +
    "conversation with the same tools and a lower iteration limit. Use this for " +
    "exploration tasks (understanding a codebase, searching for patterns) so the " +
    "detailed tool results don't clutter the main conversation. " +
    "Returns the sub-agent's final summary.",
  parameters: {
    type: "object",
    properties: {
      task: {
        type: "string",
        description: "Clear description of the subtask for the sub-agent to complete.",
      },
      context: {
        type: "string",
        description: "Optional context from the parent conversation (e.g., relevant file paths, decisions made so far).",
      },
    },
    required: ["task"],
  },
}
```

### Implementation

The `spawn_agent` tool calls `runAgentLoop()` — the same function the parent uses — with a fresh message history. The sub-agent's system prompt is augmented with a note that it is a sub-agent and should produce a concise summary.

```typescript
// src/tools/spawn_agent.ts

import { runAgentLoop } from "../agent.js";
import type OpenAI from "openai";

const SUB_AGENT_SYSTEM_ADDENDUM = `
You are a sub-agent spawned to handle a specific subtask. Complete the task,
then provide a clear, concise summary of what you found or did. Your summary
is all the parent agent will see — include key findings, file paths, and
any relevant details. Do not ask follow-up questions.`;

const SUB_AGENT_MAX_ITERATIONS = 15;

export async function spawnAgent(
  client: OpenAI,
  systemPrompt: string,
  task: string,
  context?: string,
): Promise<string> {
  const subAgentPrompt = systemPrompt + SUB_AGENT_SYSTEM_ADDENDUM;

  // Build the sub-agent's initial message
  let userMessage = task;
  if (context) {
    userMessage = `Context from parent:\n${context}\n\nTask: ${task}`;
  }

  const subHistory: OpenAI.ChatCompletionMessageParam[] = [
    { role: "user", content: userMessage },
  ];

  console.log(`  [sub-agent] Starting: ${task.slice(0, 80)}...`);

  const result = await runAgentLoop(
    client,
    subHistory,
    subAgentPrompt,
    SUB_AGENT_MAX_ITERATIONS,
  );

  console.log(`  [sub-agent] Finished.`);
  return result;
}
```

Wire it into the tool dispatch:

```typescript
// In your tool execution switch/map:
case "spawn_agent": {
  const result = await spawnAgent(
    client,
    systemPrompt,
    args.task as string,
    args.context as string | undefined,
  );
  return result;
}
```

### How It Works End-to-End

1. User asks: "Refactor the auth module to use JWT."
2. Parent agent calls `spawn_agent({ task: "Explore the current auth implementation. Find all files involved, how sessions work, and what the public API surface is." })`
3. Sub-agent reads 8 files, runs 3 grep searches, produces a summary: "Auth uses `src/auth/session.ts` with cookie-based sessions. Public API: `login()`, `logout()`, `getSession()`. Session store in `src/auth/store.ts` using Redis."
4. Parent gets that summary as a tool result — not the 8 file reads and 3 searches.
5. Parent proceeds with the refactoring, context clean and focused.

### Token Efficiency

If the sub-agent reads 5 files averaging 200 lines each, that is ~5,000 tokens of file content. The parent only sees the 100-token summary. The savings compound — every subsequent parent API call avoids re-sending those 5,000 tokens.

The tradeoff: the sub-agent's own API calls cost tokens too. Sub-agents make sense when the exploration is substantial (3+ tool calls) and the parent has significant work remaining.

---

## 7.3 Conversation Persistence

### What and Why

When the agent exits, the conversation vanishes. If the user was mid-task — "I explored the codebase, now I need to make changes" — they start from zero. Persistence saves conversations to disk so they can be resumed.

### Storage Format

```typescript
// src/conversation.ts

interface ConversationMetadata {
  id: string;
  createdAt: string;        // ISO timestamp
  updatedAt: string;        // ISO timestamp
  model: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  turnCount: number;
  summary: string;           // First user message, truncated
}

interface SavedConversation {
  metadata: ConversationMetadata;
  messages: ChatCompletionMessageParam[];
}
```

### Save Location

Conversations live in `.paulcode/conversations/` inside the project root. Each conversation is a single JSON file named by ID.

```
.paulcode/
  conversations/
    2025-01-15_14-23-45.json
    2025-01-15_16-01-12.json
```

### Implementation

```typescript
// src/conversation.ts

import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

const CONVERSATIONS_DIR = join(process.cwd(), ".paulcode", "conversations");

function ensureDir(): void {
  mkdirSync(CONVERSATIONS_DIR, { recursive: true });
}

function generateId(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

export function saveConversation(
  messages: ChatCompletionMessageParam[],
  model: string,
  inputTokens: number,
  outputTokens: number,
  existingId?: string,
): string {
  ensureDir();

  const id = existingId ?? generateId();
  const firstUserMsg = messages.find((m) => m.role === "user");
  const summary = typeof firstUserMsg?.content === "string"
    ? firstUserMsg.content.slice(0, 100)
    : "No summary";

  const turnCount = messages.filter((m) => m.role === "user").length;

  const conversation: SavedConversation = {
    metadata: {
      id,
      createdAt: existingId ? loadConversation(existingId)!.metadata.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      model,
      totalInputTokens: inputTokens,
      totalOutputTokens: outputTokens,
      turnCount,
      summary,
    },
    messages,
  };

  const filePath = join(CONVERSATIONS_DIR, `${id}.json`);
  writeFileSync(filePath, JSON.stringify(conversation, null, 2), "utf-8");
  return id;
}

export function loadConversation(id: string): SavedConversation | null {
  const filePath = join(CONVERSATIONS_DIR, `${id}.json`);
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as SavedConversation;
}

export function loadLastConversation(): SavedConversation | null {
  ensureDir();
  const files = readdirSync(CONVERSATIONS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();

  if (files.length === 0) return null;
  const id = files[0].replace(".json", "");
  return loadConversation(id);
}

export function listConversations(): ConversationMetadata[] {
  ensureDir();
  const files = readdirSync(CONVERSATIONS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();

  return files.map((f) => {
    const raw = readFileSync(join(CONVERSATIONS_DIR, f), "utf-8");
    const conv = JSON.parse(raw) as SavedConversation;
    return conv.metadata;
  });
}
```

### CLI Integration

Add two flags to the entry point:

```typescript
// In main.ts argument parsing:

if (args.includes("--resume")) {
  const last = loadLastConversation();
  if (!last) {
    console.log("No previous conversations found.");
    process.exit(0);
  }
  console.log(`Resuming conversation from ${last.metadata.updatedAt}`);
  console.log(`(${last.metadata.turnCount} turns, ${last.metadata.summary})\n`);
  messageHistory.push(...last.messages);
  conversationId = last.metadata.id;
  await runInteractiveMode(client, messageHistory, conversationId);
}

else if (args.includes("--history")) {
  const conversations = listConversations();
  if (conversations.length === 0) {
    console.log("No saved conversations.");
    process.exit(0);
  }
  console.log("Saved conversations:\n");
  for (const c of conversations.slice(0, 20)) {
    const tokens = c.totalInputTokens + c.totalOutputTokens;
    console.log(`  ${c.id}  ${c.turnCount} turns  ${tokens} tokens  ${c.summary}`);
  }
  process.exit(0);
}
```

Auto-save after each turn in the interactive loop:

```typescript
// Inside runInteractiveMode, after each agent response:
conversationId = saveConversation(
  messageHistory,
  model,
  totalInputTokens,
  totalOutputTokens,
  conversationId,
);
```

### Expected Behavior

```
$ paul-code
> Explore the auth module and explain the session flow.
[agent explores, reads files, responds]

> /exit
Goodbye. (Conversation saved: 2025-01-15_14-23-45)

$ paul-code --resume
Resuming conversation from 2025-01-15T14:25:00.000Z
(1 turn, Explore the auth module and explain the session flow.)

> Now refactor it to use JWT.
[agent has full context from previous session]

$ paul-code --history
Saved conversations:

  2025-01-15_14-23-45  2 turns  14200 tokens  Explore the auth module and explain the session flow.
  2025-01-14_09-15-30  5 turns  32100 tokens  Fix the flaky test in payment.test.ts
```

---

## 7.4 API Cost Tracking

### What and Why

Each API call costs money. Input tokens and output tokens have different rates. Without tracking, you discover you spent $8 on a debugging session only when the bill arrives. A cost tracker shows running totals per session so you can make informed decisions — like stopping a runaway exploration or choosing a cheaper model for simple tasks.

### Price Table

```typescript
// src/costTracker.ts

interface ModelPricing {
  inputPer1M: number;   // USD per 1M input tokens
  outputPer1M: number;  // USD per 1M output tokens
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  "gpt-4o":             { inputPer1M: 2.50,  outputPer1M: 10.00 },
  "gpt-4o-mini":        { inputPer1M: 0.15,  outputPer1M: 0.60  },
  "gpt-4.1":            { inputPer1M: 2.00,  outputPer1M: 8.00  },
  "gpt-4.1-mini":       { inputPer1M: 0.40,  outputPer1M: 1.60  },
  "gpt-4.1-nano":       { inputPer1M: 0.10,  outputPer1M: 0.40  },
  "gpt-5.2":            { inputPer1M: 2.00,  outputPer1M: 8.00  },
  "claude-sonnet-4-5":  { inputPer1M: 3.00,  outputPer1M: 15.00 },
  "claude-opus-4":      { inputPer1M: 15.00, outputPer1M: 75.00 },
  "claude-sonnet-4":    { inputPer1M: 3.00,  outputPer1M: 15.00 },
};

// Fallback for unknown models — reasonable middle ground
const DEFAULT_PRICING: ModelPricing = { inputPer1M: 3.00, outputPer1M: 15.00 };
```

### Cost Tracker Module

```typescript
// src/costTracker.ts (continued)

interface TurnCost {
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export class CostTracker {
  private model: string;
  private pricing: ModelPricing;
  private turns: TurnCost[] = [];

  constructor(model: string) {
    this.model = model;
    this.pricing = MODEL_PRICING[model] ?? DEFAULT_PRICING;
  }

  recordUsage(inputTokens: number, outputTokens: number): TurnCost {
    const inputCost = (inputTokens / 1_000_000) * this.pricing.inputPer1M;
    const outputCost = (outputTokens / 1_000_000) * this.pricing.outputPer1M;
    const cost = inputCost + outputCost;

    const turn: TurnCost = { inputTokens, outputTokens, cost };
    this.turns.push(turn);
    return turn;
  }

  getTotalInputTokens(): number {
    return this.turns.reduce((sum, t) => sum + t.inputTokens, 0);
  }

  getTotalOutputTokens(): number {
    return this.turns.reduce((sum, t) => sum + t.outputTokens, 0);
  }

  getTotalCost(): number {
    return this.turns.reduce((sum, t) => sum + t.cost, 0);
  }

  formatTurnCost(turn: TurnCost): string {
    return `$${turn.cost.toFixed(4)} (${turn.inputTokens} in, ${turn.outputTokens} out)`;
  }

  formatSessionSummary(): string {
    const totalIn = this.getTotalInputTokens();
    const totalOut = this.getTotalOutputTokens();
    const totalCost = this.getTotalCost();
    return `Session cost: $${totalCost.toFixed(4)} (${formatTokenCount(totalIn)} input, ${formatTokenCount(totalOut)} output, ${this.turns.length} API calls)`;
  }
}

function formatTokenCount(tokens: number): string {
  if (tokens < 1000) return `${tokens}`;
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}K`;
  return `${(tokens / 1_000_000).toFixed(2)}M`;
}
```

### Integration with Agent Loop

Extract token counts from the API response. Both streaming and non-streaming responses include usage data.

```typescript
// Non-streaming:
const response = await client.chat.completions.create({ model, messages, tools });
if (response.usage) {
  const turn = costTracker.recordUsage(
    response.usage.prompt_tokens,
    response.usage.completion_tokens,
  );
  console.log(`  [cost: ${costTracker.formatTurnCost(turn)}]`);
}

// Streaming — request usage in the final chunk:
const stream = await client.chat.completions.create({
  model, messages, tools,
  stream: true,
  stream_options: { include_usage: true },
});

// The last chunk contains usage data:
for await (const chunk of stream) {
  if (chunk.usage) {
    costTracker.recordUsage(chunk.usage.prompt_tokens, chunk.usage.completion_tokens);
  }
  // ... normal chunk processing
}
```

### Display

Show per-turn cost after each agent response, and a session summary at exit:

```typescript
// In the interactive loop, after each agent response:
const turn = costTracker.recordUsage(inputTokens, outputTokens);
console.log(`  [cost: ${costTracker.formatTurnCost(turn)}]`);

// On exit:
console.log(`\n${costTracker.formatSessionSummary()}`);
console.log("Goodbye.");
```

### Expected Behavior

```
$ paul-code
> Read main.ts and explain it.
  [cost: $0.0032 (1200 in, 340 out)]

I'll read the file for you.
[reads main.ts]
This file contains the agent entry point...
  [cost: $0.0089 (3400 in, 520 out)]

> Now add error handling to the parse function.
  [cost: $0.0124 (4800 in, 410 out)]

[edits file, runs tests]
Done. Added try-catch to the parse function.
  [cost: $0.0156 (6100 in, 380 out)]

> /exit

Session cost: $0.0401 (15.5K input, 1.7K output, 4 API calls)
Goodbye.
```

Note that input tokens grow each turn because message history accumulates. This is expected — and makes it obvious why context management (Phase 5) matters.

---

## Summary

| Feature | What It Does | Key File |
|---------|-------------|----------|
| Parallel tool execution | Runs independent read-only tools simultaneously via `Promise.all()` | `agent.ts` |
| Sub-agent delegation | Spawns focused child agents that return summaries, not raw tool output | `tools/spawn_agent.ts` |
| Conversation persistence | Saves/loads conversations as JSON, supports `--resume` and `--history` | `conversation.ts` |
| API cost tracking | Tracks per-turn and per-session costs based on model pricing tables | `costTracker.ts` |

These are all additive features — they layer on top of the existing agent loop without restructuring it. Parallel execution and cost tracking are nearly invisible improvements. Sub-agents and persistence change how the user interacts with the tool, making it practical for multi-session work.
