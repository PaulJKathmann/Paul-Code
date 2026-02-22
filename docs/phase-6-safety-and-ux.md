# Phase 6: Safety & UX

[← Phase 5](phase-5-context-management.md) | [Back to Roadmap](../ROADMAP.md) | [Next: Phase 7 →](phase-7-advanced-patterns.md)

---

The agent works, but it does not feel like a real tool. Bash commands run without asking. Output is a wall of monochrome text. File changes happen silently. There is no indication that anything is happening while the model thinks. This phase adds the layer between "technically functional" and "something you would actually trust to run in your project directory."

---

## 6.1 Dangerous Operation Classification ✅

### What and Why

The agent can run `rm -rf /` if the model asks it to. It can `git push --force` to main, `curl | sh` arbitrary scripts, or `chmod 777` your SSH keys. None of these require confirmation. Every production coding agent classifies tool calls by risk level and gates dangerous ones behind a confirmation prompt.

### Risk Levels

| Level | Behavior | Tools |
|-------|----------|-------|
| **Safe** | Execute silently | `read_file`, `grep_search`, `glob_find`, `list_directory` |
| **Moderate** | Show what will happen, then execute | `write_file`, `edit_file` |
| **Dangerous** | Show what will happen, require explicit Y/n | `bash` (matching patterns) |

Dangerous bash patterns — commands where a mistake is hard to undo:

```typescript
const DANGEROUS_PATTERNS = [
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
```

### Implementation

Create `src/safety.ts`:

```typescript
type RiskLevel = "safe" | "moderate" | "dangerous";

const SAFE_TOOLS = new Set(["read_file", "grep_search", "glob_find", "list_directory"]);
const MODERATE_TOOLS = new Set(["write_file", "edit_file"]);

const DANGEROUS_PATTERNS: RegExp[] = [
  /\brm\s/, /\bgit\s+push\b/, /\bgit\s+reset\s+--hard\b/,
  /\bsudo\b/, /\bchmod\b/, /\bcurl\b.*\|\s*sh/, /\bwget\b.*\|\s*sh/,
  />\s*\/dev\//, /\bdd\b/, /\bmkfs\b/, /\bkill\b/, /\bpkill\b/,
];

export function classifyRisk(toolName: string, args: Record<string, unknown>): RiskLevel {
  if (SAFE_TOOLS.has(toolName)) return "safe";
  if (MODERATE_TOOLS.has(toolName)) return "moderate";

  if (toolName === "bash") {
    const command = String(args.command ?? "");
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(command)) return "dangerous";
    }
    return "moderate"; // non-matching bash is moderate, not safe
  }

  return "moderate"; // unknown tools default to moderate
}
```

### Confirmation Prompt

When a tool call is classified as dangerous, show the command and block until the user responds:

