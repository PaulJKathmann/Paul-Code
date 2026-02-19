# 2026-02-19 — Safe tool-argument parsing

## Target
Prevent the agent loop from crashing when the model emits malformed JSON in `tool_call.function.arguments`.

## What changed
- Added a small `safeParseJsonObject()` helper that validates the arguments are valid JSON and specifically a JSON object.
- Updated `handleToolCall()` to:
  - return a tool error message to the model when args are invalid (instead of throwing),
  - return a tool error message when an unknown tool name is called (previously it only logged and returned).

## Why
Tool-call argument JSON is streamed and can occasionally be malformed or partial. A thrown `JSON.parse` would terminate the run, degrading UX. Returning a tool error keeps the loop alive and lets the model self-correct.

## Verification
- `bun x tsc --noEmit`
