import { execSync } from "child_process";
import type { ToolDefinition } from "../types";

const MAX_OUTPUT_CHARS = 30_000;

function truncateCommandOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output;

  const headSize = Math.floor(MAX_OUTPUT_CHARS * 0.8);
  const tailSize = Math.floor(MAX_OUTPUT_CHARS * 0.2);

  return (
    output.slice(0, headSize) +
    `\n\n[... truncated: showing first ${headSize} and last ${tailSize} chars of ${output.length} total ...]\n\n` +
    output.slice(-tailSize)
  );
}

function truncateLines(output: string, maxLines: number): string {
  const lines = output.split("\n");
  if (lines.length <= maxLines) return output;
  return (
    lines.slice(0, maxLines).join("\n") +
    `\n\n[... showing ${maxLines} of ${lines.length} lines]`
  );
}

function shEscapeSingleQuotes(input: string): string {
  // for wrapping in single quotes in shell
  return input.replace(/'/g, "'\\''");
}

export function grepSearch(pattern: string, path: string = ".", include?: string): string {
  const safePattern = shEscapeSingleQuotes(pattern);
  const safePath = shEscapeSingleQuotes(path);

  // Prefer rg, fall back to grep
  const hasRg = (() => {
    try {
      execSync("command -v rg", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();

  if (hasRg) {
    let cmd = `rg -n --heading -C 0 --max-count 200`;
    if (include) cmd += ` --glob '${shEscapeSingleQuotes(include)}'`;
    cmd += ` -- '${safePattern}' '${safePath}'`;

    try {
      const output = execSync(cmd, {
        encoding: "utf-8",
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
      });
      return truncateLines(output, 100);
    } catch (err: any) {
      if (err?.status === 1) return "No matches found.";
      return `Error: ${err?.stderr || err?.message || err}`;
    }
  }

  // grep fallback
  let grepCmd = `grep -RIn -- '${safePattern}' '${safePath}'`;
  if (include) {
    // Best-effort include using find + grep if include specified
    const safeInclude = shEscapeSingleQuotes(include);
    grepCmd = `find '${safePath}' -type f -name '${safeInclude}' -print0 | xargs -0 grep -n -- '${safePattern}'`;
  }

  try {
    const output = execSync(grepCmd, {
      encoding: "utf-8",
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return truncateLines(output, 100);
  } catch (err: any) {
    if (err?.status === 1) return "No matches found.";
    return `Error: ${err?.stderr || err?.message || err}`;
  }
}

export const grep_search: ToolDefinition = {
  name: "grep_search",
  description:
    "Search file contents for a pattern. Returns matching lines with file paths and line numbers. " +
    "Uses ripgrep under the hood. Supports regex. Truncated after 100 matches.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Search pattern (regex supported)" },
      path: { type: "string", description: "Directory to search. Defaults to cwd." },
      include: { type: "string", description: 'File glob filter, e.g. "*.ts"' },
    },
    required: ["pattern"],
  },
  execute: (args: Record<string, unknown>) => {
    const pattern = args.pattern as string;
    const path = (args.path as string | undefined) ?? ".";
    const include = args.include as string | undefined;
    return grepSearch(pattern, path, include);
  },
};
