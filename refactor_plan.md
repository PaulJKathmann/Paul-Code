# Refactor Plan (Paul Code)

## Goals
- Make the agent easier to extend (tools, models, prompts, UX) without growing `agent.ts`.
- Separate concerns: **CLI** vs **agent loop** vs **model/stream handling** vs **tool registry/execution**.
- Improve type-safety and correctness for tool call parsing and message history.
- Enable testing of core logic without hitting the OpenAI API.

## Current Snapshot (what’s in the repo today)
- `app/main.ts`: CLI entry; supports `-p` single-shot vs interactive mode.
- `app/agent.ts`: core loop + streaming + retries + interactive mode (mixed concerns).
- `app/tools.ts`: tool schema definitions + implementations + dispatch in one file.
- `app/prompts.ts`: `SYSTEM_PROMPT` string.
- `docs/*`: roadmap phases and architectural target.

Key pain points observed:
- `agent.ts` mixes: streaming rendering, retry policy, tool call accumulation, and interactive REPL.
- Tool call handling isn’t `await`ed (currently synchronous), which will block future async tools.
- `handleToolCall` uses `JSON.parse` without error handling; malformed tool args will crash.
- Duplicate model name constants (`MODEL_NAME` + `modelName`), and mixed import types.
- `tools.ts` is a monolith: schemas + implementations + dispatcher.

## Proposed Target Structure (incremental, minimal disruption)
Create a `src/` (or keep `app/` but modularize) with these modules:

1. **Core agent**
   - `agent/runAgentLoop.ts`
     - Iteration guard
     - Calls model client to get next assistant message
     - Dispatches tool calls and appends tool results
   - `agent/types.ts`
     - Shared types for message history, tool calls, tool results

2. **Model/streaming**
   - `model/chatCompletionStream.ts`
     - `processStream()` that returns `{ message, rawText, toolCalls }`
     - Tool call accumulation isolated + unit testable
   - `model/retryPolicy.ts`
     - `processWithRetries(fn, isRetryable)`

3. **Tools**
   - `tools/definitions.ts` (OpenAI tool schema list)
   - `tools/registry.ts`
     - Map tool name -> handler
     - Single dispatch function that returns a `tool` role message
   - `tools/impl/*.ts`
     - `read_file`, `write_file`, `edit_file`, `bash`, `grep_search`, `glob_find`, `list_directory`

4. **CLI / UX**
   - `cli/interactive.ts` (REPL, commands, printing dividers)
   - `cli/main.ts` (argument parsing, env validation, selects headless vs interactive)

5. **Config** (optional, later)
   - `config.ts` for model name, baseURL, maxIterations, etc.

## Step-by-step Refactor Sequence (safe, verifiable)
### Step 0 — Baseline & Safety Nets
- Add a quick “smoke test” command in `package.json` (later) or document a manual test flow:
  - `bun run app/main.ts -p "say hi"`
  - `bun run app/main.ts` and run `/help`, a prompt, and `/exit`

### Step 1 — Extract Tool Call Accumulation
- Move the `ToolCallAccumulator` type and accumulation logic from `agent.ts` into a new module.
- Keep behavior identical; verify streaming still prints and tool calls still execute.

### Step 2 — Make Tool Dispatch Async-safe
- Change tool dispatch to return `Promise<void>` (or return tool message) and `await` it.
- Wrap `JSON.parse` in try/catch and return a tool error message instead of crashing.

### Step 3 — Split Tools Monolith
- Keep exported `tool_definitions` stable, but move implementations into separate files.
- Introduce a registry map:
  - `const handlers: Record<string, (args) => Promise<string> | string>`
- Centralize common behaviors: argument validation, logging, error-to-string.

### Step 4 — Separate Interactive CLI from Agent Loop
- Move `runInteractiveMode` out of `agent.ts` into `cli/interactive.ts`.
- `agent.ts` (or `runAgentLoop.ts`) should not import readline.

### Step 5 — Centralize Model/Config
- Create a single source for model name (e.g., `config.ts`).
- Remove duplicates and wire `/model` to the same config value.

### Step 6 — Type Tightening + Cleanup
- Remove unused imports/types (there are several in `agent.ts`).
- Ensure message history type is consistent (`ChatCompletionMessageParam[]`).
- Normalize ESM import extensions (`.ts` vs `.js`) consistently for Bun.

## Testing / Verification Strategy
- Manual smoke tests after each step (headless + interactive).
- Add unit tests later for:
  - tool call accumulator given streamed deltas
  - retry policy classification
  - tool dispatcher parse errors and unknown tools

## Non-goals (for this refactor)
- No behavior changes to the agent’s prompt or tool semantics.
- No new tools or MCP support yet.
- No context window management/token counting yet.

## Open Questions (decide before deeper work)
1. Keep `app/` as the runtime folder, or migrate to `src/` and update `bun run` entry?
2. Do you want tools to be allowed to be async (recommended), e.g., for future network/MCP tools?
3. Should streaming always print to stdout, or should it be injectable (to support tests/TTY formatting)?
