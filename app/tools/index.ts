import type { ToolDefinition } from "../types.js";

import { bash, runBash } from "./bash.js";
import { edit_file, editFile } from "./edit_file.js";
import { glob_find, globFind } from "./glob_find.js";
import { grep_search, grepSearch } from "./grep_search.js";
import { list_directory, listDirectory } from "./list_directory.js";
import { read_file, readFile } from "./read_file.js";
import { write_file, writeToFile } from "./write_file.js";

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
    parameters: t.parameters,
  },
}));

const toolMap = new Map<string, ToolDefinition>(allTools.map((t) => [t.name, t]));

export async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  const tool = toolMap.get(name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return tool.execute(args);
}
