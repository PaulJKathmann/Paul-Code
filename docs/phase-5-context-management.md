# Phase 5: Context Management

[<- Phase 4](phase-4-architecture.md) | [Back to Roadmap](../ROADMAP.md) | [Next: Phase 6 ->](phase-6-safety-and-ux.md)

---

This is the hardest problem in agent engineering. Every model has a fixed context window -- a hard ceiling on the total tokens it can process in a single request. GPT-4o gets 128K tokens. Claude gets 200K. That sounds like a lot until your agent reads a few files, runs some commands, and accumulates tool results. A single `cat package-lock.json` can consume 50K tokens in one shot. Without management, your agent hits the wall mid-task, and the API returns an error with no graceful recovery.

Context management is the difference between a demo that works on small tasks and an agent that can handle real-world projects.

---

## 5.1 Token Counting

### What and Why

You cannot manage what you cannot measure. Before any compaction strategy, you need a function that tells you exactly how many tokens a message array will consume. Token counts are not character counts -- "hello world" is 2 tokens, but a long variable name like `getUserAuthenticationToken` might be 4-6 tokens depending on the tokenizer.

Every model uses a tokenizer to convert text into tokens. OpenAI models use `tiktoken` (or equivalently, `gpt-tokenizer` which is a pure JS port). You need to count tokens **before** sending a request, so you can decide whether to compact first.

### Implementation

Install the tokenizer:

```bash
bun add gpt-tokenizer
```

Build the counting module in `src/tokens.ts`:

```typescript
import { encode } from "gpt-tokenizer";

/**
 * Count tokens in a single string.
 */
export function countStringTokens(text: string): number {
  return encode(text).length;
}

/**
 * Count tokens for a single message.
 * Each message has overhead: role tokens, formatting delimiters.
 * OpenAI uses ~4 tokens per message for framing (role, separators).
 */
function countMessageTokens(message: { role: string; content?: string | null; tool_calls?: any[]; }): number {
  const MESSAGE_OVERHEAD = 4; // <|role|>, newlines, separators
  let tokens = MESSAGE_OVERHEAD;

  if (message.content) {
    tokens += countStringTokens(message.content);
  }

  // Tool calls: count the function name + serialized arguments
  if (message.tool_calls) {
    for (const tc of message.tool_calls) {
      tokens += countStringTokens(tc.function.name);
      tokens += countStringTokens(tc.function.arguments);
      tokens += 4; // overhead per tool call (id, type, delimiters)
    }
  }

  return tokens;
}

/**
 * Count total tokens for an array of messages.
 * Adds 3 tokens for the conversation priming overhead.
 */
export function countTokens(messages: Array<{ role: string; content?: string | null; tool_calls?: any[] }>): number {
  const CONVERSATION_OVERHEAD = 3; // every conversation has priming tokens
  return messages.reduce((sum, msg) => sum + countMessageTokens(msg), CONVERSATION_OVERHEAD);
}
```

### Where to Count

Count tokens at two points in the agent loop:

1. **Before sending a request** -- to decide if compaction is needed
2. **After adding new messages** -- to update the running display for the user

```typescript
// In your agent loop, before the API call:
const totalTokens = countTokens([
  { role: "system", content: SYSTEM_PROMPT },
  ...messageHistory,
]);
```

### Expected Behavior

At this point, nothing changes for the user. You now have the measurement layer. The next sections use it to make decisions.

---

## 5.2 Understanding the Context Budget

### What and Why

A model's context window is shared between input (your messages) and output (the model's response). You cannot use all 128K tokens for input -- you must reserve space for the response. You must also account for fixed costs that never change: the system prompt, tool schemas, and a safety margin.

### The Math

Start with the model's context window and subtract everything that is not your conversation:

