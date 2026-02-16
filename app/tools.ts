import fs, { readFileSync, write, writeFileSync } from "fs";
import type { ChatCompletionMessageFunctionToolCall, ChatCompletionMessageParam, ChatCompletionMessageToolCall, ChatCompletionTool, ChatCompletionToolMessageParam } from "openai/resources/chat/completions/completions.js";
import { execSync } from "child_process";

export const tool_definitions: ChatCompletionTool[] = [
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
    },
    {
        "type": "function",
        "function": {
        "name": "Bash",
        "description": "Execute a shell command",
        "parameters": {
          "type": "object",
          "required": ["command"],
          "properties": {
            "command": {
              "type": "string",
              "description": "The command to execute"
            }
          }
        }
      }
    },
    {
        type: "function",
        function: {
            name: "edit_file",
            description:
                "Make a targeted edit by replacing an exact string match with new content. " +
                "The old_string must appear exactly once in the file. " +
                "To insert: use surrounding context as old_string, include it in new_string with the addition. " +
                "To delete: include content to remove in old_string, set new_string to surroundings without it.",
            parameters: {
                type: "object",
                properties: {
                file_path: { type: "string", description: "Path to the file to edit" },
                old_string: {
                    type: "string",
                    description: "Exact string to find. Must match exactly once. Include enough context to be unique.",
                },
                new_string: { type: "string", description: "Replacement string" },
                },
                required: ["file_path", "old_string", "new_string"],
            },
        }
    }
  ];


export function readFile(file_path: string): string {
  try {
    const data = fs.readFileSync(file_path, "utf8");
    return data;
  } catch (err) {
    return `Error reading file: ${err}`;
  }
}

export function writeToFile(file_path: string, content: string): boolean {
  try {
    fs.writeFileSync(file_path, content, "utf8");
    return true;
  } catch (err) {
    console.error(`Error writing file: ${err}`);
    return false;
  }
}

export function runBash(command: string): string {
  try {
    return execSync(command).toString();
  } catch (err) {
    return `Error executing command: ${err}`;
  }
}

export function editFile(file_path: string, old_string: string, new_string: string): string {
    let content: string;
  try {
    content = readFileSync(file_path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return `Error: file not found: ${file_path}`;
    }
    throw err;
  }

  // Count occurrences
  let count = 0, position = 0;
  while ((position = content.indexOf(old_string, position)) !== -1) {
    count++;
    position += 1;
    if (count > 1) break; // No need to count beyond 2nd occurrence
  }

  if (count === 0) {
    return `Error: old_string not found in ${file_path}. Make sure it matches exactly, including whitespace.`;
  }
  if (count > 1) {
    return `Error: old_string appears ${count} times in ${file_path}. Include more surrounding context.`;
  }

  const newContent = content.replace(old_string, new_string);
  writeFileSync(file_path, newContent, "utf-8");
  return `Successfully edited ${file_path}`;
}

export function createToolResponse(toolCallId: string, result: string) : ChatCompletionToolMessageParam {
  const response: ChatCompletionToolMessageParam =  {
    role: "tool",
    tool_call_id: toolCallId,
    content: result,
  };
  return response;
}


export function handleToolCall(toolCall: ChatCompletionMessageFunctionToolCall, messageHistory: ChatCompletionMessageParam[]) : void {
    const tool_id = toolCall.id
    const tool_name = toolCall.function.name
    const tool_args = JSON.parse(toolCall.function.arguments)
    const file_path = tool_args.file_path;
    console.log(`Tool call - ${tool_name}: ${JSON.stringify(tool_args)}`);
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
    else if (tool_name === "Bash") {
        const command = tool_args.command;
        const result = runBash(command);
        const toolResponseMessage = createToolResponse(tool_id, result);
        messageHistory.push(toolResponseMessage);
    }
    else if (tool_name === "edit_file") {
        const old_string = tool_args.old_string;
        const new_string = tool_args.new_string;
        const result = editFile(file_path, old_string, new_string);
        const toolResponseMessage = createToolResponse(tool_id, result);
        messageHistory.push(toolResponseMessage);
    }
    else {
        console.log(`Unknown tool called: ${tool_name}`);
        return;
    }
}

