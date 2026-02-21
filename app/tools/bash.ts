import { execSync } from "child_process";
import type { ToolDefinition } from "../types";

const DEFAULT_TIMEOUT = 30_000; // 30s
const MAX_TIMEOUT = 300_000; // 5m
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

export function runBash(command: string, timeoutMs?: number, cwd?: string): string {
  const timeout = Math.min(timeoutMs ?? DEFAULT_TIMEOUT, MAX_TIMEOUT);

  try {
    const stdout = execSync(command, {
      encoding: "utf-8",
      timeout,
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return truncateCommandOutput(stdout);
  } catch (err: any) {
    // Node may signal timeouts via err.killed OR err.code === 'ETIMEDOUT'
    if (err?.killed || err?.code === "ETIMEDOUT") {
      let msg = `Error: command timed out after ${timeout / 1000}s and was killed.`;
      if (err.stdout) msg += `\nStdout:\n${truncateCommandOutput(String(err.stdout))}`;
      if (err.stderr) msg += `\nStderr:\n${truncateCommandOutput(String(err.stderr))}`;
      return msg;
    }

    let output = "";
    if (err?.stdout) output += String(err.stdout);
    if (err?.stderr) output += (output ? "\nSTDERR:\n" : "") + String(err.stderr);
    if (!output) output = `Command failed with exit code ${err?.status ?? "unknown"}`;
    return truncateCommandOutput(output);
  }
}

export const bash: ToolDefinition = {
  name: "bash",
  description:
    "Execute a shell command. Commands killed after timeout. Output truncated if large.",
  parameters: {
    type: "object",
    required: ["command"],
    properties: {
      command: {
        type: "string",
        description: "The command to execute",
      },
      timeout: {
        type: "number",
        description: "Timeout in ms. Default 30000. Max 300000.",
      },
      cwd: {
        type: "string",
        description: "Working directory. Defaults to project root.",
      },
    },
  },
  execute: (args: Record<string, unknown>) => {
    const command = args.command as string;
    const timeout = args.timeout as number | undefined;
    const cwd = args.cwd as string | undefined;
    return runBash(command, timeout, cwd);
  },
};
