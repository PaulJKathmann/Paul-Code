# Phase 8: MCP Support

[← Phase 7](phase-7-advanced-patterns.md) | [Back to Roadmap](../ROADMAP.md)

---

Your agent has 7 built-in tools. That is enough for code editing, but the real world demands more: querying databases, searching the web, controlling browsers, talking to APIs. You could build each integration yourself, or you could adopt the Model Context Protocol (MCP) — an open standard by Anthropic that lets your agent connect to any tool provider through a single interface. This phase turns Paul Code into an MCP client, giving it access to an unlimited ecosystem of tools without writing a single new tool implementation.

---

## 8.1 What Is MCP?

### What and Why

The Model Context Protocol is an open standard for connecting AI agents to external tools and data sources. Think of it as USB for AI — a universal plug that lets any agent talk to any tool server, regardless of who built either side.

An MCP **server** is a small program that exposes capabilities over a standard protocol. An MCP **client** (your agent) connects to servers, discovers what they offer, and calls their tools. The server handles the actual work — querying a database, hitting an API, reading a filesystem — and returns results.

Why this matters:

- **No custom integration code.** Want GitHub access? Connect the GitHub MCP server. Want Postgres? Connect the Postgres server. You write zero tool implementations.
- **Community ecosystem.** Hundreds of MCP servers exist for databases, APIs, browsers, cloud services, and developer tools.
- **Standard interface.** The model sees MCP tools identically to built-in tools. It does not know or care where a tool lives.

Examples of MCP servers you can connect today:

| Server | What It Does |
|--------|-------------|
| `@modelcontextprotocol/server-filesystem` | Read/write/search files in specified directories |
| `@modelcontextprotocol/server-github` | Create issues, PRs, search repos |
| `@anthropic-ai/mcp-server-postgres` | Query Postgres databases |
| `@anthropic-ai/mcp-server-brave-search` | Web search via Brave |
| `@anthropic-ai/mcp-server-playwright` | Browser automation |

---

## 8.2 MCP Architecture

### What and Why

MCP uses a client-server model with three layers:

**Transport:** How client and server exchange bytes. The most common transport is **stdio** — spawn the server as a child process, communicate over stdin/stdout. HTTP with Server-Sent Events (SSE) is the alternative for remote servers.

**Protocol:** JSON-RPC 2.0 over the transport. Same protocol used by LSP (Language Server Protocol) — proven, simple, well-tooled.

**Capabilities:** MCP servers can expose tools (functions the model can call), resources (data the client can read), and prompts (reusable templates). For this phase, we focus exclusively on **tools**.

### Lifecycle

Every MCP connection follows this sequence:

```
Client                          Server
  │                               │
  │──── initialize ──────────────→│   Negotiate protocol version + capabilities
  │←─── initialize response ─────│
  │                               │
  │──── tools/list ──────────────→│   Discover available tools
  │←─── tools list response ─────│
  │                               │
  │──── tools/call ──────────────→│   Execute a tool (repeatable)
  │←─── tool result ─────────────│
  │                               │
  │──── shutdown ────────────────→│   Clean disconnect
  │                               │
```

The `initialize` handshake ensures both sides agree on protocol version and supported features. After that, list tools once and call them as many times as needed.

---

## 8.3 Configuration

### What and Why

MCP servers are configured in `.paulcode.json` alongside other project settings. Each entry describes how to spawn a server process — the command, its arguments, and any environment variables it needs.

### Implementation

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"],
      "env": {}
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "ghp_xxxxxxxxxxxx" }
    },
    "postgres": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/mcp-server-postgres", "postgresql://localhost/mydb"],
      "env": {}
    }
  }
}
```

The TypeScript types and loader:

```typescript
interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

function loadMcpConfig(): Record<string, McpServerConfig> {
  const configPath = join(process.cwd(), ".paulcode.json");
  if (!existsSync(configPath)) return {};
  const raw = JSON.parse(readFileSync(configPath, "utf-8"));
  return raw.mcpServers ?? {};
}
```

---

## 8.4 Implementation -- MCP Manager

### What and Why

The MCP Manager is the core of Phase 8. It manages connections to all configured servers, aggregates their tools, and routes tool calls. Install the SDK first:

```bash
bun add @modelcontextprotocol/sdk
```

### Implementation

```typescript
// src/mcp/mcpManager.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

