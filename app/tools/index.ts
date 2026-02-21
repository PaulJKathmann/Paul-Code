import type { ToolDefinition } from "../types";

import { read_file, readFile } from "./read_file";
import { write_file, writeToFile } from "./write_file";
import { bash, runBash } from "./bash";
import { edit_file, editFile } from "./edit_file";
import { grep_search, grepSearch } from "./grep_search";
import { glob_find, globFind } from "./glob_find";
import { list_directory, listDirectory } from "./list_directory";

// Convenience exports for direct tool function usage (tests, etc.)
export { readFile, writeToFile, runBash, editFile, grepSearch, globFind, listDirectory };

export const allTools: ToolDefinition[] = [
  read_file,
  write_file,
  bash,
  edit_file,
  grep_search,
  glob_find,
  list_directory,
];

export const toolSchemas = allTools.map((t) => ({
  type: "function" as const,
  function: {
    name: t.name,
    description: t.description,
    parameters: t.parameters
  }
}))

const toolMap = new Map<string, ToolDefinition>(allTools.map((t) => [t.name, t]));

export async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  const tool = toolMap.get(name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  console.log(`${name}(${JSON.stringify(args)})`);
  return await tool.execute(args);
}
