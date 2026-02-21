import { globSync } from "glob";
import type { ToolDefinition } from "../types";

export function globFind(pattern: string, path: string = "."): string {
  const matches = globSync(pattern, {
    cwd: path,
    ignore: ["**/node_modules/**", "**/.git/**"],
  }).sort();

  if (matches.length === 0) return "No files found.";

  const truncated = matches.slice(0, 200);
  let result = truncated.join("\n");
  if (matches.length > 200) result += `\n\n[... showing 200 of ${matches.length} matches]`;
  return result;
}

export const glob_find: ToolDefinition = {
  name: "glob_find",
  description: "Find files matching a glob pattern. Truncated after 200 matches.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: 'Glob pattern, e.g. "**/*.ts", "*.json"' },
      path: { type: "string", description: "Base directory. Defaults to cwd." },
    },
    required: ["pattern"],
  },
  execute: (args: Record<string, unknown>) => {
    const pattern = args.pattern as string;
    const path = (args.path as string | undefined) ?? ".";
    return globFind(pattern, path);
  },
};