interface ConnectedServer {
  name: string;
  client: Client;
  transport: StdioClientTransport;
  tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
}

class McpManager {
  private servers: Map<string, ConnectedServer> = new Map();

  async connectAll(configs: Record<string, McpServerConfig>): Promise<void> {
    const entries = Object.entries(configs);
    if (entries.length === 0) return;

    const results = await Promise.allSettled(
      entries.map(([name, config]) => this.connectServer(name, config))
    );

    for (let i = 0; i < results.length; i++) {
      if (results[i].status === "rejected") {
        console.error(`[MCP] Failed to connect to "${entries[i][0]}": ${(results[i] as PromiseRejectedResult).reason}`);
      }
    }
  }

  private async connectServer(name: string, config: McpServerConfig): Promise<void> {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: { ...process.env, ...config.env } as Record<string, string>,
    });

    const client = new Client(
      { name: "paul-code", version: "1.0.0" },
      { capabilities: {} }
    );

    // Connect with a 10s timeout so a broken server never blocks startup
    await Promise.race([
      client.connect(transport),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Connection timed out")), 10_000)
      ),
    ]);

    const response = await client.listTools();
    const tools = (response.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: t.inputSchema as Record<string, unknown>,
    }));

    this.servers.set(name, { name, client, transport, tools });
    console.error(`[MCP] Connected to "${name}" (${tools.length} tools)`);
  }

  listTools(): Array<{ serverName: string; tool: ConnectedServer["tools"][number] }> {
    const result: Array<{ serverName: string; tool: ConnectedServer["tools"][number] }> = [];
    for (const [serverName, server] of this.servers) {
      for (const tool of server.tools) {
        result.push({ serverName, tool });
      }
    }
    return result;
  }

  async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<string> {
    const server = this.servers.get(serverName);
    if (!server) return `Error: MCP server "${serverName}" is not connected.`;

    try {
      const result = await server.client.callTool(
        { name: toolName, arguments: args },
        undefined,
        { timeout: 30_000 }
      );
      // MCP results contain a `content` array of typed blocks
      const parts = (result.content as Array<{ type: string; text?: string }>)
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text!);
      return parts.join("\n") || "(empty result)";
    } catch (err) {
      // Server likely crashed — remove it so we stop retrying
      console.error(`[MCP] Server "${serverName}" failed, disconnecting: ${err}`);
      this.servers.delete(serverName);
      return `Error: MCP server "${serverName}" crashed and has been disconnected.`;
    }
  }

  async shutdown(): Promise<void> {
    for (const [, server] of this.servers) {
      try { await server.transport.close(); } catch { /* best-effort */ }
    }
    this.servers.clear();
  }
}

export const mcpManager = new McpManager();
```

### Key Details

- **`Promise.allSettled`** — one failing server does not block others from connecting.
- **`console.error`** for status messages — keeps stdout clean for streamed agent output.
- **10s connect timeout + 30s call timeout** — prevents hung servers from blocking the agent.
- **Crash detection** — failed `callTool` removes the server so the agent stops trying to use it.
- **Singleton export** — the rest of the codebase imports `mcpManager` directly.

---

## 8.5 Integrating MCP Tools with the Agent

### What and Why

The model needs to see MCP tools alongside built-in tools in a single unified list. This requires converting MCP tool schemas to the OpenAI function calling format, merging them with built-in schemas, and routing tool calls to the right handler.

### Implementation

**Schema conversion** — namespace MCP tools as `mcp__serverName__toolName` to avoid collisions:

```typescript
import { ChatCompletionTool } from "openai/resources/chat/completions";

