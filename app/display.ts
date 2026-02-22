import { createTwoFilesPatch } from "diff";
import { bold, cyan, dim, green, red } from "./colors.js";

const MAX_DISPLAY_LINES = 20;

export function formatDiff(filePath: string, oldContent: string, newContent: string): string {
  const patch = createTwoFilesPatch(
    `a/${filePath}`,
    `b/${filePath}`,
    oldContent,
    newContent,
    "",
    "",
    { context: 3 },
  );

  return patch
    .split("\n")
    .map((line) => {
      if (line.startsWith("+++") || line.startsWith("---")) return bold(line);
      if (line.startsWith("+")) return green(line);
      if (line.startsWith("-")) return red(line);
      if (line.startsWith("@@")) return cyan(line);
      return dim(line);
    })
    .join("\n");
}

export function formatToolHeader(toolName: string, args: Record<string, unknown>): string {
  const summary = summarizeArgs(toolName, args);
  return `${cyan("⏵")} ${cyan(toolName)} ${dim(summary)}`;
}

export function formatToolResult(toolName: string, elapsedMs: number, result: string): string {
  const elapsed =
    elapsedMs >= 1000 ? `${(elapsedMs / 1000).toFixed(1)}s` : `${Math.round(elapsedMs)}ms`;

  const lineCount = result.split("\n").length;
  const summary = lineCount > 1 ? ` — ${lineCount} lines` : "";

  return `${green("✓")} ${green(toolName)} ${dim(`(${elapsed})${summary}`)}`;
}

export function formatToolOutput(result: string): string {
  const lines = result.split("\n");
  if (lines.length <= MAX_DISPLAY_LINES) {
    return dim(result);
  }

  const shown = lines.slice(0, MAX_DISPLAY_LINES).join("\n");
  const hidden = lines.length - MAX_DISPLAY_LINES;
  return `${dim(shown)}\n${dim(`[... ${hidden} more lines]`)}`;
}

function summarizeArgs(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case "read_file":
    case "write_file":
    case "edit_file":
      return String(args.file_path ?? "");
    case "bash":
      return truncate(String(args.command ?? ""), 80);
    case "grep_search":
    case "glob_find":
      return truncate(String(args.pattern ?? ""), 60);
    case "list_directory":
      return String(args.path ?? ".");
    default:
      return "";
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}