| Component | Tokens | Notes |
|-----------|--------|-------|
| Total context window | 128,000 | GPT-4o. Claude is 200,000. |
| System prompt | ~500 | Your identity + rules + working directory |
| Tool schemas | ~1,400 | ~200 tokens per tool x 7 tools |
| Reserved for response | 4,096 | `max_tokens` parameter |
| Safety margin | 2,000 | Tokenizer approximation errors, edge cases |
| **Available for conversation** | **~120,000** | What you actually get to fill |

Put this in `src/context.ts`:

```typescript
export interface ContextBudget {
  windowSize: number;       // model's total context window
  systemPromptTokens: number;
  toolSchemaTokens: number;
  reservedForResponse: number;
  safetyMargin: number;
}

export function getAvailableTokens(budget: ContextBudget): number {
  return (
    budget.windowSize -
    budget.systemPromptTokens -
    budget.toolSchemaTokens -
    budget.reservedForResponse -
    budget.safetyMargin
  );
}
```

### Calculating Tool Schema Tokens

Tool schemas are JSON that gets sent with every request. Count them once at startup:

```typescript
import { countStringTokens } from "./tokens";

export function countToolSchemaTokens(tools: any[]): number {
  // OpenAI serializes tool schemas as JSON in the request
  return countStringTokens(JSON.stringify(tools));
}
```

### Configuration

Different models have different windows. Pull this from your config system (Phase 4):

```typescript
// In your config
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "gpt-4o":       128_000,
  "gpt-4o-mini":  128_000,
  "gpt-5.2":      200_000,
  "claude-sonnet": 200_000,
};
```

---

## 5.3 Context Window Strategies

There are three strategies. Each has tradeoffs. A production agent combines them.

### Strategy 1: Truncation (Drop Oldest Messages)

The simplest approach: when the conversation exceeds the budget, drop the oldest messages until it fits.

**How it works:**
- Always keep the system prompt (not in history, prepended at call time)
- Always keep the most recent N messages
- Drop from the front of the history

**Problem:** The oldest messages are often the most important. The user's first message is their core request. Early file reads contain the code the agent is working with. Dropping them means the agent loses its bearings mid-task.

**When it is acceptable:** Short, independent interactions where early context does not matter.

### Strategy 2: Summarization

Ask the model to compress older messages into a single summary message.

**How it works:**
- When at 80% capacity, take the first 50% of messages
- Send them to the model with "Summarize this conversation so far"
- Replace those messages with one summary message

**Problem:** Costs an extra API call. The summary itself may miss critical details (exact file paths, specific line numbers, error messages). Introduces latency.

**When it is acceptable:** Long-running sessions where you want to preserve high-level context across many turns.

### Strategy 3: Smart Truncation (Truncate Tool Results)

The real insight: **tool results are the biggest context consumers, not conversation flow.** A single `read_file` result can be 5,000 tokens. A `bash` output can be 10,000. But the model's reasoning ("I'll read the config file to check the database URL") is usually under 100 tokens.

**How it works:**
- Leave user messages and assistant reasoning untouched
- Truncate old tool results to first/last N lines
- Insert a `[content truncated -- originally X tokens]` marker
- Keep the most recent tool results intact (the model may still reference them)

**This is the highest-value strategy** because it targets the biggest consumers without losing the conversation thread.

### Recommended Approach: Two-Phase Compaction (Claude Code's Strategy)

This is how Claude Code manages context, and it is the best approach for a production agent. It combines strategies in a deliberate order:

1. **Phase 1 — Strip tool results first.** Tool outputs (file reads, command output, search results) are the biggest context consumers but the lowest-value content after the turn they were used in. Replace old tool results with short summaries or truncated head/tail excerpts. This alone often reclaims 50-70% of used tokens.

2. **Phase 2 — Summarize the conversation.** If stripping tool results still leaves you above 50% capacity, use the LLM to summarize the older portion of the conversation into a single condensed message. This preserves decisions, file paths, error states, and the current plan while shedding verbose intermediate reasoning.

**Why not just drop messages?** Dropping oldest messages (Strategy 1) loses the user's original request and early decisions. Summarization preserves the *meaning* at the cost of one extra API call. The tradeoff is worth it for any non-trivial task.

