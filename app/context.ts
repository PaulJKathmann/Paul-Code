import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions/completions.mjs";
import { countTokens, countStringTokens } from "./tokens.js";
import type { ContextBudget, ContextUsage } from "./types.js";

const TOOL_RESULT_TRUNCATION_LINES = 20;
const TOOL_CONTENT_TOKEN_THRESHOLD = 200;
const RECENT_MESSAGES_TO_PROTECT = 10;
const SUMMARIZATION_THRESHOLD = 0.5;
const COMPACTION_TRIGGER_PCT = 80;

export function getAvailableTokens(budget: ContextBudget): number {
  return (
    budget.windowSize -
    budget.systemPromptTokens -
    budget.toolSchemaTokens -
    budget.reservedForResponse -
    budget.safetyMargin
  );
}

export function countToolSchemaTokens(tools: unknown[]): number {
  return countStringTokens(JSON.stringify(tools));
}

export function getContextUsage(
  messages: ChatCompletionMessageParam[],
  budget: ContextBudget,
): ContextUsage {
  const available = getAvailableTokens(budget);
  const used = countTokens(messages);
  return {
    used,
    available,
    percentage: Math.round((used / available) * 100),
  };
}

export function needsCompaction(usage: ContextUsage): boolean {
  return usage.percentage > COMPACTION_TRIGGER_PCT;
}

/**
 * Two-phase compaction following Claude Code's strategy:
 * Phase 1: Strip old tool results (cheap, no API call)
 * Phase 2: Summarize older conversation if still above 50% (one cheap API call)
 */
export async function compactMessages(
  messages: ChatCompletionMessageParam[],
  availableTokens: number,
  client: OpenAI,
): Promise<ChatCompletionMessageParam[]> {
  // Phase 1: Strip old tool results
  let compacted = truncateOldToolResults([...messages]);
  if (countTokens(compacted) <= availableTokens) return compacted;

  // Phase 2: Summarize if still above 50% capacity
  const usageAfterStrip = countTokens(compacted) / availableTokens;
  if (usageAfterStrip > SUMMARIZATION_THRESHOLD) {
    compacted = await summarizeOlderMessages(compacted, client);
  }
  return compacted;
}

export interface CompactionResult {
  beforeCount: number;
  afterCount: number;
  beforeTokens: number;
  afterTokens: number;
}

/**
 * Perform compaction on a mutable message array in-place.
 * Returns before/after metrics for logging.
 */
export async function performCompaction(
  messageHistory: ChatCompletionMessageParam[],
  budget: ContextBudget,
  client: OpenAI,
): Promise<CompactionResult> {
  const usage = getContextUsage(messageHistory, budget);
  const available = getAvailableTokens(budget);
  const beforeTokens = usage.used;
  const beforeCount = messageHistory.length;

  const compacted = await compactMessages(messageHistory, available, client);
  messageHistory.splice(0, messageHistory.length, ...compacted);

  const afterTokens = countTokens(messageHistory);
  return { beforeCount, afterCount: messageHistory.length, beforeTokens, afterTokens };
}

export function formatCompactionResult(result: CompactionResult): string {
  return (
    `${result.beforeCount} → ${result.afterCount} messages, ` +
    `${result.beforeTokens.toLocaleString()} → ${result.afterTokens.toLocaleString()} tokens`
  );
}

export function formatContextUsage(usage: ContextUsage): string {
  const used = usage.used.toLocaleString();
  const avail = usage.available.toLocaleString();
  if (usage.percentage >= 90)
    return `[tokens: ${used} / ${avail} — context nearly full, compaction imminent]`;
  if (usage.percentage >= 75)
    return `[tokens: ${used} / ${avail} — context 75%+ full]`;
  return `[tokens: ${used} / ${avail}]`;
}

// --- Phase 1: Strip old tool results ---

function truncateOldToolResults(
  messages: ChatCompletionMessageParam[],
): ChatCompletionMessageParam[] {
  const protectedStart = Math.max(
    0,
    messages.length - RECENT_MESSAGES_TO_PROTECT,
  );
  return messages.map((msg, i) => {
    if (i >= protectedStart) return msg;
    if (
      msg.role === "tool" &&
      typeof msg.content === "string" &&
      countStringTokens(msg.content) > TOOL_CONTENT_TOKEN_THRESHOLD
    ) {
      return { ...msg, content: truncateToolContent(msg.content) };
    }
    return msg;
  });
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

function messageToText(msg: ChatCompletionMessageParam): string {
  if (msg.role === "tool") {
    const preview =
      typeof msg.content === "string" ? msg.content.slice(0, 200) : "";
    return `[tool result for ${msg.tool_call_id}: ${preview}...]`;
  }
  if (msg.role === "assistant" && "tool_calls" in msg && msg.tool_calls) {
    const calls = msg.tool_calls
      .map((tc) => {
        if (tc.type === "function") {
          return `${tc.function.name}(${tc.function.arguments.slice(0, 100)}...)`;
        }
        return "[unknown tool call]";
      })
      .join(", ");
    const text = typeof msg.content === "string" ? `\n${msg.content}` : "";
    return `assistant: [called tools: ${calls}]${text}`;
  }
  const content =
    typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
  return `${msg.role}: ${content}`;
}

async function summarizeOlderMessages(
  messages: ChatCompletionMessageParam[],
  client: OpenAI,
): Promise<ChatCompletionMessageParam[]> {
  const splitIndex = Math.max(
    0,
    messages.length - RECENT_MESSAGES_TO_PROTECT,
  );
  const olderMessages = messages.slice(0, splitIndex);
  const recentMessages = messages.slice(splitIndex);

  if (olderMessages.length === 0) return messages;

  const conversationText = olderMessages.map(messageToText).join("\n\n");

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

  const summary =
    summaryResponse.choices[0]?.message?.content ?? "Summary unavailable.";

  const summaryMessage: ChatCompletionMessageParam = {
    role: "user",
    content: `[Conversation summary — earlier messages were compacted to save context]\n\n${summary}`,
  };
  return [summaryMessage, ...recentMessages];
}
