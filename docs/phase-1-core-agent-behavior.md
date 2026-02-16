# Phase 1: Core Agent Behavior

[← Back to Roadmap](../ROADMAP.md) | [Next: Phase 2 →](phase-2-essential-tools.md)

---

Phase 1 transforms the single-shot script into something that actually behaves like a coding agent. You will add three foundational capabilities: a system prompt that gives the model identity and guidelines, an interactive REPL for multi-turn conversations, and a safety guard against runaway tool loops.

After completing this phase, you will have an agent that knows what it is, can hold a conversation, and won't burn through your API credits if something goes wrong.

---

## 1.1 System Prompt

### What and Why

A system prompt is a message with `role: "system"` that you prepend to every conversation. It tells the model who it is, what tools it has, and how it should behave. Without one, the model is a general-purpose chatbot that has no idea it's supposed to be a coding agent — it won't know it can read files, won't know what directory it's in, and won't follow any consistent behavioral patterns.

### What the System Prompt Should Contain

The system prompt has four jobs:

**1. Identity and purpose:**

```
You are Paul Code, an AI coding assistant that runs in the user's terminal.
You help with software engineering tasks: reading code, writing files,
running commands, debugging, and answering questions about codebases.
```

**2. Available tools and when to use each:**

```
You have three tools available:

- read_file: Read the contents of a file. ALWAYS read a file before attempting
  to modify it. Use this to understand existing code before making changes.

- write_file: Write content to a file (creates or overwrites). Use this to
  create new files or apply changes.

- bash: Execute a shell command. Use this for running tests, installing
  dependencies, checking git status, listing files, or any terminal operation.
```

**3. Working directory context** (dynamic — injected at runtime):

```
You are operating in the following directory: /Users/pkathmann/personal/Paul-Code
```

Use `process.cwd()` at runtime.

**4. Behavioral rules:**

```
Rules:
- ALWAYS read a file before editing it. Never guess at file contents.
- Prefer small, focused changes over large rewrites.
- Briefly explain what you're about to do before doing it.
- When you encounter an error, read the relevant code and diagnose before retrying.
- If a task is ambiguous, ask the user to clarify rather than guessing.
- After making changes, verify them (e.g., run the relevant test or read the file back).
```

### Implementation

The system message should **not** be stored in `messageHistory` — it's prepended at call time. This prevents duplicates across turns.

```typescript
const SYSTEM_PROMPT = `You are Paul Code, an AI coding assistant that runs in the user's terminal. You help with software engineering tasks: reading code, writing files, running commands, debugging, and answering questions about codebases.

You have three tools available:

- read_file: Read the contents of a file. ALWAYS read a file before attempting to modify it.
- write_file: Write content to a file (creates or overwrites).
- bash: Execute a shell command. Prefer short, focused commands.

You are operating in the following directory: ${process.cwd()}

Rules:
- ALWAYS read a file before editing it. Never guess at file contents.
- Prefer small, focused changes over large rewrites.
- Briefly explain what you're about to do before doing it.
- When you encounter an error, read the relevant code and diagnose before retrying.
- If a task is ambiguous, ask the user to clarify rather than guessing.
- After making changes, verify them.`;

// Where you currently have:
// messageHistory.push({ role: "user", content: prompt });

// The system message is NOT pushed to messageHistory.
// Instead, when calling the API:
const response = await client.chat.completions.create({
  model: "gpt-5.2",
  messages: [
    { role: "system", content: SYSTEM_PROMPT },
    ...messageHistory,
  ],
  tools: tools,
});
```

### Expected Behavior After Implementation

Before: "What files are in this project?" → model guesses or hallucinates.

After:
- Model says "Let me check the project structure" and calls `bash` with `ls`
- When asked to edit a file, it first calls `read_file`
- It explains its plan before executing tools
- It uses paths relative to the working directory

---

## 1.2 Interactive REPL Mode

### What and Why

Right now, the agent is single-shot: `bun run app/main.ts -p "do something"`, it does the thing, and exits. This is fine for scripting but terrible for development work, where you want to say "read that file," then "now change line 12," then "run the tests." Each command needs context from previous ones.

### What to Build

Two modes:
- **Single-shot** (`-p "prompt"`): current behavior, for scripting/automation
- **Interactive** (no `-p` flag): REPL that keeps the conversation going

### Implementation

First, extract the agent logic into a reusable function:

