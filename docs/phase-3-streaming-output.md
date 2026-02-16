# Phase 3: Streaming Output

[← Phase 2](phase-2-essential-tools.md) | [Back to Roadmap](../ROADMAP.md) | [Next: Phase 4 →](phase-4-architecture.md)

---

Right now, when you ask Paul Code a question, the terminal goes silent for 5-30 seconds, then the entire response dumps at once. With streaming, text appears word-by-word as the model generates it. You can start reading while it's still being written, and you get immediate feedback that something is happening.

---

## 3.1 OpenAI Streaming API

### Non-Streaming (What We Have)

```typescript
const response = await client.chat.completions.create({
  model: "gpt-5.2", messages, tools,
});
// response.choices[0].message = complete message
```

### Streaming (What We Want)

```typescript
const stream = await client.chat.completions.create({
  model: "gpt-5.2", messages, tools,
  stream: true,  // ← only change to the call
});
// stream is async iterable of ChatCompletionChunk
```

### Anatomy of a Chunk

| Non-Streaming | Streaming |
|---|---|
| `choices[0].message` | `choices[0].delta` |
| `message.content` = full text | `delta.content` = a few characters |
| `message.tool_calls` = complete array | `delta.tool_calls` = partial fragments |
| `finish_reason` always set | `finish_reason` is `null` until the last chunk |

### How Tool Calls Arrive

Tool calls are split across many chunks:

```
Chunk 1:  delta.tool_calls = [{ index: 0, id: "call_abc", function: { name: "read_file", arguments: "" } }]
Chunk 2:  delta.tool_calls = [{ index: 0, function: { arguments: "{\"" } }]
Chunk 3:  delta.tool_calls = [{ index: 0, function: { arguments: "file_path" } }]
Chunk 4:  delta.tool_calls = [{ index: 0, function: { arguments: "\": \"src/main.ts\"}" } }]
Chunk 5:  finish_reason = "tool_calls"
```

The `id` and `name` come in the first chunk. The `arguments` string must be concatenated across chunks. The `index` field identifies which tool call a fragment belongs to (important for multiple simultaneous calls).

---

## 3.2 Implementation

### Accumulator Type

```typescript
interface ToolCallAccumulator {
  id: string;
  function: { name: string; arguments: string };
}
```

### Stream Processing Function

```typescript
async function processStream(
  client: OpenAI,
  messages: ChatCompletionMessageParam[],
  tools: ChatCompletionTool[]
): Promise<ChatCompletionMessage> {
  const stream = await client.chat.completions.create({
    model: "gpt-5.2", messages, tools, stream: true,
  });

  let contentParts: string[] = [];
  let toolCallAccumulators: Map<number, ToolCallAccumulator> = new Map();
  let finishReason: string | null = null;

  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    if (!choice) continue;

    // Text — print immediately
    if (choice.delta.content) {
      process.stdout.write(choice.delta.content);
      contentParts.push(choice.delta.content);
    }

    // Tool calls — accumulate fragments
    if (choice.delta.tool_calls) {
      for (const tc of choice.delta.tool_calls) {
        if (!toolCallAccumulators.has(tc.index)) {
          toolCallAccumulators.set(tc.index, {
            id: tc.id || "",
            function: { name: tc.function?.name || "", arguments: "" },
          });
        }
        const acc = toolCallAccumulators.get(tc.index)!;
        if (tc.id) acc.id = tc.id;
        if (tc.function?.name) acc.function.name += tc.function.name;
        if (tc.function?.arguments) acc.function.arguments += tc.function.arguments;
      }
    }

    if (choice.finish_reason) finishReason = choice.finish_reason;
  }

  // Print newline after streaming text
  if (contentParts.length > 0) process.stdout.write("\n");

  // Reconstruct complete message (same shape as non-streaming response)
  const fullContent = contentParts.join("") || null;
  const toolCalls = toolCallAccumulators.size > 0
    ? Array.from(toolCallAccumulators.entries())
        .sort(([a], [b]) => a - b)
        .map(([_, acc]) => ({
          id: acc.id,
          type: "function" as const,
          function: { name: acc.function.name, arguments: acc.function.arguments },
        }))
    : undefined;

  return { role: "assistant", content: fullContent, tool_calls: toolCalls, refusal: null };
}
```

### Key Details

- **`process.stdout.write()`** not `console.log()` — no unwanted newlines between tokens
- **Tool call arguments are string fragments** — concatenate them, don't JSON.parse until stream ends
- **The `index` field** routes fragments to the correct accumulator for multiple simultaneous tool calls
- **Wait for stream to end** before executing any tools
- **The reconstructed message** has the exact same shape as a non-streaming response — the rest of the agent loop stays unchanged

### Integration with Agent Loop

```typescript
// Replace the direct API call in your agent loop:
const assistantMessage = await processStream(client, messages, tools);
messages.push(assistantMessage);

// Everything else — tool execution, message history — is identical
```

---

## 3.3 Expected Behavior

### Before (No Streaming)

```
You: Read the main.ts file and explain what it does.
[... 8 seconds of nothing ...]
I'll read the file for you.
[Tool: read_file]
This file sets up an Express server with three routes...
```

### After (With Streaming)

```
You: Read the main.ts file and explain what it does.
I'll read the file for you.        ← appears word by word over ~1 second
[Tool: read_file]                   ← prints when tool call detected
This file sets up an Express        ← resumes streaming after tool completes
server with three routes. The
first route handles...              ← continues word by word
```

---

## 3.4 Edge Cases

### Empty Chunks
Some chunks arrive with no useful data. The `if (!choice) continue` and conditional checks handle these.

### Multiple Tool Calls in One Response
Chunks for different tool calls arrive interleaved — the `index` field keeps them separate. **All** tool calls must finish accumulating before any are executed.

### Text Before Tool Calls
The model often outputs text before its tool calls ("Let me read that file."). The stream contains text chunks first, then tool call chunks. Both are accumulated independently — the reconstructed message will have both `content` and `tool_calls`.

### Network Interruption

```typescript
async function processStreamWithRetry(
  client: OpenAI, messages: ChatCompletionMessageParam[],
  tools: ChatCompletionTool[], maxRetries = 2
): Promise<ChatCompletionMessage> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await processStream(client, messages, tools);
    } catch (error) {
      if (attempt === maxRetries) throw error;
      const isRetryable = error instanceof Error &&
        (error.message.includes("ECONNRESET") || error.message.includes("timeout"));
      if (!isRetryable) throw error;
      console.error(`\n[Stream interrupted, retrying... (${attempt + 1}/${maxRetries})]`);
    }
  }
  throw new Error("unreachable");
}
```

---

## Testing Checklist

1. Ask a simple question (no tools). Verify text streams word-by-word.
2. Ask it to read a file. Verify text streams, pauses for tool execution, then resumes.
3. Ask it to read multiple files. Verify all tool calls execute before response streams.
4. Kill your network mid-response. Verify the error is caught cleanly.
