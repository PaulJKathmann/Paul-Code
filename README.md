# Paul Code

Paul Code is a coding agent I built to better understand the underlying mechanics of AI agents.

## What Paul Code can do

Paul Code is designed to help with day-to-day software engineering tasks from a terminal-style workflow. Depending on how it’s wired up in your environment, it can:

- **Explore and explain codebases**
  - Read files, summarize structure, and answer questions about how things work
  - Trace logic across modules and point out relevant call sites

- **Make targeted code changes**
  - Implement small, focused edits rather than large rewrites
  - Apply safe in-place edits via an `edit_file` tool (single exact-match replace)
  - Add/adjust functions, refactor, and update configuration files

- **Debug issues**
  - Reproduce errors, inspect stack traces/logs, and identify likely root causes
  - Propose and apply fixes, then re-run to verify

- **Run common dev commands**
  - Execute shell commands (tests, linters, builds, formatting, etc.)
  - Iterate based on command output

- **Improve developer experience**
  - Update documentation (READMEs, usage notes)
  - Suggest better project structure and conventions when asked

## Typical workflow

1. Ask a question (e.g., “Why is this test failing?” or “Add an endpoint for X”).
2. Paul Code reads the relevant files and/or runs commands to gather context.
3. It proposes a small change, applies it, and verifies by running tests or a quick check.

## Notes

This is intentionally a learning project, so capabilities may evolve as the agent and tooling change.
