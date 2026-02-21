import { readFileSync, writeFileSync } from "fs";
import type { ToolDefinition } from "../types";

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
  let count = 0,
    position = 0;
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

export const edit_file: ToolDefinition = {
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
        description:
          "Exact string to find. Must match exactly once. Include enough context to be unique.",
      },
      new_string: { type: "string", description: "Replacement string" },
    },
    required: ["file_path", "old_string", "new_string"],
  },
  execute: (args: Record<string, unknown>) => {
    const file_path = args.file_path as string;
    const old_string = args.old_string as string;
    const new_string = args.new_string as string;
    return editFile(file_path, old_string, new_string);
  },
};
