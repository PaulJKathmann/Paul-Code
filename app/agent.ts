import type OpenAI from "openai";
import * as tools from "./tools.js";
import { SYSTEM_PROMPT } from "./prompts.js";
import type { ChatCompletionMessage, ChatCompletionMessageParam } from "openai/resources/chat/completions/completions.js";
import type {  ChatCompletionMessageToolCall } from 'openai/resources/chat/completions/completions.mjs';
import * as readline from 'readline/promises';

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
        const response = await client.chat.completions.create({
        model: "gpt-5.2",
        tools: tools.tool_definitions,
        messages: [
            {
            role: "system",
            content: SYSTEM_PROMPT,
            },
            ...messageHistory,
        ],
        });

        if (!response.choices || response.choices.length === 0) {
        throw new Error("no choices in response");
        }

        const message: ChatCompletionMessage = response.choices[0].message
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

export async function runInteractiveMode(client: OpenAI, messageHistory: ChatCompletionMessageParam[]) : Promise<void> {
    console.log("Paul Code — interactive mode");
    console.log('Type /exit or press Ctrl+C to quit.\n');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    rl.on("close", () => {
        console.log("\nGoodbye!");
        process.exit(0);
    });
    while (true) {
        const userInput = (await rl.question("> ")).trim();
        if (userInput === "/exit") {
            rl.close();
            break;
        }
        if (userInput === "") continue;
        
        messageHistory.push({ role: "user", content: userInput });
        const result = await runAgentLoop(client, messageHistory);
        console.log(result);
    }
}
