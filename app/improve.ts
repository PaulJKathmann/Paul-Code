import { readFileSync, existsSync, appendFileSync } from "fs";
import { execSync } from "child_process";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions/completions.mjs";
import { runAgentLoop } from "./agent.ts";
import { IMPROVE_SYSTEM_PROMPT } from "./improve-prompt.ts";
import { runTestSuite, formatTestResults } from "./test-harness.ts";

const PROJECT_ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const LOG_FILE = `${PROJECT_ROOT}/improvements.log`;

const GIT_EXEC_OPTS: { cwd: string; encoding: "utf-8"; stdio: ["pipe", "pipe", "pipe"] } = {
  cwd: PROJECT_ROOT,
  encoding: "utf-8",
  stdio: ["pipe", "pipe", "pipe"],
};

function readOptionalFile(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "(file not found)";
  }
}

function readImprovementLog(): string {
  if (!existsSync(LOG_FILE)) return "(no previous improvements)";
  const content = readFileSync(LOG_FILE, "utf-8");
  // Return last 5 entries to keep context reasonable
  const entries = content.split("\n---\n").filter(Boolean);
  const recent = entries.slice(-5);
  return recent.join("\n---\n");
}

function appendToLog(entry: string): void {
  appendFileSync(LOG_FILE, entry + "\n---\n", "utf-8");
}

function gitCommit(message: string): void {
  execSync(`git add -A && git commit --no-gpg-sign -m "${message.replace(/"/g, '\\"')}"`, GIT_EXEC_OPTS);
}

function gitResetHard(count: number): void {
  if (count <= 0) return;
  execSync(`git reset --hard HEAD~${count}`, GIT_EXEC_OPTS);
}

function buildContextMessage(): string {
  const codebaseFiles: Array<{ label: string; path: string; lang: string }> = [
    { label: "ROADMAP.md", path: "ROADMAP.md", lang: "markdown" },
    { label: "app/agent.ts", path: "app/agent.ts", lang: "typescript" },
    { label: "app/tools.ts", path: "app/tools.ts", lang: "typescript" },
    { label: "app/prompts.ts", path: "app/prompts.ts", lang: "typescript" },
    { label: "app/main.ts", path: "app/main.ts", lang: "typescript" },
  ];

  const fileSections = codebaseFiles
    .map((f) => `### ${f.label}\n\`\`\`${f.lang}\n${readOptionalFile(`${PROJECT_ROOT}/${f.path}`)}\n\`\`\``)
    .join("\n\n");

  const baseline = runTestSuite({ skipIntegration: true });

  return `## Current Codebase

${fileSections}

## Baseline Test Results
${formatTestResults(baseline)}

## Improvement History (recent)
${readImprovementLog()}

---

Analyze the codebase and roadmap above. Identify the single most impactful improvement you can make right now. Then implement it using the tools available to you. After implementing, verify your changes compile with: bash("bun x tsc --noEmit")

Remember: ONE focused improvement. End with IMPROVEMENT_SUMMARY block.`;
}

interface ImprovementSummary {
  target: string;
  files: string;
  description: string;
}

function extractSummary(agentOutput: string): ImprovementSummary {
  const summaryMatch = agentOutput.match(/IMPROVEMENT_SUMMARY:\s*\n([\s\S]*?)$/);
  if (!summaryMatch) {
    return { target: "unknown", files: "unknown", description: agentOutput.slice(-200) };
  }
  const block = summaryMatch[1];
  const target = block.match(/Target:\s*(.+)/)?.[1]?.trim() ?? "unknown";
  const files = block.match(/Files:\s*(.+)/)?.[1]?.trim() ?? "unknown";
  const description = block.match(/Description:\s*([\s\S]+)/)?.[1]?.trim() ?? "unknown";
  return { target, files, description };
}

