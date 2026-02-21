import fs from "fs";
import type { ToolDefinition } from "../types";

export function writeToFile(file_path: string, content: string): boolean {
  try {
    fs.writeFileSync(file_path, content, "utf8");
    return true;
  } catch (err) {
    console.error(`Error writing file: ${err}`);
    return false;
  }
}

export const write_file: ToolDefinition = {
  name: "write_file",
  description: "Write content to a file",
  parameters: {
    type: "object",
    required: ["file_path", "content"],
    properties: {
      file_path: {
        type: "string",
        description: "The path of the file to write to",
      },
      content: {
        type: "string",
        description: "The content to write to the file",
      },
    },
  },
  execute: (args: Record<string, unknown>) => {
    const file_path = args.file_path as string;
    const content = args.content as string;
    const success = writeToFile(file_path, content);
    return success ? "File written successfully" : "Error writing file";
  },
};