**Why 50% as the summarization trigger?** After stripping tool results, if you're still above 50%, the conversation itself is long. Summarizing early gives headroom for the next round of tool calls. Waiting until 90% means you might not have enough room for the summary response itself.

---

## 5.4 Implementation

### Context Usage Check

```typescript
import { countTokens, countStringTokens } from "./tokens";

export interface ContextUsage {
  used: number;
  available: number;
  percentage: number;
}

export function getContextUsage(
  messages: any[],
  budget: ContextBudget
): ContextUsage {
  const available = getAvailableTokens(budget);
  const used = countTokens(messages);
  return {
    used,
    available,
    percentage: Math.round((used / available) * 100),
  };
}
```

### The Compaction Algorithm

This is the core of context management. It runs before every API call and returns a (possibly compacted) message array. It follows Claude Code's two-phase approach: strip tool results first, then summarize if still too full.

```typescript
const TOOL_RESULT_TRUNCATION_LINES = 20; // keep first 10 + last 10 lines
const RECENT_MESSAGES_TO_PROTECT = 10;   // never truncate the last N messages
const SUMMARIZATION_THRESHOLD = 0.5;     // summarize if still above 50% after stripping

export async function compactMessages(
  messages: any[],
  availableTokens: number,
  client: OpenAI
): Promise<any[]> {
  let compacted = [...messages]; // shallow copy

  // Phase 1: Strip old tool results
  compacted = truncateOldToolResults(compacted);

  // Check if that was enough
  if (countTokens(compacted) <= availableTokens) {
    return compacted;
  }

  // Phase 2: If still above 50% capacity, summarize older conversation
  const usageAfterStrip = countTokens(compacted) / availableTokens;
  if (usageAfterStrip > SUMMARIZATION_THRESHOLD) {
    compacted = await summarizeOlderMessages(compacted, client);
  }

  return compacted;
}
```

### Step 1: Truncate Old Tool Results

```typescript
function truncateOldToolResults(messages: any[]): any[] {
  const result = [];
  const protectedStartIndex = Math.max(0, messages.length - RECENT_MESSAGES_TO_PROTECT);

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // Don't touch recent messages
    if (i >= protectedStartIndex) {
      result.push(msg);
      continue;
    }

    // Truncate tool results (role: "tool")
    if (msg.role === "tool" && msg.content && countStringTokens(msg.content) > 200) {
      result.push({
        ...msg,
        content: truncateToolContent(msg.content),
      });
      continue;
    }

    result.push(msg);
  }

  return result;
}

function truncateToolContent(content: string): string {
  const lines = content.split("\n");
  if (lines.length <= TOOL_RESULT_TRUNCATION_LINES) return content;

  const half = Math.floor(TOOL_RESULT_TRUNCATION_LINES / 2);
  const head = lines.slice(0, half).join("\n");
  const tail = lines.slice(-half).join("\n");

  return `${head}\n\n[... truncated: ${lines.length} lines total ...]\n\n${tail}`;
}
```

### Phase 2: Summarize Older Messages

When stripping tool results isn't enough, use the model itself to compress the older portion of the conversation into a single summary message. This preserves meaning — decisions, file paths, errors, and the current plan — while shedding verbose intermediate turns.