```typescript
import * as readline from "readline";

export async function confirmDangerous(toolName: string, args: Record<string, unknown>): Promise<boolean> {
  const command = toolName === "bash" ? String(args.command) : JSON.stringify(args);

  process.stdout.write(`\n\x1b[33m⚠ Dangerous operation:\x1b[0m ${toolName}\n`);
  process.stdout.write(`\x1b[2m  ${command}\x1b[0m\n`);
  process.stdout.write(`\x1b[33mProceed? [Y/n]\x1b[0m `);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question("", (a) => { rl.close(); resolve(a); });
  });

  const trimmed = answer.trim().toLowerCase();
  return trimmed === "" || trimmed === "y" || trimmed === "yes";
}
```

### Integration with Agent Loop

In the tool execution section of your agent loop, add the gate:

```typescript
const risk = classifyRisk(toolCall.function.name, parsedArgs);

if (risk === "dangerous") {
  const confirmed = await confirmDangerous(toolCall.function.name, parsedArgs);
  if (!confirmed) {
    toolResult = "Operation cancelled by user.";
    // push tool result to messages and continue — the model will see the cancellation
  }
}
```

### Expected Behavior

```
⏵ bash rm -rf dist/
⚠ Dangerous operation: bash
  rm -rf dist/
Proceed? [Y/n] y
✓ bash (0.1s)

⏵ bash git push --force origin main
⚠ Dangerous operation: bash
  git push --force origin main
Proceed? [Y/n] n
Operation cancelled by user.
```

Safe operations like `read_file` and `grep_search` execute immediately with no prompt. Moderate operations like `write_file` show the diff (Section 6.3) but don't block. Dangerous operations require explicit confirmation.

---

## 6.2 Colored Output ✅

### What and Why

Every line of output currently looks the same. The user cannot quickly distinguish assistant text from tool names from errors. Color provides instant visual hierarchy without changing the content.

### ANSI Escape Codes

Terminals interpret escape sequences starting with `\x1b[` (ESC + `[`) as formatting instructions. The format is `\x1b[<code>m` to start and `\x1b[0m` to reset.

| Code | Effect |
|------|--------|
| `0` | Reset all |
| `1` | Bold |
| `2` | Dim |
| `31` | Red |
| `32` | Green |
| `33` | Yellow |
| `36` | Cyan |

### Implementation

Create `src/colors.ts`:

```typescript
const enabled = !process.env.NO_COLOR && process.stdout.isTTY;

function wrap(code: number, text: string): string {
  if (!enabled) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

export const red    = (t: string) => wrap(31, t);
export const green  = (t: string) => wrap(32, t);
export const yellow = (t: string) => wrap(33, t);
export const cyan   = (t: string) => wrap(36, t);
export const bold   = (t: string) => wrap(1, t);
export const dim    = (t: string) => wrap(2, t);
```

That is the entire module. No dependencies. The `NO_COLOR` check respects the [no-color.org](https://no-color.org/) convention — if the environment variable is set (to any value), all color is disabled. The `isTTY` check disables color when piping output to a file or another process.

### Color Scheme

Apply colors in the agent loop and tool execution:

```typescript
import { cyan, dim, red, yellow, green, bold } from "./colors.js";

// Tool execution header
console.log(`${cyan("⏵")} ${cyan(toolName)} ${dim(summarizeArgs(toolName, args))}`);

// Tool result (dimmed — the result is context, not the answer)
console.log(dim(truncateForDisplay(result)));

// Errors
console.error(red(`Error: ${message}`));

// Warnings (like iteration guard)
console.warn(yellow(`Warning: approaching iteration limit`));

// Success indicators
console.log(green(`✓ ${toolName}`) + dim(` (${elapsed}ms)`));

// Streaming text — no color needed, default terminal foreground
process.stdout.write(chunk);
```

### Expected Behavior

Tool calls appear in cyan. Arguments are dimmed so they don't compete with the tool name. Results are dimmed. Errors are red. The user's eyes immediately go to the right place.

When `NO_COLOR=1` is set, all `wrap()` calls return the text unchanged. When output is piped (`echo "test" | paul-code -p "...")`), `isTTY` is false and colors are disabled.

---

## 6.3 Diff Display for File Changes ✅

### What and Why

When `write_file` or `edit_file` runs, the user sees "Successfully edited src/parser.ts" — but has no idea what changed. Showing a diff before or alongside the operation lets the user catch mistakes immediately.

### Implementation

Install the `diff` package:

```bash
bun add diff
```

Create a `showDiff` function in `src/display.ts`:

```typescript
import { createTwoFilesPatch } from "diff";
import { red, green, dim, cyan } from "./colors.js";

export function formatDiff(filePath: string, oldContent: string, newContent: string): string {
  const patch = createTwoFilesPatch(
    `a/${filePath}`, `b/${filePath}`,
    oldContent, newContent,
    "", "",
    { context: 3 },
  );

  // Colorize the unified diff
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
```

### Integration with Tools

For `edit_file`, you already have the old content (you read it to find the match). Capture it before and after:

```typescript
function editFile(filePath: string, oldString: string, newString: string): string {
  const oldContent = readFileSync(filePath, "utf-8");

  // ... existing validation (count occurrences, etc.) ...

  const newContent = oldContent.replace(oldString, newString);
  writeFileSync(filePath, newContent, "utf-8");

  // Show the diff
  console.log(formatDiff(filePath, oldContent, newContent));

  return `Successfully edited ${filePath}`;
}
```

For `write_file`, read the existing content first (if the file exists):

```typescript
function writeFile(filePath: string, content: string): string {
  let oldContent = "";
  try {
    oldContent = readFileSync(filePath, "utf-8");
  } catch {
    // New file — no diff to show
  }

  writeFileSync(filePath, content, "utf-8");

  if (oldContent) {
    console.log(formatDiff(filePath, oldContent, content));
  } else {
    console.log(green(`+ Created new file: ${filePath} (${content.split("\n").length} lines)`));
  }

  return `Successfully wrote ${filePath}`;
}
```

### Expected Behavior

```
⏵ edit_file src/parser.ts
--- a/src/parser.ts
+++ b/src/parser.ts
@@ -12,3 +12,5 @@
 function parse(input: string) {
-  const result = JSON.parse(input);
+  try {
+    const result = JSON.parse(input);
+  } catch (e) {
✓ edit_file (2ms)
```

Additions in green, deletions in red, context in dim, hunk headers in cyan. The user sees exactly what changed without running `git diff`.

---

## 6.4 Spinner / Progress Indicator ✅

### What and Why

After the user types a message, there is a dead period while the API request is in flight. With streaming (Phase 3), the first token might take 1-5 seconds. Without any feedback, the user wonders if the tool froze. A spinner solves this — a small animated character that runs until output begins.

### Implementation

Create `src/spinner.ts`:

```typescript
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

let interval: ReturnType<typeof setInterval> | null = null;
let frameIndex = 0;

export function startSpinner(message: string = "Thinking"): void {
  if (!process.stdout.isTTY) return; // no spinner when piped
  frameIndex = 0;

  interval = setInterval(() => {
    const frame = FRAMES[frameIndex % FRAMES.length];
    // \r moves cursor to start of line, \x1b[K clears to end of line
    process.stdout.write(`\r\x1b[K\x1b[2m${frame} ${message}...\x1b[0m`);
    frameIndex++;
  }, 80);
}

export function stopSpinner(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
    // Clear the spinner line completely
    process.stdout.write("\r\x1b[K");
  }
}
```

### How It Works

- `\r` moves the cursor to the beginning of the current line (carriage return)
- `\x1b[K` clears from the cursor to the end of the line
- Together, they overwrite the spinner with each frame, then erase it when done
- The 80ms interval gives a smooth animation (~12 fps)
- `isTTY` check prevents garbled output when piped

### Integration with Agent Loop

```typescript
import { startSpinner, stopSpinner } from "./spinner.js";

// Before the API call
startSpinner("Thinking");

const stream = await client.chat.completions.create({
  model: "gpt-5.2", messages, tools, stream: true,
});

let firstChunk = true;
for await (const chunk of stream) {
  if (firstChunk) {
    stopSpinner(); // Clear spinner before first output
    firstChunk = false;
  }
  // ... process chunk as before
}

// Safety: always stop spinner (in case stream is empty)
stopSpinner();
```

The spinner starts before the API call. It stops the moment the first chunk arrives. Between those two events, the user sees `⠋ Thinking...` cycling through its frames. When text starts streaming, the spinner line is erased and output flows normally.

### Edge Case: Tool Execution

You can also show a spinner during long-running tool calls:

```typescript
startSpinner(`Running ${toolName}`);
const result = await executeTool(toolName, args);
stopSpinner();
```

This is optional. Short tool calls (read_file, edit_file) complete in milliseconds and don't need a spinner. Bash commands that take over ~500ms benefit from it.

---

## 6.5 Tool Execution Display ✅

### What and Why

Raw tool output is noisy. The user sees JSON arguments, multi-kilobyte file contents, and command output with no visual separation. Formatting tool calls consistently makes the output scannable.

### Display Format

```
⏵ read_file src/main.ts
✓ read_file (3ms) — 178 lines

⏵ bash npm test
✓ bash (4.2s) — 23 lines

⏵ edit_file src/parser.ts
--- a/src/parser.ts
+++ b/src/parser.ts
@@ -12,3 +12,5 @@
...
✓ edit_file (2ms) — 3 lines changed
```

### Implementation

Create the display helpers in `src/display.ts`:

```typescript
import { cyan, dim, green, red, yellow } from "./colors.js";

export function formatToolHeader(toolName: string, args: Record<string, unknown>): string {
  const summary = summarizeArgs(toolName, args);
  return `${cyan("⏵")} ${cyan(toolName)} ${dim(summary)}`;
}

export function formatToolResult(toolName: string, elapsed: number, result: string): string {
  const elapsedStr = elapsed >= 1000
    ? `${(elapsed / 1000).toFixed(1)}s`
    : `${Math.round(elapsed)}ms`;

  const lineCount = result.split("\n").length;
  const summary = lineCount > 1 ? ` — ${lineCount} lines` : "";

  return `${green("✓")} ${green(toolName)} ${dim(`(${elapsedStr})${summary}`)}`;
}

function summarizeArgs(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case "read_file":
    case "write_file":
    case "edit_file":
      return String(args.file_path ?? "");
    case "bash":
      return truncateLine(String(args.command ?? ""), 80);
    case "grep_search":
      return truncateLine(String(args.pattern ?? ""), 60);
    case "glob_find":
      return truncateLine(String(args.pattern ?? ""), 60);
    case "list_directory":
      return String(args.path ?? ".");
    default:
      return "";
  }
}

function truncateLine(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}
```

### Collapsing Large Results

Tool results that are hundreds of lines long should not flood the terminal. Collapse them:

```typescript
const MAX_DISPLAY_LINES = 20;

export function formatToolOutput(result: string): string {
  const lines = result.split("\n");
  if (lines.length <= MAX_DISPLAY_LINES) {
    return dim(result);
  }

  const shown = lines.slice(0, MAX_DISPLAY_LINES).join("\n");
  const hidden = lines.length - MAX_DISPLAY_LINES;
  return dim(shown) + `\n${dim(`[... ${hidden} more lines]`)}`;
}
```

The full result still goes into message history for the model. Collapsing is display-only — the model sees everything, the user sees a summary.

### Timing

Wrap tool execution with a timer:

```typescript
const start = performance.now();
const result = await executeTool(toolName, parsedArgs);
const elapsed = performance.now() - start;

console.log(formatToolHeader(toolName, parsedArgs));
console.log(formatToolOutput(result));
console.log(formatToolResult(toolName, elapsed, result));
```

### Expected Behavior

```
You: Find all TODO comments and fix the first one.

⏵ grep_search TODO
  src/main.ts:42:  // TODO: add error handling
  src/parser.ts:18:  // TODO: validate input
  src/config.ts:7:  // TODO: load from file
✓ grep_search (45ms) — 3 lines

⏵ read_file src/main.ts
  [... 158 more lines]
✓ read_file (2ms) — 178 lines

I found 3 TODOs. The first one is at src/main.ts:42. Let me add error handling there.

⏵ edit_file src/main.ts
--- a/src/main.ts
+++ b/src/main.ts
@@ -40,5 +40,9 @@
   const data = await fetchData(url);
-  // TODO: add error handling
-  return process(data);
+  try {
+    return process(data);
+  } catch (error) {
+    console.error(`Failed to process data: ${error}`);
+    throw error;
+  }
✓ edit_file (3ms) — 4 lines changed
```

Tool names in cyan. Arguments dimmed. Diffs colored. Timing shown. Large outputs collapsed. The terminal is now scannable.

---

## Summary

| Feature | Before | After |
|---------|--------|-------|
| Safety | All operations run without confirmation | Dangerous commands require Y/n, moderate show what will change |
| Color | Monochrome wall of text | Tool names, errors, diffs, and status all color-coded |
| Diffs | "Successfully edited file" — user has no idea what changed | Unified diff with green/red additions/deletions |
| Spinner | Dead silence while model thinks | Animated indicator until first token arrives |
| Tool display | Raw JSON args and multi-KB output dumps | Formatted headers, timing, collapsed results |

New files in this phase:

| File | Purpose |
|------|---------|
| `src/safety.ts` | `classifyRisk()`, `confirmDangerous()`, dangerous pattern list |
| `src/colors.ts` | `red()`, `green()`, `dim()`, `cyan()`, `bold()`, `yellow()` — 15 lines |
| `src/spinner.ts` | `startSpinner()`, `stopSpinner()` — 25 lines |
| `src/display.ts` | `formatDiff()`, `formatToolHeader()`, `formatToolResult()`, `formatToolOutput()` |

One new dependency: `diff` (for unified diff generation).
