import OpenAI from "openai";
import fs, { write } from "fs";
import type { ChatCompletionMessage, ChatCompletionToolMessageParam } from "openai/resources/chat/completions/completions.js";
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions/completions.mjs';

type MessageHistoryItem = ChatCompletionMessageParam;
const messageHistory: MessageHistoryItem[] = [];


const tools = [
      {
        type: "function",
        function: {
          name: "read_file",
          description: "Read and return the contents of a file",
          parameters: {
            type: "object",
            properties: {
              file_path: {
                type: "string",
                description: "The path to the file to read",
              },
            },
            required: ["file_path"],
          },
        },
      },
      {
      "type": "function",
      "function": {
        "name": "write_file",
        "description": "Write content to a file",
        "parameters": {
          "type": "object",
          "required": ["file_path", "content"],
          "properties": {
            "file_path": {
              "type": "string",
              "description": "The path of the file to write to"
            },
            "content": {
              "type": "string",
              "description": "The content to write to the file"
            }
          }
        }
      }
    }
  ];

function readFile(file_path: string): string {
  try {
    const data = fs.readFileSync(file_path, "utf8");
    return data;
  } catch (err) {
    return `Error reading file: ${err}`;
  }
}

function writeToFile(file_path: string, content: string): boolean {
  try {
    fs.writeFileSync(file_path, content, "utf8");
    return true;
  } catch (err) {
    console.error(`Error writing file: ${err}`);
    return false;
  }
}


function createToolResponse(toolCallId: string, result: string) : ChatCompletionToolMessageParam {
  return {
    role: "tool",
    tool_call_id: toolCallId,
    content: result,
  };
}



async function main() {
  const [, , flag, prompt] = process.argv;
  const apiKey = process.env.OPENROUTER_API_KEY;
  const baseURL =
    process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }
  if (flag !== "-p" || !prompt) {
    throw new Error("error: -p flag is required");
  }

  const client = new OpenAI({
    apiKey: apiKey,
    baseURL: baseURL,
  });

  messageHistory.push({ role: "user", content: prompt });
  while (true) {
    const response = await client.chat.completions.create({
      model: "anthropic/claude-haiku-4.5",
      tools,
      messages: messageHistory,
    });

    if (!response.choices || response.choices.length === 0) {
      throw new Error("no choices in response");
    }

    // You can use print statements as follows for debugging, they'll be visible when running tests.
    console.error("Logs from your program will appear here!");

    const message: ChatCompletionMessage = response.choices[0].message
    messageHistory.push(message);

    const toolCalls: any[] = message.tool_calls ?? []
    if (toolCalls.length === 0) {
        console.log(message.content);
        return;
    }
    for (const toolCall of toolCalls) {
      const tool_id = toolCall.id
      const tool_name = toolCall.function.name
      const tool_args = JSON.parse(toolCall.function.arguments)
      const file_path = tool_args.file_path;
      //console.log(`Tool called - \nID: ${tool_id} \nName: ${tool_name} \nArguments: ${JSON.stringify(tool_args)}`);
      if (tool_name === "read_file") {
        const result = readFile(file_path);
        const toolResponseMessage = createToolResponse(tool_id, result);
        messageHistory.push(toolResponseMessage);
      }
      else if (tool_name === "write_file") {
        const content = tool_args.content;
        const success = writeToFile(file_path, content);
        const toolResponseMessage = createToolResponse(tool_id, success ? "File written successfully" : "Error writing file");
        messageHistory.push(toolResponseMessage);
      }
    }
  }
}

main();
