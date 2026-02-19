# 2026-02-19 — Tool argument validation + typed dispatch

## What changed
- Replaced the permissive `dispatchToolCall(toolName: string, args: Record<string, any>)` implementation with a typed tool map (`ToolArgs`) plus per-tool argument parsing.
- Tool calls now return structured `{ ok: true, result } | { ok: false, error }` results, so unknown tools and invalid/missing args produce clear, consistent error messages.

## Why
The agent frequently sends incomplete or incorrectly typed tool arguments (especially during streaming tool-call assembly). Previously this produced confusing runtime errors or silent `undefined` values. Centralized validation improves reliability and keeps failures understandable without removing any existing tool functionality.

## Notes
- Validation is intentionally lightweight (type/required checks only), keeping behavior backwards-compatible while improving safety.
- TypeScript remains in strict mode.