```typescript
async function summarizeOlderMessages(
  messages: any[],
  client: OpenAI
): Promise<any[]> {
  // Split: older messages get summarized, recent messages stay verbatim
  const splitIndex = Math.max(0, messages.length - RECENT_MESSAGES_TO_PROTECT);
  const olderMessages = messages.slice(0, splitIndex);
  const recentMessages = messages.slice(splitIndex);

  // Nothing old enough to summarize
  if (olderMessages.length === 0) return messages;

  // Build a text representation of the older conversation for the summarizer
  const conversationText = olderMessages
    .map((msg) => {
      if (msg.role === "tool") {
        return `[tool result for ${msg.tool_call_id}: ${msg.content?.slice(0, 200)}...]`;
      }
      if (msg.role === "assistant" && msg.tool_calls) {
        const calls = msg.tool_calls
          .map((tc: any) => `${tc.function.name}(${tc.function.arguments.slice(0, 100)}...)`)
          .join(", ");
        return `assistant: [called tools: ${calls}]${msg.content ? `\n${msg.content}` : ""}`;
      }
      return `${msg.role}: ${msg.content ?? ""}`;
    })
    .join("\n\n");

  // Ask the model to summarize
  const summaryResponse = await client.chat.completions.create({
    model: "gpt-4o-mini", // use a cheap/fast model for summarization
    messages: [
      {
        role: "system",
        content:
          "Summarize the following conversation history. Preserve ALL of the following:\n" +
          "- The user's original request and goal\n" +
          "- Exact file paths that were read or modified\n" +
          "- Key decisions made and their rationale\n" +
          "- Errors encountered and how they were resolved\n" +
          "- The current state of the task (what's done, what's remaining)\n" +
          "Be concise but do not lose critical details. Use bullet points.",
      },
      { role: "user", content: conversationText },
    ],
    max_tokens: 1024,
  });

  const summary = summaryResponse.choices[0]?.message?.content ?? "Summary unavailable.";

  // Replace older messages with the summary
  return [
    {
      role: "user",
      content:
        `[Conversation summary — earlier messages were compacted to save context]\n\n${summary}`,
    },
    ...recentMessages,
  ];
}
```

**Key design decisions:**

- **Use a cheap model for summarization.** `gpt-4o-mini` is fast and cheap. You don't need your primary model for this — it's a compression task, not a reasoning task.
- **Cap the summary at 1024 tokens.** This guarantees you reclaim significant space. If the older conversation was 60K tokens, replacing it with a 1K summary is a 98% reduction.
- **Preserve the summary as a `user` message.** This avoids issues with orphaned `tool_call_id` references. A clean user message with context is all the model needs.
- **Never summarize recent messages.** The last N turns stay verbatim so the model has full fidelity on what it just did.

### Integration with the Agent Loop

Call `compactMessages` before every API request:

```typescript
// In agent.ts, inside the agent loop:

const budget: ContextBudget = {
  windowSize: 128_000,
  systemPromptTokens: countStringTokens(SYSTEM_PROMPT),
  toolSchemaTokens: countToolSchemaTokens(tools),
  reservedForResponse: 4096,
  safetyMargin: 2000,
};

const available = getAvailableTokens(budget);
const usage = getContextUsage(messageHistory, budget);

// Compact if over 80% capacity
// Phase 1 (strip tool results) always runs.
// Phase 2 (summarize) only runs if still above 50% after stripping.
if (usage.percentage > 80) {
  const beforeTokens = usage.used;
  const beforeCount = messageHistory.length;
  messageHistory = await compactMessages(messageHistory, available, client);
  const afterTokens = countTokens(messageHistory);
  const afterCount = messageHistory.length;
  if (afterTokens < beforeTokens) {
    console.log(
      `[context compacted: ${beforeCount} -> ${afterCount} messages, ` +
      `${beforeTokens.toLocaleString()} -> ${afterTokens.toLocaleString()} tokens]`
    );
  }
}

// Now make the API call with the (possibly compacted) history
const response = await processStream(client, [
  { role: "system", content: SYSTEM_PROMPT },
  ...messageHistory,
], tools);
```

---

## 5.5 Displaying Context Usage

### What and Why

The user should know how full the context window is. This is especially important in interactive (REPL) mode where long sessions can creep toward the limit. A sudden "context exceeded" error is a terrible experience -- a gradual warning is much better.

### Token Counter Display

Show the count after every response:

```typescript
function formatContextUsage(usage: ContextUsage): string {
  const usedFormatted = usage.used.toLocaleString();
  const availableFormatted = usage.available.toLocaleString();

  if (usage.percentage >= 90) {
    return `[tokens: ${usedFormatted} / ${availableFormatted} -- context nearly full, older messages will be dropped]`;
  }
  if (usage.percentage >= 75) {
    return `[tokens: ${usedFormatted} / ${availableFormatted} -- context 75%+ full]`;
  }
  return `[tokens: ${usedFormatted} / ${availableFormatted}]`;
}
```

### Integration with the REPL

```typescript
// After each agent response, in the REPL loop:
const usage = getContextUsage(messageHistory, budget);
console.log(formatContextUsage(usage));
```

### Expected Output

Normal operation:

```
> Read the main.ts file
[reads file, explains it]
[tokens: 3,200 / 120,000]

> Now read the config file too
[reads file, explains it]
[tokens: 8,450 / 120,000]
```

Approaching the limit:

```
> Run the full test suite and show me all failures
[runs tests, long output]
[tokens: 95,000 / 120,000 -- context 75%+ full]

> Now fix the failing test in auth.test.ts
[context compacted: 34 -> 22 messages, 110,200 -> 78,400 tokens]
[reads file, makes edit, runs tests]
[tokens: 89,100 / 120,000 -- context 75%+ full]
```

### Compaction Log

When compaction happens, tell the user what happened:

```typescript
// Already shown in the integration section above, but worth emphasizing:
console.log(
  `[context compacted: ${before} -> ${after} messages, ` +
  `${beforeTokens.toLocaleString()} -> ${afterTokens.toLocaleString()} tokens]`
);
```

This is informational, not alarming. The agent continues working normally -- it just has less history to draw from.

---

## Putting It All Together

Here is the complete `src/context.ts` file:

```typescript
import OpenAI from "openai";
import { countTokens, countStringTokens } from "./tokens";

export interface ContextBudget {
  windowSize: number;
  systemPromptTokens: number;
  toolSchemaTokens: number;
  reservedForResponse: number;
  safetyMargin: number;
}

export interface ContextUsage {
  used: number;
  available: number;
  percentage: number;
}

const TOOL_RESULT_TRUNCATION_LINES = 20;
const RECENT_MESSAGES_TO_PROTECT = 10;
const SUMMARIZATION_THRESHOLD = 0.5;

export function getAvailableTokens(budget: ContextBudget): number {
  return (
    budget.windowSize -
    budget.systemPromptTokens -
    budget.toolSchemaTokens -
    budget.reservedForResponse -
    budget.safetyMargin
  );
}

export function countToolSchemaTokens(tools: any[]): number {
  return countStringTokens(JSON.stringify(tools));
}

export function getContextUsage(messages: any[], budget: ContextBudget): ContextUsage {
  const available = getAvailableTokens(budget);
  const used = countTokens(messages);
  return {
    used,
    available,
    percentage: Math.round((used / available) * 100),
  };
}

export async function compactMessages(
  messages: any[],
  availableTokens: number,
  client: OpenAI
): Promise<any[]> {
  // Phase 1: Strip old tool results
  let compacted = truncateOldToolResults([...messages]);
  if (countTokens(compacted) <= availableTokens) return compacted;

  // Phase 2: Summarize if still above 50% capacity
  const usageAfterStrip = countTokens(compacted) / availableTokens;
  if (usageAfterStrip > SUMMARIZATION_THRESHOLD) {
    compacted = 
    await summarizeOlderMessages(compacted, client);
  }
  return compacted;
}

export function formatContextUsage(usage: ContextUsage): string {
  const used = usage.used.toLocaleString();
  const avail = usage.available.toLocaleString();
  if (usage.percentage >= 90) return `[tokens: ${used} / ${avail} -- context nearly full, compaction imminent]`;
  if (usage.percentage >= 75) return `[tokens: ${used} / ${avail} -- context 75%+ full]`;
  return `[tokens: ${used} / ${avail}]`;
}

// --- Phase 1: Strip old tool results ---

function truncateOldToolResults(messages: any[]): any[] {
  const result = [];
  const protectedStart = Math.max(0, messages.length - RECENT_MESSAGES_TO_PROTECT);

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (i >= protectedStart) { result.push(msg); continue; }
    if (msg.role === "tool" && msg.content && countStringTokens(msg.content) > 200) {
      result.push({ ...msg, content: truncateToolContent(msg.content) });
      continue;
    }
    result.push(msg);
  }
  return result;
}

function truncateToolContent(content: string): string {
  const lines = content.split("\n");
  if (lines.length <= TOOL_RESULT_TRUNCATION_LINES) return content;
  const half = Math.floor(TOOL_RESULT_TRUNCATION_LINES / 2);
  return (
    lines.slice(0, half).join("\n") +
    `\n\n[... truncated: ${lines.length} lines total ...]\n\n` +
    lines.slice(-half).join("\n")
  );
}

// --- Phase 2: Summarize older conversation ---

async function summarizeOlderMessages(messages: any[], client: OpenAI): Promise<any[]> {
  const splitIndex = Math.max(0, messages.length - RECENT_MESSAGES_TO_PROTECT);
  const olderMessages = messages.slice(0, splitIndex);
  const recentMessages = messages.slice(splitIndex);

  if (olderMessages.length === 0) return messages;

  const conversationText = olderMessages
    .map((msg) => {
      if (msg.role === "tool") {
        return `[tool result for ${msg.tool_call_id}: ${msg.content?.slice(0, 200)}...]`;
      }
      if (msg.role === "assistant" && msg.tool_calls) {
        const calls = msg.tool_calls
          .map((tc: any) => `${tc.function.name}(${tc.function.arguments.slice(0, 100)}...)`)
          .join(", ");
        return `assistant: [called tools: ${calls}]${msg.content ? `\n${msg.content}` : ""}`;
      }
      return `${msg.role}: ${msg.content ?? ""}`;
    })
    .join("\n\n");

  const summaryResponse = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "Summarize the following conversation history. Preserve ALL of the following:\n" +
          "- The user's original request and goal\n" +
          "- Exact file paths that were read or modified\n" +
          "- Key decisions made and their rationale\n" +
          "- Errors encountered and how they were resolved\n" +
          "- The current state of the task (what's done, what's remaining)\n" +
          "Be concise but do not lose critical details. Use bullet points.",
      },
      { role: "user", content: conversationText },
    ],
    max_tokens: 1024,
  });

  const summary = summaryResponse.choices[0]?.message?.content ?? "Summary unavailable.";

  return [
    {
      role: "user",
      content: `[Conversation summary — earlier messages were compacted to save context]\n\n${summary}`,
    },
    ...recentMessages,
  ];
}
```

---

## Summary

| Component | What It Does |
|-----------|-------------|
| `tokens.ts` | Counts tokens for strings and message arrays using `gpt-tokenizer` |
| `ContextBudget` | Calculates available tokens after subtracting fixed costs |
| Phase 1: Strip tool results | Truncates old tool outputs to first/last N lines — targets the biggest context consumers first |
| Phase 2: Summarize | Uses a cheap model to compress older conversation into a bullet-point summary, preserving decisions and file paths |
| Usage display | Shows `[tokens: X / Y]` after every response, warns at 75% and 90% |

**The two key insights:**

1. **Tool results are the real context hogs.** A 500-line file read is 2,000+ tokens. The model's reasoning about that file is 50-100 tokens. Stripping tool results first targets the biggest consumers with zero information loss to the conversation thread.

2. **Summarization beats truncation.** Dropping oldest messages loses the user's original request and early decisions. Summarization preserves the *meaning* — what was decided, what files were touched, what errors occurred — at the cost of one cheap API call. This is how Claude Code maintains coherence across long sessions.

After this phase, your agent can handle long sessions without hitting context limits. The user sees exactly how much runway they have, and compaction happens automatically — first cheaply (stripping tool outputs), then intelligently (summarizing) — with minimal information loss.
