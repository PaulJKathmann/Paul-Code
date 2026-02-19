# Wrap main() with top-level error handler

## Why
The roadmap’s Quick Wins calls out wrapping `main()` in a try/catch to avoid ugly crashes. Previously, an unhandled rejection would print a stack trace and potentially exit with a non-deterministic code path.

## What changed
- Added a `.catch(...)` handler to the top-level `main()` call to consistently format fatal errors and set a non-zero exit code.
- Improved two small UX footguns:
  - Error message now correctly references `OPENAI_API_KEY`.
  - In `-p` mode, we now validate that a prompt value exists.

## Files
- app/main.ts
