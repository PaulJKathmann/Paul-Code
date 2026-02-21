import type OpenAI from "openai";
import type { ChatCompletionMessage, ChatCompletionMessageParam } from "openai/resources/chat/completions/completions.js";
import type { ChatCompletionMessageToolCall } from "openai/resources/chat/completions/completions.mjs";
import * as readline from "readline/promises";
import {
  countToolSchemaTokens,
  formatCompactionResult,
  formatContextUsage,
  getContextUsage,
  needsCompaction,
  performCompaction,
} from "./context.js";
import { buildSystemPrompt } from "./prompts.js";
import { countStringTokens } from "./tokens.js";
import { executeTool, toolSchemas } from "./tools/index.js";
import type { AgentConfig, ContextBudget } from "./types.js";

const RESERVED_FOR_RESPONSE_TOKENS = 4096;
const SAFETY_MARGIN_TOKENS = 2000;

function buildBudget(config: AgentConfig): ContextBudget {
  return {
    windowSize: config.contextWindowSize,
    systemPromptTokens: countStringTokens(buildSystemPrompt()),
    toolSchemaTokens: countToolSchemaTokens(toolSchemas),
    reservedForResponse: RESERVED_FOR_RESPONSE_TOKENS,
    safetyMargin: SAFETY_MARGIN_TOKENS,
  };
}

export async function runAgentLoop(
    client: OpenAI,
    messageHistory: ChatCompletionMessageParam[],
    config: AgentConfig,
): Promise<string> {
    const budget = buildBudget(config);
    let iterations = 0;
    const warningThreshold = Math.floor(config.maxIterations * 0.80);
    while (true) {
        if (iterations >= config.maxIterations) {
            console.warn(
                `Reached maximum iterations (${config.maxIterations}). Terminating loop to prevent infinite execution.`,
            );
            return "Error: Maximum iterations reached. Possible infinite loop.";
        } else if (iterations === warningThreshold) {
            messageHistory.push({
                role: "system",
                content:
                    `You have used ${iterations} of ${config.maxIterations} allowed iterations. ` +
                    `Wrap up your current task. Do not start new tool calls unless absolutely necessary.`,
            });
        }

        // Context compaction: strip tool results, then summarize if needed
        if (needsCompaction(getContextUsage(messageHistory, budget))) {
            const result = await performCompaction(messageHistory, budget, client);
            console.log(`[context compacted: ${formatCompactionResult(result)}]`);
        }

        const message: ChatCompletionMessage = await processStreamWithRetries(client, messageHistory, config);
        messageHistory.push(message);

        const toolCalls: ChatCompletionMessageToolCall[] = message.tool_calls ?? [];
        if (toolCalls.length === 0) {
            return message.content ?? "";
        }
        for (const toolCall of toolCalls) {
            if ("function" in toolCall) {
                const result = await executeTool(toolCall.function.name, JSON.parse(toolCall.function.arguments));
                messageHistory.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content: result
                });
            }
                
            else console.error(`tool call type ChatCompletionMessageCustomToolCall not supported: ${JSON.stringify(toolCall)}`);
        }
    }
}

interface ToolCallAccumulator {
    id: string;
    function: {
        name: string;
        arguments: string;
    };
}

