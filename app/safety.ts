import * as readline from "readline";
import { dim, yellow } from "./colors.js";

export type RiskLevel = "safe" | "moderate" | "dangerous";

const SAFE_TOOLS = new Set(["read_file", "grep_search", "glob_find", "list_directory"]);

const DANGEROUS_BASH_PATTERNS: RegExp[] = [
  /\brm\s/,
  /\bgit\s+push\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bsudo\b/,
  /\bchmod\b/,
  /\bcurl\b.*\|\s*sh/,
  /\bwget\b.*\|\s*sh/,
  />\s*\/dev\//,
  /\bdd\b/,
  /\bmkfs\b/,
  /\bkill\b/,
  /\bpkill\b/,
  /\breboot\b/,
  /\bshutdown\b/,
];

export function classifyRisk(toolName: string, args: Record<string, unknown>): RiskLevel {
  if (SAFE_TOOLS.has(toolName)) return "safe";

  if (toolName === "bash") {
    const command = String(args.command ?? "");
    const isDangerous = DANGEROUS_BASH_PATTERNS.some((pattern) => pattern.test(command));
    return isDangerous ? "dangerous" : "moderate";
  }

  return "moderate";
}

export async function confirmDangerous(
  toolName: string,
  args: Record<string, unknown>,
): Promise<boolean> {
  const command = toolName === "bash" ? String(args.command) : JSON.stringify(args);

  process.stdout.write(`\n${yellow("⚠ Dangerous operation:")} ${toolName}\n`);
  process.stdout.write(`${dim(`  ${command}`)}\n`);
  process.stdout.write(`${yellow("Proceed? [Y/n]")} `);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question("", (a) => {
      rl.close();
      resolve(a);
    });
  });

  const trimmed = answer.trim().toLowerCase();
  return trimmed === "" || trimmed === "y" || trimmed === "yes";
}
