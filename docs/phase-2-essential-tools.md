# Phase 2: Essential Tools

[← Phase 1](phase-1-core-agent-behavior.md) | [Back to Roadmap](../ROADMAP.md) | [Next: Phase 3 →](phase-3-streaming-output.md)

---

Phase 1 gave you a working agent loop with three primitive tools. That is enough to prove the loop works, but not enough to do real work. The agent cannot make a small edit without rewriting an entire file. It cannot find files without already knowing their paths. And the Bash tool will hang, blow up context, or silently swallow errors.

---

## 2.1 Edit Tool (Surgical File Edits)

### Why `write_file` Is Not Enough

- **Model must reproduce the entire file perfectly.** 500 lines to change 3 — every unchanged line is a line it might corrupt.
- **Expensive on context.** ~160x more tokens than necessary for targeted edits.
- **Destroys unseen content.** If the model only read lines 1-100 of a 500-line file, `write_file` deletes lines 101-500.

### The Standard Pattern

Every serious coding agent uses: `edit_file(file_path, old_string, new_string)`

The model provides exact text to find and what to replace it with. The tool finds that exact substring, verifies it appears exactly once, performs the replacement, and writes back. This is deliberately not regex or line-number-based — exact string matching is the most robust approach.

### Tool Schema

```typescript
{
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
        description: "Exact string to find. Must match exactly once. Include enough context to be unique.",
      },
      new_string: { type: "string", description: "Replacement string" },
    },
    required: ["file_path", "old_string", "new_string"],
  },
}
```

### Implementation

```typescript
import { readFileSync, writeFileSync } from "fs";

function editFile(filePath: string, oldString: string, newString: string): string {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return `Error: file not found: ${filePath}`;
    }
    throw err;
  }

  // Count occurrences
  let count = 0, position = 0;
  while ((position = content.indexOf(oldString, position)) !== -1) {
    count++;
    position += 1;
  }

  if (count === 0) {
    return `Error: old_string not found in ${filePath}. Make sure it matches exactly, including whitespace.`;
  }
  if (count > 1) {
    return `Error: old_string appears ${count} times in ${filePath}. Include more surrounding context.`;
  }

  const newContent = content.replace(oldString, newString);
  writeFileSync(filePath, newContent, "utf-8");
  return `Successfully edited ${filePath}`;
}
```

### Error Cases

| Error | Cause | Model Recovery |
|-------|-------|---------------|
| File not found | Wrong path | Correct the path |
| old_string not found | Whitespace mismatch, misremembered line | Re-read file, use exact content |
| Multiple matches | `return null;` appears 8 times | Include more surrounding lines |

### Expected Behavior

```
Agent: I need to add error handling to the parse function. Let me edit the file.

edit_file({
  file_path: "src/parser.ts",
  old_string: "function parse(input: string) {\n  const result = JSON.parse(input);",
  new_string: "function parse(input: string) {\n  try {\n    const result = JSON.parse(input);"
})
```

The agent touches only the lines it needs. The rest of the file stays byte-for-byte identical.

---

## 2.2 Search Tools

The agent can read files but can't find them. To locate a function, it must guess which file contains it. Three tools fix this.

### grep_search — Search File Contents

```typescript
{
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
}
```

**Implementation:**

```typescript
function grepSearch(pattern: string, path: string = ".", include?: string): string {
  let cmd = `rg -n --heading -C 0 --max-count 200`;
  if (include) cmd += ` --glob '${include}'`;
  cmd += ` -- '${pattern.replace(/'/g, "'\\''")}' '${path}'`;

  try {
    const output = execSync(cmd, { encoding: "utf-8", timeout: 10_000, maxBuffer: 1024 * 1024 });
    return truncateLines(output, 100);
  } catch (err: any) {
    if (err.status === 1) return "No matches found.";
    return `Error: ${err.stderr || err.message}`;
  }
}

function truncateLines(output: string, maxLines: number): string {
  const lines = output.split("\n");
  if (lines.length <= maxLines) return output;
  return lines.slice(0, maxLines).join("\n") +
    `\n\n[... showing ${maxLines} of ${lines.length} lines]`;
}
```

Why ripgrep over grep? Faster, respects `.gitignore` by default (skips `node_modules` automatically), better output formatting. Fall back to `grep -rn` if `rg` isn't installed.

### glob_find — Find Files by Name

```typescript
{
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
}
```

**Implementation:**

```typescript
import { globSync } from "glob"; // bun add glob