function mcpToolsToOpenAISchema(
  mcpTools: Array<{ serverName: string; tool: { name: string; description: string; inputSchema: Record<string, unknown> } }>
): ChatCompletionTool[] {
  return mcpTools.map(({ serverName, tool }) => ({
    type: "function" as const,
    function: {
      name: `mcp__${serverName}__${tool.name}`,
      description: `[MCP: ${serverName}] ${tool.description}`,
      parameters: tool.inputSchema,
    },
  }));
}
```

**Tool dispatch** — check the name prefix to route calls:

```typescript
async function dispatchToolCall(name: string, args: Record<string, unknown>): Promise<string> {
  if (name.startsWith("mcp__")) {
    const parts = name.split("__");
    const serverName = parts[1];
    const toolName = parts.slice(2).join("__"); // handles tool names containing underscores
    return await mcpManager.callTool(serverName, toolName, args);
  }
  return executeBuiltinTool(name, args);
}
```

**Startup sequence** — connect, merge, run:

```typescript
import { mcpManager } from "./mcp/mcpManager";

async function main() {
  const config = loadConfig();

  // Connect MCP servers (failures are logged, not fatal)
  if (config.mcpServers) {
    await mcpManager.connectAll(config.mcpServers);
  }

  // Build unified tool list
  const builtinTools = getBuiltinToolSchemas();
  const mcpToolSchemas = mcpToolsToOpenAISchema(mcpManager.listTools());
  const allTools = [...builtinTools, ...mcpToolSchemas];

  // Update system prompt to mention MCP tools
  const mcpToolNames = mcpManager.listTools().map((t) => `${t.serverName}/${t.tool.name}`);
  const systemPrompt = buildSystemPrompt(mcpToolNames);

  // Run agent loop with allTools, then clean up
  // ... existing REPL or single-shot logic ...

  await mcpManager.shutdown();
}
```

**System prompt update** — append MCP tool info when servers are connected:

```typescript
function buildSystemPrompt(mcpToolNames: string[]): string {
  let prompt = BASE_SYSTEM_PROMPT;
  if (mcpToolNames.length > 0) {
    prompt += `\n\nYou also have access to external tools via MCP servers:\n`;
    prompt += mcpToolNames.map((name) => `- ${name}`).join("\n");
    prompt += `\nUse these when the task requires capabilities beyond file editing and shell commands.`;
  }
  return prompt;
}
```

The model does not need to know the namespacing scheme. It sees names like `mcp__github__create_issue` in the function definitions and calls them directly. The `[MCP: github]` description prefix helps it understand the tool's origin.

---

## 8.6 Error Handling and Lifecycle

### What and Why

MCP servers are separate processes. They can crash, hang, or fail to start. The agent must handle all of these without crashing itself.

### Implementation

**Server crashes** are already handled in `callTool` (section 8.4) — the catch block removes the failed server and returns an error message. The model receives this as a normal tool result and can adapt.

**Clean shutdown** — kill all spawned server processes when the agent exits:

```typescript
process.on("SIGINT", async () => {
  await mcpManager.shutdown();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await mcpManager.shutdown();
  process.exit(0);
});
```

Without this, spawned servers become orphaned processes.

### Expected Behavior

**Normal startup:**
```
$ paul-code
[MCP] Connected to "github" (12 tools)
[MCP] Connected to "filesystem" (5 tools)
Paul Code — interactive mode (7 built-in + 17 MCP tools)
>
```

**One server fails:**
```
$ paul-code
[MCP] Connected to "github" (12 tools)
[MCP] Failed to connect to "postgres": Connection refused
Paul Code — interactive mode (7 built-in + 12 MCP tools)
>
```

**Server crashes mid-conversation:**
```
> Query the user table
[Tool: mcp__postgres__query]
Error: MCP server "postgres" crashed and has been disconnected.

I can't query the database — the Postgres MCP server disconnected.
Would you like me to try running psql directly via bash instead?
```

**No MCP configured** — no MCP messages, no errors. The agent works exactly as before Phase 8.

---

## Summary

| Component | What It Does |
|-----------|-------------|
| `.paulcode.json` `mcpServers` | Declares which MCP servers to connect |
| `McpManager` | Spawns servers, discovers tools, routes calls, handles lifecycle |
| Schema conversion | Converts MCP tool definitions to OpenAI function calling format |
| Namespaced dispatch | `mcp__server__tool` naming routes calls to the correct server |
| Error handling | Crashed servers are disconnected; agent continues with remaining tools |
| Clean shutdown | All spawned server processes are killed on exit |

The agent now supports an unlimited number of external tools through configuration alone. Adding a new capability — a database, an API, a browser — requires zero code changes. Add an entry to `.paulcode.json` and restart.
