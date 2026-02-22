import { readdirSync } from "fs";
import type { ToolDefinition } from "../types";

export function listDirectory(path: string = "."): string {
  let entries;
  try {
    entries = readdirSync(path, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return `Error: directory not found: ${path}`;
    }
    return `Error reading directory: ${(err as Error).message}`;
  }

  const dirs: string[] = [];
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    if (entry.isDirectory()) dirs.push(`${entry.name}/`);
    else files.push(entry.name);
  }

  dirs.sort();
  files.sort();
  return [...dirs, ...files].join("\n") || "Directory is empty.";
}

export const list_directory: ToolDefinition = {
  name: "list_directory",
  description: "List directory contents with type indicators (file vs directory).",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory path. Defaults to cwd." },
    },
  },
  execute: (args: Record<string, unknown>) => {
    const path = (args.path as string | undefined) ?? ".";
    return listDirectory(path);
  },
};
