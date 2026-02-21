import fs from "fs";
import type { ToolDefinition } from "../types";

export function readFile(file_path: string): string {
  try {
    const data = fs.readFileSync(file_path, "utf8");
    return data;
  } catch (err) {
    return `Error reading file: ${err}`;
  }
}

export const read_file: ToolDefinition = {
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
  execute: (args: Record<string, unknown>) => {
    const file_path = args.file_path as string;
    return readFile(file_path);
  },
};
