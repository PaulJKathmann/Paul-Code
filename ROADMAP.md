# Building a Great Coding Agent: A Step-by-Step Roadmap

> A learning roadmap for turning Paul Code from a 178-line prototype into a production-grade coding agent. Each phase builds on the previous one. By the end, you will have built the same architecture used by Claude Code, Cursor, and Aider.

## Current State

A working agent loop in ~178 lines of TypeScript (Bun runtime). Three tools: `read_file`, `write_file`, `Bash`. Single-shot execution via `-p "prompt"`. No system prompt, no streaming, no safety checks, no context management.

## Target Architecture

```
paul-code/
├── src/
│   ├── main.ts                  # Entry point, CLI parsing, REPL loop
│   ├── agent.ts                 # Core agent loop (streaming + tool execution)
│   ├── system-prompt.ts         # System prompt construction
│   ├── config.ts                # Configuration loading and merging
│   ├── types.ts                 # Shared TypeScript interfaces
│   ├── tokens.ts                # Token counting
│   ├── context.ts               # Context window management
│   ├── conversation.ts          # Save/load conversations
│   ├── costTracker.ts           # API cost tracking
│   ├── safety.ts                # Dangerous operation classification
│   ├── display.ts               # Colors, diffs, formatting
│   ├── spinner.ts               # Progress indicator
│   ├── tools/
│   │   ├── index.ts             # Tool registry + dispatch
│   │   ├── read_file.ts
│   │   ├── write_file.ts
│   │   ├── edit_file.ts
│   │   ├── bash.ts
│   │   ├── search.ts            # grep + glob + list_directory
│   │   └── spawn_agent.ts       # Sub-agent delegation
│   └── mcp/
│       ├── mcpManager.ts        # MCP client + connection management
│       └── config.ts            # MCP server config loading
├── .paulcode.json               # Project configuration + MCP servers
├── package.json
└── tsconfig.json
```

## Phases

| Phase | Title | What You Build | What You Learn |
|-------|-------|---------------|----------------|
| **[1](docs/phase-1-core-agent-behavior.md)** | Core Agent Behavior | System prompt, Interactive REPL, Max iteration guard | Prompt engineering, UX basics |
| **[2](docs/phase-2-essential-tools.md)** | Essential Tools | Edit tool, Search tools, Bash improvements | What tools agents actually need |
| **[3](docs/phase-3-streaming-output.md)** | Streaming Output | Real-time token-by-token output | Async streams, chunked responses |
| **[4](docs/phase-4-architecture.md)** | Architecture | Module structure, Tool registry, Config system | Software design patterns for agents |
| **[5](docs/phase-5-context-management.md)** | Context Management | Token counting, Context window strategies | The hardest problem in agent engineering |
| **[6](docs/phase-6-safety-and-ux.md)** | Safety & UX | Confirmations, Colors, Diffs, Spinner | Production-quality CLI experience |
| **[7](docs/phase-7-advanced-patterns.md)** | Advanced Patterns | Parallel tools, Sub-agents, Persistence, Cost tracking | Advanced agent architectures |
| **[8](docs/phase-8-mcp-support.md)** | MCP Support | Model Context Protocol client | Industry-standard extensibility |

## Dependency Graph

```
Phase 1: Core Agent Behavior
    └── Phase 2: Essential Tools
        └── Phase 3: Streaming Output
            └── Phase 4: Architecture
                ├── Phase 5: Context Management
                ├── Phase 6: Safety & UX
                ├── Phase 7: Advanced Patterns
                └── Phase 8: MCP Support
```

Phases 5-8 can be done in any order after Phase 4.

## By the Numbers (Final State)

| Metric | Value |
|--------|-------|
| Lines of TypeScript | ~1,500 |
| Number of files | ~18 |
| External dependencies | 4 (`openai`, `gpt-tokenizer`, `@modelcontextprotocol/sdk`, `diff`) |
| Built-in tools | 7 |
| MCP tools | Unlimited (config-driven) |

## Quick Wins (Do These First)

If you want immediate impact before following the full roadmap:

1. **Add a system prompt** — 10 lines, massive behavior improvement
2. **Add `list_directory` tool** — trivial to implement, immediately useful
3. **Add max iteration guard** — 3 lines, prevents infinite loops
4. **Wrap `main()` in try-catch** — 5 lines, prevents ugly crashes
