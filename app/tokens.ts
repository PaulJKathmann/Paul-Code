import { encode } from "gpt-tokenizer";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs";

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
function countContentTokens(content: ChatCompletionMessageParam["content"]): number {
  if (!content) return 0;
  if (typeof content === "string") return countStringTokens(content);
  // Array of content parts — extract text from each part that has it
  return content.reduce((sum, part) => {
    if ("text" in part) return sum + countStringTokens(part.text);
    return sum;
  }, 0);
}

function countMessageTokens(message: ChatCompletionMessageParam): number {
  const MESSAGE_OVERHEAD = 4;
  let tokens = MESSAGE_OVERHEAD + countContentTokens(message.content);

  if ("tool_calls" in message && message.tool_calls) {
    for (const tc of message.tool_calls) {
      if (tc.type === "function") {
        tokens += countStringTokens(tc.function.name);
        tokens += countStringTokens(tc.function.arguments);
      } else {
        tokens += countStringTokens(tc.custom.name);
        tokens += countStringTokens(tc.custom.input);
      }
      tokens += 4;
    }
  }

  return tokens;
}

/**
 * Count total tokens for an array of messages.
 * Adds 3 tokens for the conversation priming overhead.
 */
export function countTokens(messages: ChatCompletionMessageParam[]): number {
  const CONVERSATION_OVERHEAD = 3; // every conversation has priming tokens
  return messages.reduce((sum, msg) => sum + countMessageTokens(msg), CONVERSATION_OVERHEAD);
}