function globFind(pattern: string, path: string = "."): string {
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
```

### list_directory — See Directory Contents

```typescript
{
  name: "list_directory",
  description: "List directory contents with type indicators (file vs directory).",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory path. Defaults to cwd." },
    },
  },
}
```

**Implementation:**

```typescript
import { readdirSync } from "fs";

function listDirectory(path: string = "."): string {
  const entries = readdirSync(path, { withFileTypes: true });
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
```

Directories get a trailing `/` so the model can distinguish them. Hidden files and `node_modules` are skipped.

### Expected Behavior After All Three

```
User: Find all places where the database connection is configured.

Agent:
1. list_directory(".") → sees: src/, config/, package.json, ...
2. glob_find("**/*.config.*") → sees: src/database.config.ts, jest.config.js
3. grep_search("createConnection|DATABASE_URL") → sees matches with file:line
4. read_file("src/database.config.ts") → reads the relevant file
5. Gives a complete answer.
```

Without these tools, the agent would have to guess file names or ask the user. That is the difference between a useful assistant and a toy demo.

---

## 2.3 Bash Tool Improvements

### Timeout

```typescript
const DEFAULT_TIMEOUT = 30_000; // 30 seconds

const result = execSync(command, {
  encoding: "utf-8",
  timeout: params.timeout ?? DEFAULT_TIMEOUT,
  cwd: params.cwd,
  maxBuffer: 10 * 1024 * 1024,
});
```

### Output Truncation

```typescript
const MAX_OUTPUT_CHARS = 30_000;

function truncateCommandOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output;

  // 80% head, 20% tail — errors usually appear at the end
  const headSize = Math.floor(MAX_OUTPUT_CHARS * 0.8);
  const tailSize = Math.floor(MAX_OUTPUT_CHARS * 0.2);

  return (
    output.slice(0, headSize) +
    `\n\n[... truncated: showing first ${headSize} and last ${tailSize} chars of ${output.length} total ...]\n\n` +
    output.slice(-tailSize)
  );
}
```

### Stderr Capture

```typescript
try {
  const stdout = execSync(command, {
    encoding: "utf-8",
    timeout,
    cwd: params.cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return truncateCommandOutput(stdout);
} catch (err: any) {
  if (err.killed) {
    let msg = `Error: command timed out after ${timeout / 1000}s and was killed.`;
    if (err.stdout) msg += `\nStdout:\n${truncateCommandOutput(err.stdout)}`;
    if (err.stderr) msg += `\nStderr:\n${truncateCommandOutput(err.stderr)}`;
    return msg;
  }

  let output = "";
  if (err.stdout) output += err.stdout;
  if (err.stderr) output += (output ? "\nSTDERR:\n" : "") + err.stderr;
  if (!output) output = `Command failed with exit code ${err.status}`;
  return truncateCommandOutput(output);
}
```

### Working Directory

Add `cwd` and `timeout` parameters to the tool schema:

```typescript
{
  name: "bash",
  description: "Execute a shell command. Commands killed after timeout. Output truncated if large.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string" },
      timeout: { type: "number", description: "Timeout in ms. Default 30000. Max 300000." },
      cwd: { type: "string", description: "Working directory. Defaults to project root." },
    },
    required: ["command"],
  },
}
```

### Expected Behavior After Improvements

- `npm install` gets 30s by default. If it hangs, it's killed cleanly.
- `cat` on a 100KB file returns first ~24K + last ~6K chars with truncation note.
- `tsc` warnings on stderr are visible. `npm test` failures show both stdout and stderr.
- `npm test` can run in a monorepo subdirectory without `cd` chains.

---

## Summary

Your agent now has 7 tools:

| Tool | Purpose |
|------|---------|
| `read_file` | Read file contents |
| `write_file` | Create/overwrite files |
| `edit_file` | Surgical string replacement |
| `grep_search` | Search file contents by pattern |
| `glob_find` | Find files by name pattern |
| `list_directory` | Browse directory contents |
| `bash` | Execute commands (with timeout, truncation, stderr) |

This is enough to handle most real coding tasks: explore a codebase, find relevant files, read them, make targeted edits, and run commands to verify.