```typescript
async function runAgentLoop(
  client: OpenAI,
  messageHistory: ChatCompletionMessageParam[],
): Promise<string> {
  // Move the existing while(true) loop here.
  // Return the final text content from the assistant's response.
}
```

Then restructure the entry point:

```typescript
const args = process.argv.slice(2);
const promptFlagIndex = args.indexOf("-p");

if (promptFlagIndex !== -1) {
  // Single-shot mode
  const prompt = args[promptFlagIndex + 1];
  messageHistory.push({ role: "user", content: prompt });
  const response = await runAgentLoop(client, messageHistory);
  console.log(response);
} else {
  // Interactive mode
  await runInteractiveMode(client, messageHistory);
}
```

The interactive mode function:

```typescript
import * as readline from "readline";

async function runInteractiveMode(
  client: OpenAI,
  messageHistory: ChatCompletionMessageParam[],
): Promise<void> {
  console.log("Paul Code — interactive mode");
  console.log('Type /exit or press Ctrl+C to quit.\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const askQuestion = (): Promise<string> => {
    return new Promise((resolve) => {
      rl.question("> ", (answer) => resolve(answer));
    });
  };

  rl.on("close", () => {
    console.log("\nGoodbye.");
    process.exit(0);
  });

  while (true) {
    const input = await askQuestion();
    const trimmed = input.trim();

    if (trimmed === "/exit") {
      console.log("Goodbye.");
      rl.close();
      break;
    }

    if (trimmed === "") continue;

    messageHistory.push({ role: "user", content: trimmed });
    const response = await runAgentLoop(client, messageHistory);
    console.log("\n" + response + "\n");
  }
}
```

### Message History Across Turns

This is the whole point. The `messageHistory` array accumulates every user message, assistant response, and tool call/result. When the model processes turn 5, it can see everything from turns 1-4:

- Reference files it read earlier without re-reading them
- Build on changes it made in previous turns
- Understand context like "that function" or "the test I just ran"

For now, let it grow without limits — context management is Phase 5.

### Expected Behavior

```
Paul Code — interactive mode
Type /exit or press Ctrl+C to quit.

> What files are in this project?

Let me check the project structure.
[runs: ls -la]
This project contains: app/main.ts, package.json, ...

> Read main.ts and tell me how many lines it is

[reads: app/main.ts]
main.ts is 178 lines long. It contains the agent loop with three tools...

> /exit
Goodbye.
```

---

## 1.3 Max Iteration Guard

### The Risk

The agent loop is `while(true)`. If the model gets confused, enters a retry loop, or starts doing unnecessary work, it will keep calling tools indefinitely. Each iteration is an API call that costs money.

### What to Build

1. An iteration counter that increments each loop
2. A warning injection at 80% of max, telling the model to wrap up
3. A hard stop at max, breaking the loop

Default max: **50 iterations**. Most tasks complete in 5-15.

### Implementation

```typescript
async function runAgentLoop(
  client: OpenAI,
  messageHistory: ChatCompletionMessageParam[],
  maxIterations: number = 50,
): Promise<string> {
  let iterations = 0;
  const warningThreshold = Math.floor(maxIterations * 0.8);

  while (true) {
    if (iterations >= maxIterations) {
      const msg = `Stopped: reached maximum of ${maxIterations} iterations.`;
      console.warn(msg);
      return msg;
    }

    if (iterations === warningThreshold) {
      messageHistory.push({
        role: "system",
        content:
          `You have used ${iterations} of ${maxIterations} allowed iterations. ` +
          `Wrap up your current task. Do not start new tool calls unless absolutely necessary.`,
      });
    }

    iterations++;

    const response = await client.chat.completions.create({
      model: "gpt-5.2",
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messageHistory],
      tools: tools,
    });

    // ... rest of loop
  }
}
```

### Expected Behavior

- **Normal operation:** No visible difference. Counter increments silently.
- **At 80% (40/50):** Model receives warning, tries to finish up.
- **At 100% (50/50):** Loop stops. User sees warning. In interactive mode, they can continue with fresh iterations.

**Testing it:** Set `maxIterations` to 3 and ask something requiring multiple tool calls.

---

## Summary

| Feature | Before | After |
|---------|--------|-------|
| System prompt | None | Model knows it's a coding agent with tool guidelines |
| Interaction mode | Single-shot only | Both single-shot and interactive REPL |
| Safety guard | None — loop runs forever | Hard stop at 50 iterations, warning at 40 |
