import fs from "fs";
import type {
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionToolMessageParam,
} from "openai/resources/chat/completions/completions.js";
import { execSync } from "child_process";
import { globSync } from "glob";

export const tool_definitions: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read and return the contents of a file",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "The path to the file to read",
          },
        },
        required: ["file_path"],
      },
    },
  },
  {
    type: "function",
    function: {
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
    },
  },
  {
    type: "function",
    function: {
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
    },
  },
  {
    type: "function",
    function: {
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
    },
  },
  {
    type: "function",
    function: {
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
    },
  },
  {
    type: "function",
    function: {
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
    },
  },
  {
    type: "function",
    function: {
      name: "list_directory",
      description: "List directory contents with type indicators (file vs directory).",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path. Defaults to cwd." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_fetch",
      description:
        "Fetch a URL and return its text content. HTML tags are stripped for readability. " +
        "Output truncated to 30KB. Timeout: 10 seconds.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The URL to fetch" },
        },
        required: ["url"],
      },
    },
  },
];

export function readFile(file_path: string): string {
  try {
    const data = fs.readFileSync(file_path, "utf8");
    return data;
  } catch (err) {
    return `Error reading file: ${err}`;
  }
}

export function writeToFile(file_path: string, content: string): boolean {
  try {
    fs.writeFileSync(file_path, content, "utf8");
    return true;
  } catch (err) {
    console.error(`Error writing file: ${err}`);
    return false;
  }
}

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

function truncateLines(output: string, maxLines: number): string {
  const lines = output.split("\n");
  if (lines.length <= maxLines) return output;
  return (
    lines.slice(0, maxLines).join("\n") +
    `\n\n[... showing ${maxLines} of ${lines.length} lines]`
  );
}

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

export function listDirectory(path: string = "."): string {
  const entries = fs.readdirSync(path, { withFileTypes: true });
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

const WEB_FETCH_TIMEOUT = 10_000; // 10s

function stripHtmlTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export async function webFetch(url: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEB_FETCH_TIMEOUT);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "PaulCode-Agent/1.0" },
    });
    clearTimeout(timer);

    if (!response.ok) {
      return `Error: HTTP ${response.status} ${response.statusText}`;
    }

    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();

    const body = contentType.includes("html") ? stripHtmlTags(text) : text;
    return truncateCommandOutput(body);
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return `Error: request timed out after ${WEB_FETCH_TIMEOUT / 1000}s`;
    }
    return `Error fetching URL: ${err?.message ?? err}`;
  }
}

export function editFile(file_path: string, old_string: string, new_string: string): string {
    let content: string;
  try {
    content = fs.readFileSync(file_path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return `Error: file not found: ${file_path}`;
    }
    throw err;
  }

  // Count occurrences
  let count = 0, position = 0;
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
  fs.writeFileSync(file_path, newContent, "utf-8");
  return `Successfully edited ${file_path}`;
}

export function createToolResponse(toolCallId: string, result: string) : ChatCompletionToolMessageParam {
  const response: ChatCompletionToolMessageParam =  {
    role: "tool",
    tool_call_id: toolCallId,
    content: result,
  };
  return response;
}


export async function handleToolCall(toolCall: ChatCompletionMessageFunctionToolCall, messageHistory: ChatCompletionMessageParam[]): Promise<void> {
    const toolName = toolCall.function.name;
    const args = JSON.parse(toolCall.function.arguments);
    console.log(`Tool call - ${toolName}: ${JSON.stringify(args)}`);

    const result = await dispatchToolCall(toolName, args);
    if (result === undefined) {
        console.log(`Unknown tool called: ${toolName}`);
        return;
    }

    messageHistory.push(createToolResponse(toolCall.id, result));
}

async function dispatchToolCall(toolName: string, args: Record<string, any>): Promise<string | undefined> {
    switch (toolName) {
        case "read_file":
            return readFile(args.file_path);
        case "write_file":
            return writeToFile(args.file_path, args.content)
                ? "File written successfully"
                : "Error writing file";
        case "bash":
            return runBash(args.command, args.timeout, args.cwd);
        case "grep_search":
            return grepSearch(args.pattern, args.path ?? ".", args.include);
        case "glob_find":
            return globFind(args.pattern, args.path ?? ".");
        case "list_directory":
            return listDirectory(args.path ?? ".");
        case "edit_file":
            return editFile(args.file_path, args.old_string, args.new_string);
        case "web_fetch":
            return await webFetch(args.url);
        default:
            return undefined;
    }
}

