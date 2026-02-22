import fs from "fs";
import { green } from "../colors.js";
import { formatDiff } from "../display.js";
import type { ToolDefinition } from "../types.js";

export function writeToFile(file_path: string, content: string): string {
  let oldContent = "";
  try {
    oldContent = fs.readFileSync(file_path, "utf-8");
  } catch {
    // New file — no old content to diff
  }

  try {
    fs.writeFileSync(file_path, content, "utf-8");
  } catch (err) {
    return `Error writing file: ${err}`;
  }

  if (oldContent) {
    console.log(formatDiff(file_path, oldContent, content));
  } else {
    console.log(green(`+ Created new file: ${file_path} (${content.split("\n").length} lines)`));
  }

  return `Successfully wrote ${file_path}`;
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
    return writeToFile(file_path, content);
  },
};