async function processStreamWithRetries(
    client: OpenAI,
    messageHistory: ChatCompletionMessageParam[],
    config: AgentConfig,
    maxRetries: number = 3,
) : Promise<ChatCompletionMessage> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await processStream(client, messageHistory, config);
        }
        catch (err) {
            if (attempt === maxRetries) {
                throw err;
            }
            const isRetryable = err instanceof Error &&
            (err.message.includes("ECONNRESET") || err.message.includes("timeout"));
            if (!isRetryable) {
                throw err;
            }
            console.error(`\n[Stream interrupted, retrying... (${attempt + 1}/${maxRetries})]`);
        }
    }   
    throw new Error("Unable to process stream after multiple retries.");
}
async function processStream(
    client: OpenAI,
    messageHistory: ChatCompletionMessageParam[],
    config: AgentConfig,
) : Promise<ChatCompletionMessage> {
    const responseStream = await client.chat.completions.create({
        model: config.model,
        tools: toolSchemas,
        messages: [
            {
            role: "system",
            content: buildSystemPrompt(),
            },
            ...messageHistory,
        ],
        stream: true
        });

    const contentParts: string[] = [];
    const toolCallAccumulators: Map<number, ToolCallAccumulator> = new Map();
    const refusals: string[] = [];
    for await (const chunk of responseStream) {
        const choice = chunk.choices[0]
        if (!choice) continue;
        
        // print out the text as it comes in
        if (choice.delta?.content) {
            process.stdout.write(choice.delta.content);
            contentParts.push(choice.delta.content);
        }
        if (choice.delta.refusal) {
            refusals.push(choice.delta.refusal);
            continue;
        }
        
        // accumulate tool calls
        if (choice.delta?.tool_calls) {
            
            for (const tc of choice.delta.tool_calls) {
                let acc = toolCallAccumulators.get(tc.index);                                                                                               
                if (!acc) {                                                                                                                               
                    acc = { id: "", function: { name: "", arguments: "" } };                                                                                  
                    toolCallAccumulators.set(tc.index, acc);                                                                                                
                }                                                                                                                                           
                acc.id ||= tc.id ?? "";                                                                                                                     
                acc.function.name += tc.function?.name ?? "";                                                                                               
                acc.function.arguments += tc.function?.arguments ?? "";    
            }
        }

        if (choice.finish_reason) break;
    }
    if (contentParts.length > 0) process.stdout.write("\n");
    const fullContent = contentParts.join("") || null;
    const toolCalls = toolCallAccumulators.size > 0 ?
        Array.from(toolCallAccumulators.entries())
        .sort(([a], [b]) => a - b)
        .map(([, acc]) => ({ 
            id: acc.id, 
            type: "function" as const,
            function: { name: acc.function.name, arguments: acc.function.arguments } })) 
        : undefined;
    return {
        role: "assistant",
        content: fullContent,
        tool_calls: toolCalls,
        refusal: refusals.join("") || null
    };
}



export async function runInteractiveMode(
  client: OpenAI,
  messageHistory: ChatCompletionMessageParam[],
  config: AgentConfig,
): Promise<void> {
  console.log("Paul Code — interactive mode");
  console.log("/help for commands. Ctrl+C or /exit to quit.\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const budget = buildBudget(config);

  const commandsHelp =
    `Commands:\n` +
    `  /help        Show this help\n` +
    `  /exit        Quit\n` +
    `  /history     Show how many messages are in context\n` +
    `  /context     Show context window usage breakdown\n` +
    `  /compact     Force context compaction now\n` +
    `  /clear       Clear conversation history (keeps system prompt)\n` +
    `  /model       Show current model\n`;

  const printDivider = () => {
    const width = Math.max(32, Math.min(process.stdout.columns ?? 80, 120));
    console.log("-".repeat(width));
  };

  rl.on("close", () => {
    console.log("\nGoodbye!");
    process.exit(0);
  });

  while (true) {
    const userInputRaw = (await rl.question("\nYou > ")).trim();
    if (!userInputRaw) continue;

    // Commands
    if (userInputRaw.startsWith("/")) {
      const cmd = userInputRaw.toLowerCase();

      switch (cmd) {
        case "/exit":
          rl.close();
          return;
        case "/help":
          console.log(commandsHelp);
          break;
        case "/history":
          console.log(`History: ${messageHistory.length} messages in context.`);
          break;
        case "/clear":
          messageHistory.splice(0, messageHistory.length);
          console.log("History cleared.");
          break;
        case "/model":
          console.log(`Model: ${config.model}`);
          break;
        case "/context": {
          const usage = getContextUsage(messageHistory, budget);
          console.log(`Context window: ${usage.used.toLocaleString()} / ${usage.available.toLocaleString()} tokens (${usage.percentage}%)`);
          console.log(`  Messages: ${messageHistory.length}`);
          console.log(`  System prompt: ${budget.systemPromptTokens.toLocaleString()} tokens`);
          console.log(`  Tool schemas: ${budget.toolSchemaTokens.toLocaleString()} tokens`);
          console.log(`  Reserved for response: ${budget.reservedForResponse.toLocaleString()} tokens`);
          break;
        }
        case "/compact": {
          const result = await performCompaction(messageHistory, budget, client);
          console.log(`Compacted: ${formatCompactionResult(result)}`);
          break;
        }
        default:
          console.log(`Unknown command: ${userInputRaw}. Try /help.`);
          break;
      }
      continue;
    }

    // Normal user message
    messageHistory.push({ role: "user", content: userInputRaw });

    printDivider();
    process.stdout.write("Paul Code > ");
    await runAgentLoop(client, messageHistory, config);
    const usage = getContextUsage(messageHistory, budget);
    console.log(formatContextUsage(usage));
    printDivider();
  }
}
