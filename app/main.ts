import OpenAI from "openai";
import fs from "fs";
import type { ChatCompletionMessage } from "openai/resources/chat/completions/completions.js";


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
      }
  ];

function readFile({ file_path }: { file_path: string }): string {
  try {
    const data = fs.readFileSync(file_path, "utf8");
    return data;
  } catch (err) {
    return `Error reading file: ${err}`;
  }
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


  const response = await client.chat.completions.create({
    model: "anthropic/claude-haiku-4.5",
    tools,
    messages: [{ role: "user", content: prompt }],
   
  });

  if (!response.choices || response.choices.length === 0) {
    throw new Error("no choices in response");
  }

  // You can use print statements as follows for debugging, they'll be visible when running tests.
  console.error("Logs from your program will appear here!");

  console.log(response.choices[0].message.content);

  const message: ChatCompletionMessage = response.choices[0].message
  const toolCalls: any[] = message.tool_calls ?? []
  for (const toolCall of toolCalls) {
    const tool_id = toolCall.id
    const tool_name = toolCall.function.name
    const tool_args = JSON.parse(toolCall.function.arguments)
    //console.log(`Tool called - \nID: ${tool_id} \nName: ${tool_name} \nArguments: ${JSON.stringify(tool_args)}`);
    if (tool_name === "read_file") {
      const result = readFile(tool_args.file_path);
      console.log(`${result}`);
    }
  }

}

main();
