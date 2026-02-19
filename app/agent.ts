import type OpenAI from "openai";
import * as tools from "./tools.js";
import { SYSTEM_PROMPT } from "./prompts.js";
import type { ChatCompletionMessage, ChatCompletionMessageParam } from "openai/resources/chat/completions/completions.js";
import type {  ChatCompletionMessageToolCall } from 'openai/resources/chat/completions/completions.mjs';
import * as readline from 'readline/promises';
import type { Tool } from "openai/resources/responses/responses.mjs";
import type { ToolCall } from "openai/resources/beta/threads/runs.mjs";
import { error } from "console";

export async function runAgentLoop(client: OpenAI, messageHistory: ChatCompletionMessageParam[], maxIterations: number = 50): Promise<string> {
    let iterations = 0;
    const warningThreshold = Math.floor(maxIterations * 0.80);
    while (true) {
        if (iterations >= maxIterations) {
            console.warn(`Reached maximum iterations (${maxIterations}). Terminating loop to prevent infinite execution.`);
            return "Error: Maximum iterations reached. Possible infinite loop.";
        } else if (iterations === warningThreshold) {
            messageHistory.push({
                role: "system",
                content:  `You have used ${iterations} of ${maxIterations} allowed iterations. ` +
                `Wrap up your current task. Do not start new tool calls unless absolutely necessary.`,
            });
        }
        const message: ChatCompletionMessage = await processStreamWithRetries(client, messageHistory);
        messageHistory.push(message);

        const toolCalls: ChatCompletionMessageToolCall[] = message.tool_calls ?? [];
        if (toolCalls.length === 0) {
            return message.content ?? "";
        }
        for (const toolCall of toolCalls) {
            if ("function" in toolCall) tools.handleToolCall(toolCall, messageHistory);
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
};

async function processStreamWithRetries(client: OpenAI, messageHistory: ChatCompletionMessageParam[], maxRetries: number = 3) : Promise<ChatCompletionMessage> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await processStream(client, messageHistory);
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
const MODEL_NAME = "gpt-5.2";

async function processStream(client: OpenAI, messageHistory: ChatCompletionMessageParam[]) : Promise<ChatCompletionMessage> {
    const responseStream = await client.chat.completions.create({
        model: MODEL_NAME,
        tools: tools.tool_definitions,
        messages: [
            {
            role: "system",
            content: SYSTEM_PROMPT,
            },
            ...messageHistory,
        ],
        stream: true
        });

    const contentParts: string[] = [];
    const toolCallAccumulators: Map<number, ToolCallAccumulator> = new Map();
    const refusals: string[] = [];
    let finishReason: string | undefined = undefined;
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

        if (choice.finish_reason) {
            finishReason = choice.finish_reason;
        }
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
): Promise<void> {
  console.log("Paul Code — interactive mode");
  console.log("/help for commands. Ctrl+C or /exit to quit.\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const commandsHelp =
    `Commands:\n` +
    `  /help        Show this help\n` +
    `  /exit        Quit\n` +
    `  /history     Show how many messages are in context\n` +
    `  /clear       Clear conversation history (keeps system prompt)\n` +
    `  /model       Show current model\n`;

  const modelName = "gpt-5.2";

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

      if (cmd === "/exit") {
        rl.close();
        break;
      }

      if (cmd === "/help") {
        console.log(commandsHelp);
        continue;
      }

      if (cmd === "/history") {
        console.log(`History: ${messageHistory.length} messages in context.`);
        continue;
      }

      if (cmd === "/clear") {
        messageHistory.splice(0, messageHistory.length);
        console.log("History cleared.");
        continue;
      }

      if (cmd === "/model") {
        console.log(`Model: ${modelName}`);
        continue;
      }

      console.log(`Unknown command: ${userInputRaw}. Try /help.`);
      continue;
    }

    // Normal user message
    messageHistory.push({ role: "user", content: userInputRaw });

    printDivider();
    process.stdout.write("Paul Code > ");
    await runAgentLoop(client, messageHistory);
    printDivider();
  }
}