export async function runImprovementCycle(): Promise<void> {
  const timestamp = new Date().toISOString();
  console.log(`\n[improve] Starting improvement cycle at ${timestamp}`);

  // Setup OpenAI client (same as main.ts)
  const apiKey = process.env.OPENAI_API_KEY;
  const baseURL = process.env.OPENAI_BASE_URL || process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  const client = new OpenAI({ apiKey, baseURL });

  // Phase 1: Build context and run improvement agent
  console.log("[improve] Building context...");
  const contextMessage = buildContextMessage();

  const messageHistory: ChatCompletionMessageParam[] = [
    { role: "user", content: contextMessage },
  ];

  console.log("[improve] Running improvement agent...");
  const agentOutput = await runAgentLoop(client, messageHistory, {
    maxIterations: 50,
    systemPrompt: IMPROVE_SYSTEM_PROMPT,
  });

  const summary = extractSummary(agentOutput);
  console.log(`[improve] Agent targeted: ${summary.target}`);

  // Phase 2: Git commit
  let commitsThisCycle = 0;
  try {
    gitCommit(`auto-improve: ${summary.target}`);
    commitsThisCycle = 1;
    console.log("[improve] Changes committed.");
  } catch (err: any) {
    // Possibly nothing to commit
    if (err?.message?.includes("nothing to commit") || err?.stderr?.includes("nothing to commit")) {
      console.log("[improve] No changes to commit — agent may not have modified files.");
      appendToLog(
        `## Cycle — ${timestamp}\n**Target**: ${summary.target}\n**Outcome**: NO_CHANGES\n**Notes**: Agent did not modify any files.`,
      );
      return;
    }
    throw err;
  }

  // Phase 3: Test (full suite including integration)
  console.log("[improve] Running tests (including integration)...");
  let testResults = runTestSuite();

  if (testResults.passed) {
    console.log("[improve] Tests PASSED.");
    appendToLog(
      `## Cycle — ${timestamp}\n**Target**: ${summary.target}\n**Files modified**: ${summary.files}\n**Outcome**: SUCCESS\n**Tests**: ${formatTestResults(testResults)}\n**Notes**: ${summary.description}`,
    );
    return;
  }

  // Phase 4: Retry loop
  console.log("[improve] Tests FAILED. Starting retry loop...");
  const MAX_RETRIES = 3;

  for (let retry = 1; retry <= MAX_RETRIES; retry++) {
    console.log(`[improve] Retry ${retry}/${MAX_RETRIES}...`);

    messageHistory.push({
      role: "user",
      content: `Tests failed after your changes. Fix the issues:\n\n${formatTestResults(testResults)}\n\nFix the code to make tests pass. Do NOT revert your improvement — fix the issue while keeping the improvement.`,
    });

    await runAgentLoop(client, messageHistory, {
      maxIterations: 30,
      systemPrompt: IMPROVE_SYSTEM_PROMPT,
    });

    try {
      gitCommit(`auto-improve: fix attempt ${retry}`);
      commitsThisCycle++;
    } catch {
      // nothing to commit, test again anyway
    }

    testResults = runTestSuite();
    if (testResults.passed) {
      console.log(`[improve] Tests PASSED after retry ${retry}.`);
      appendToLog(
        `## Cycle — ${timestamp}\n**Target**: ${summary.target}\n**Files modified**: ${summary.files}\n**Outcome**: SUCCESS_AFTER_RETRY (${retry} retries)\n**Tests**: ${formatTestResults(testResults)}\n**Notes**: ${summary.description}`,
      );
      return;
    }
  }

  // Phase 5: Rollback
  console.log(`[improve] All retries exhausted. Rolling back ${commitsThisCycle} commit(s)...`);
  gitResetHard(commitsThisCycle);
  console.log("[improve] Rolled back.");

  appendToLog(
    `## Cycle — ${timestamp}\n**Target**: ${summary.target}\n**Files modified**: ${summary.files}\n**Outcome**: FAILED_ROLLED_BACK\n**Tests**: ${formatTestResults(testResults)}\n**Notes**: ${summary.description}\n**Failure**: Tests did not pass after ${MAX_RETRIES} retries. All changes rolled back.`,
  );
}

if (import.meta.main) {
  runImprovementCycle()
    .then(() => {
      console.log("[improve] Cycle complete.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("[improve] Fatal error:", err);
      process.exit(1);
    });
}
