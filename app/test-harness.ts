import { execSync, type ExecSyncOptionsWithStringEncoding } from "child_process";

export interface TestResult {
  name: string;
  passed: boolean;
  output: string;
  durationMs: number;
}

export interface TestSuiteResult {
  passed: boolean;
  results: TestResult[];
}

const PROJECT_ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const EXEC_OPTS: ExecSyncOptionsWithStringEncoding = {
  encoding: "utf-8",
  cwd: PROJECT_ROOT,
  stdio: ["pipe", "pipe", "pipe"],
};

function runTest(name: string, fn: () => string): TestResult {
  const start = Date.now();
  try {
    const output = fn();
    return { name, passed: true, output, durationMs: Date.now() - start };
  } catch (err: any) {
    const output = err?.stdout
      ? `${err.stdout}\nSTDERR:\n${err.stderr ?? ""}`
      : err?.message ?? String(err);
    return { name, passed: false, output, durationMs: Date.now() - start };
  }
}

function runTypecheck(): TestResult {
  return runTest("typecheck", () => {
    execSync("bun x tsc --noEmit", { ...EXEC_OPTS, timeout: 60_000 });
    return "Type-check passed";
  });
}

function runSmokeTests(): TestResult {
  return runTest("smoke-tests", () => {
    const out = execSync("bun run app/tests/tools.smoke.test.ts", {
      ...EXEC_OPTS,
      timeout: 30_000,
    });
    return out;
  });
}

interface IntegrationCase {
  prompt: string;
  expectContains: string[];
  description: string;
}

const INTEGRATION_CASES: IntegrationCase[] = [
  {
    prompt: "Read the file package.json and tell me the name field",
    expectContains: ["codecrafters"],
    description: "Agent can read files and extract info",
  },
  {
    prompt: "List the files in the app directory",
    expectContains: ["agent.ts"],
    description: "Agent can list directory contents",
  },
  {
    prompt: "What is 2+2? Answer with just the number.",
    expectContains: ["4"],
    description: "Agent can answer simple questions",
  },
];

function runIntegrationTest(testCase: IntegrationCase): TestResult {
  return runTest(`integration: ${testCase.description}`, () => {
    const escapedPrompt = testCase.prompt.replace(/"/g, '\\"');
    const out = execSync(
      `bun run app/main.ts -p "${escapedPrompt}"`,
      { ...EXEC_OPTS, timeout: 120_000, maxBuffer: 5 * 1024 * 1024 },
    );

    const lower = out.toLowerCase();
    const missing = testCase.expectContains.filter(
      (s) => !lower.includes(s.toLowerCase()),
    );

    if (missing.length > 0) {
      throw new Error(
        `Output missing expected content: ${JSON.stringify(missing)}\nActual output:\n${out.slice(0, 2000)}`,
      );
    }

    return `Passed — output contains: ${testCase.expectContains.join(", ")}`;
  });
}

export function runTestSuite(options?: { skipIntegration?: boolean }): TestSuiteResult {
  const results: TestResult[] = [];

  // Level 1: Typecheck
  const typecheck = runTypecheck();
  results.push(typecheck);
  if (!typecheck.passed) {
    return { passed: false, results };
  }

  // Level 2: Smoke tests
  const smoke = runSmokeTests();
  results.push(smoke);
  if (!smoke.passed) {
    return { passed: false, results };
  }

  // Level 3: Integration tests (can be skipped for speed)
  if (!options?.skipIntegration) {
    for (const testCase of INTEGRATION_CASES) {
      results.push(runIntegrationTest(testCase));
    }
  }

  const passed = results.every((r) => r.passed);
  return { passed, results };
}

export function formatTestResults(suite: TestSuiteResult): string {
  const lines = suite.results.map((r) => {
    const icon = r.passed ? "✓" : "✗";
    const duration = `${r.durationMs}ms`;
    const detail = r.passed ? "" : `\n  ${r.output.split("\n")[0]}`;
    return `  ${icon} ${r.name} (${duration})${detail}`;
  });

  const summary = suite.passed ? "ALL TESTS PASSED" : "SOME TESTS FAILED";
  const passCount = suite.results.filter((r) => r.passed).length;
  return `${summary} (${passCount}/${suite.results.length})\n${lines.join("\n")}`;
}

// Allow standalone execution: bun run app/test-harness.ts [--skip-integration]
if (import.meta.main) {
  const skipIntegration = process.argv.includes("--skip-integration");
  console.log("Running test suite...\n");
  const result = runTestSuite({ skipIntegration });
  console.log(formatTestResults(result));
  process.exit(result.passed ? 0 : 1);
}
