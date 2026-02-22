# Phase 9: Delightful UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform Paul Code's terminal UI from generic to delightful with an animated owl mascot ("Archie"), a cohesive purple/amber color palette, bordered tool blocks, gradient banner, and session summaries — all in pure ANSI with zero new dependencies.

**Architecture:** Five new modules (theme, owl, animations, banner, blocks) replace and extend the existing display layer. The animation engine uses `setInterval` + ANSI cursor repositioning. The owl is a state machine cycling through ASCII art frames. All rendering is synchronous `process.stdout.write()`.

**Tech Stack:** TypeScript, Bun, ANSI escape codes (256-color), Unicode box-drawing characters, zero new npm dependencies.

---

## Task 1: Theme System (`app/theme.ts`)

Replace `app/colors.ts` with a richer theme module that provides the full color palette, 256-color support, gradient utility, and box-drawing helpers.

**Files:**
- Create: `app/theme.ts`
- Modify: `app/display.ts:2` — update import from `./colors.js` to `./theme.js`
- Modify: `app/agent.ts:8` — update import from `./colors.js` to `./theme.js`
- Modify: `app/safety.ts:2` — update import from `./colors.js` to `./theme.js`
- Delete: `app/colors.ts` (after all imports are migrated)

**Step 1: Create `app/theme.ts` with palette and basic color functions**

```typescript
// app/theme.ts

const isTTY = !!process.stdout.isTTY;
const noColor = !!process.env.NO_COLOR;
const enabled = isTTY && !noColor;

// Detect 256-color support
const term = process.env.TERM ?? "";
const colorterm = process.env.COLORTERM ?? "";
const has256 =
  enabled &&
  (colorterm === "truecolor" ||
    colorterm === "24bit" ||
    term.includes("256color") ||
    term === "xterm-kitty" ||
    term === "alacritty");

// ── Palette ──────────────────────────────────────────────

export const palette = {
  owlPurple: 135,   // #8B5CF6
  warmAmber: 214,    // #F59E0B
  softCyan: 44,      // #06B6D4
  forestGreen: 35,   // #10B981
  roseRed: 196,      // #EF4444
  slateDim: 245,     // #64748B
} as const;

// ── Basic ANSI wrappers (backward-compatible) ────────────

function wrap(code: number, text: string): string {
  if (!enabled) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

function wrap256(code: number, text: string): string {
  if (!enabled) return text;
  if (!has256) {
    // Fallback: map 256-color to closest basic color
    return wrap(fallback256(code), text);
  }
  return `\x1b[38;5;${code}m${text}\x1b[0m`;
}

function fallback256(code: number): number {
  // Map key 256-colors to basic 16-color equivalents
  if (code === palette.owlPurple) return 35; // magenta-ish → cyan
  if (code === palette.warmAmber) return 33;  // yellow
  if (code === palette.softCyan) return 36;   // cyan
  if (code === palette.forestGreen) return 32; // green
  if (code === palette.roseRed) return 31;     // red
  if (code === palette.slateDim) return 90;    // bright black (gray)
  return 37; // white fallback
}

// Backward-compatible exports (same API as colors.ts)
export function red(t: string): string { return wrap(31, t); }
export function green(t: string): string { return wrap(32, t); }
export function yellow(t: string): string { return wrap(33, t); }
export function cyan(t: string): string { return wrap(36, t); }
export function bold(t: string): string { return wrap(1, t); }
export function dim(t: string): string { return wrap(2, t); }

// New palette-based colors
export function purple(t: string): string { return wrap256(palette.owlPurple, t); }
export function amber(t: string): string { return wrap256(palette.warmAmber, t); }
export function slate(t: string): string { return wrap256(palette.slateDim, t); }

// ── Gradient ─────────────────────────────────────────────

// ANSI 256-color gradient across a string
// Uses a simple linear interpolation between two 256-color codes
export function gradient(text: string, from: number, to: number): string {
  if (!enabled || text.length === 0) return text;
  if (!has256) return wrap256(from, text);

  let result = "";
  for (let i = 0; i < text.length; i++) {
    const ratio = text.length === 1 ? 0 : i / (text.length - 1);
    const color = Math.round(from + (to - from) * ratio);
    result += `\x1b[38;5;${color}m${text[i]}`;
  }
  return result + "\x1b[0m";
}

// ── Box Drawing ──────────────────────────────────────────

export interface BoxOptions {
  borderColor?: number;   // ANSI 256 color code
  width?: number;         // Override auto-width
  title?: string;         // Title in top border
  titleColor?: number;    // ANSI 256 color for title
}

export function getTermWidth(): number {
  return process.stdout.columns ?? 80;
}

export function box(content: string, options: BoxOptions = {}): string {
  const width = options.width ?? Math.min(getTermWidth(), 80);
  const innerWidth = width - 2; // account for │ borders
  const borderFn = (t: string) =>
    options.borderColor ? wrap256(options.borderColor, t) : dim(t);
  const titleFn = (t: string) =>
    options.titleColor ? wrap256(options.titleColor, t) : t;

  // Top border with optional title
  let top: string;
  if (options.title) {
    const titleStr = ` ${options.title} `;
    const rightPad = Math.max(0, innerWidth - titleStr.length - 1);
    top = borderFn("┌─") + titleFn(titleStr) + borderFn("─".repeat(rightPad) + "┐");
  } else {
    top = borderFn("┌" + "─".repeat(innerWidth) + "┐");
  }

  // Content lines
  const lines = content.split("\n").map((line) => {
    // Pad line to inner width (approximate — ANSI codes make exact padding hard)
    const visibleLen = stripAnsi(line).length;
    const pad = Math.max(0, innerWidth - visibleLen);
    return borderFn("│") + " " + line + " ".repeat(pad > 0 ? pad - 1 : 0) + borderFn("│");
  });

  // Bottom border
  const bottom = borderFn("└" + "─".repeat(innerWidth) + "┘");

  return [top, ...lines, bottom].join("\n");
}

// Strip ANSI escape codes for measuring visible length
export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

// ── Horizontal Rule ──────────────────────────────────────

export function rule(width?: number, color?: number): string {
  const w = width ?? getTermWidth();
  const line = "─".repeat(w);
  return color ? wrap256(color, line) : dim(line);
}
```

**Step 2: Update imports in `app/display.ts`**

Change line 2 from:
```typescript
import { bold, cyan, dim, green, red } from "./colors.js";
```
to:
```typescript
import { bold, cyan, dim, green, red } from "./theme.js";
```

**Step 3: Update imports in `app/agent.ts`**

Change line 8 from:
```typescript
import { red, yellow } from "./colors.js";
```
to:
```typescript
import { red, yellow } from "./theme.js";
```

**Step 4: Update imports in `app/safety.ts`**

Change line 2 from:
```typescript
import { dim, yellow } from "./colors.js";
```
to:
```typescript
import { dim, yellow } from "./theme.js";
```

**Step 5: Delete `app/colors.ts`**

Remove the file — all consumers now import from `theme.ts`.

**Step 6: Verify it still works**

Run: `bun run app/main.ts -p "hello"`
Expected: Same behavior as before — colors work, no import errors.

---

## Task 2: Animation Engine (`app/animations.ts`)

A lightweight frame-based animation controller that handles setInterval cycling, cursor repositioning, and cleanup.

**Files:**
- Create: `app/animations.ts`

**Step 1: Create `app/animations.ts`**

```typescript
// app/animations.ts

const isTTY = !!process.stdout.isTTY;

export interface AnimationOptions {
  interval?: number; // ms between frames, default 200
}

export class AnimationController {
  private timer: ReturnType<typeof setInterval> | null = null;
  private frameIndex = 0;
  private frames: string[] = [];
  private lineCount = 0; // how many lines the last frame occupied

  /** Start animating with the given frames. Each frame is a multi-line string. */
  start(frames: string[], options: AnimationOptions = {}): void {
    if (!isTTY || frames.length === 0) return;

    this.stop();
    this.frames = frames;
    this.frameIndex = 0;
    this.lineCount = 0;

    // Render first frame immediately
    this.renderFrame();

    if (frames.length > 1) {
      this.timer = setInterval(() => {
        this.frameIndex = (this.frameIndex + 1) % this.frames.length;
        this.renderFrame();
      }, options.interval ?? 200);
    }
  }

  /** Stop animation and clear the rendered area. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.clearArea();
    this.lineCount = 0;
  }

  /** Check if currently animating. */
  get active(): boolean {
    return this.timer !== null;
  }

  /** Move cursor up N lines and clear each line. */
  private clearArea(): void {
    if (this.lineCount === 0) return;
    // Move up lineCount lines and clear each
    for (let i = 0; i < this.lineCount; i++) {
      process.stdout.write("\x1b[A"); // cursor up
      process.stdout.write("\x1b[2K"); // clear line
    }
    process.stdout.write("\r"); // carriage return
  }

  /** Render the current frame, clearing the previous one first. */
  private renderFrame(): void {
    this.clearArea();
    const frame = this.frames[this.frameIndex];
    const lines = frame.split("\n");
    this.lineCount = lines.length;
    process.stdout.write(frame + "\n");
  }
}

// Singleton for the owl / main animation
export const mainAnimation = new AnimationController();
```

**Step 2: Verify module loads**

Run: `bun -e "import { AnimationController } from './app/animations.ts'; console.log('ok')"`
Expected: Prints "ok" with no errors.

---

## Task 3: Archie the Owl (`app/owl.ts`)

The owl mascot with 6 states, ASCII art frames, and a state machine.

**Files:**
- Create: `app/owl.ts`

**Step 1: Create `app/owl.ts` with ASCII art frames and state machine**

```typescript
// app/owl.ts

import { amber, purple, dim } from "./theme.js";
import { mainAnimation } from "./animations.js";

export type OwlState = "idle" | "thinking" | "working" | "happy" | "concerned" | "sleeping";

// ── ASCII Art Frames ─────────────────────────────────────
// Each state has 1-4 frames. Frames are small (~6 lines, ~15 chars wide).
// Colors are applied per-line for the owl body (purple) and eyes (amber).

function colorOwl(lines: string[]): string {
  return lines
    .map((line) =>
      line
        .replace(/O/g, amber("O"))    // Eyes
        .replace(/\*/g, amber("*"))   // Sparkle
        .replace(/[{}()\/<>^v|\\]/g, (ch) => purple(ch))  // Body structure
        .replace(/zzZ/g, dim("zzZ"))  // Sleep
    )
    .join("\n");
}

const FRAMES: Record<OwlState, string[]> = {
  idle: [
    colorOwl([
      "   /-^-\\   ",
      "  ( O O )  ",
      "  (  >  )  ",
      "   \\   /   ",
      "    |_|    ",
    ]),
    colorOwl([
      "   /-^-\\   ",
      "  ( O O )  ",
      "  (  <  )  ",
      "   \\   /   ",
      "    |_|    ",
    ]),
  ],

  thinking: [
    colorOwl([
      "   /-^-\\   ",
      "  ( - - )  ",
      "  (  >  )  ",
      "   \\   /   ",
      "    |_|    ",
    ]),
    colorOwl([
      "    /-^-\\  ",
      "   ( - - ) ",
      "   (  >  ) ",
      "    \\   /  ",
      "     |_|   ",
    ]),
    colorOwl([
      "   /-^-\\   ",
      "  ( O O )  ",
      "  (  >  )  ",
      "   \\   /   ",
      "    |_|    ",
    ]),
    colorOwl([
      "  /-^-\\    ",
      " ( - - )   ",
      " (  >  )   ",
      "  \\   /    ",
      "   |_|     ",
    ]),
  ],

  working: [
    colorOwl([
      "   /-^-\\   ",
      "  ( O O )  ",
      "  (  >  )  ",
      "  /\\   /\\  ",
      "    |_|    ",
    ]),
    colorOwl([
      "   /-^-\\   ",
      "  ( O O )  ",
      "  (  <  )  ",
      "  /\\   /\\  ",
      "    |_|    ",
    ]),
  ],

  happy: [
    colorOwl([
      "   /-^-\\   ",
      "  ( ^ ^ )  ",
      "  (  v  )  ",
      "  \\\\   //  ",
      "    |_|    ",
    ]),
    colorOwl([
      "  */-^-\\*  ",
      "  ( ^ ^ )  ",
      "  (  v  )  ",
      "  \\\\   //  ",
      "    |_|    ",
    ]),
    colorOwl([
      "   /-^-\\   ",
      "  ( ^ ^ )  ",
      "  (  v  )  ",
      "   \\   /   ",
      "    |_|    ",
    ]),
  ],

  concerned: [
    colorOwl([
      "   /-^-\\   ",
      "  ( o O )  ",
      "  (  ~  )  ",
      "  |\\   /   ",
      "    |_|    ",
    ]),
    colorOwl([
      "   /-^-\\   ",
      "  ( O o )  ",
      "  (  ~  )  ",
      "  |\\   /   ",
      "    |_|    ",
    ]),
  ],

  sleeping: [
    colorOwl([
      "   /-^-\\   ",
      "  ( - - )  ",
      "  (  .  )  ",
      "   \\   /   ",
      "    |_|    ",
    ]),
    colorOwl([
      "   /-^-\\   ",
      "  ( - - )   zzZ",
      "  (  .  )  ",
      "   \\   /   ",
      "    |_|    ",
    ]),
  ],
};

// ── State Machine ────────────────────────────────────────

let currentState: OwlState = "idle";

export function setOwlState(state: OwlState): void {
  if (state === currentState) return;
  currentState = state;
  mainAnimation.start(FRAMES[state], {
    interval: state === "thinking" ? 300 : state === "sleeping" ? 800 : 400,
  });
}

export function getOwlState(): OwlState {
  return currentState;
}

export function stopOwl(): void {
  mainAnimation.stop();
}

/** Get a single static frame for the given state (for startup / inline use). */
export function getOwlFrame(state: OwlState, frameIndex = 0): string {
  const frames = FRAMES[state];
  return frames[frameIndex % frames.length];
}

/** The small prompt icon. */
export const OWL_PROMPT = "🦉 › ";
```

**Step 2: Verify module loads and frames render**

Run: `bun -e "import { getOwlFrame } from './app/owl.ts'; console.log(getOwlFrame('idle'))"`
Expected: A small colored owl printed to terminal.

---

## Task 4: Startup Banner (`app/banner.ts`)

Hand-crafted block-letter banner with gradient, owl entrance, greeting, and status bar.

**Files:**
- Create: `app/banner.ts`

**Step 1: Create `app/banner.ts`**

```typescript
// app/banner.ts

import { gradient, dim, palette, getTermWidth } from "./theme.js";
import { getOwlFrame } from "./owl.js";
import type { AgentConfig } from "./types.js";

// ── Block Letters ────────────────────────────────────────
// Hand-crafted "PAUL CODE" using Unicode block chars (█ ▄ ▀)
// Each letter is 5 lines tall. This keeps it compact.

const LETTERS: Record<string, string[]> = {
  P: ["█▀▀█", "█▀▀▄", "█  ▀", "▀   ", "    "],
  A: [" ▄▀▄", "█▀▀█", "█  █", "▀  ▀", "    "],
  U: ["█  █", "█  █", "█  █", " ▀▀ ", "    "],
  L: ["█   ", "█   ", "█   ", "▀▀▀▀", "    "],
  C: [" ▄▀▀", "█   ", "█   ", " ▀▀▀", "    "],
  O: [" ▄▀▄", "█   █", "█   █", " ▀▀▀", "     "],
  D: ["█▀▀▄", "█  █", "█  █", "▀▀▀ ", "    "],
  E: ["█▀▀▀", "█▀▀ ", "█   ", "▀▀▀▀", "    "],
  " ": ["  ", "  ", "  ", "  ", "  "],
};

function renderBannerText(text: string): string[] {
  const lines: string[] = ["", "", "", "", ""];
  for (const ch of text.toUpperCase()) {
    const letter = LETTERS[ch] ?? LETTERS[" "];
    for (let row = 0; row < 5; row++) {
      lines[row] += (letter[row] ?? "") + " ";
    }
  }
  return lines;
}

// ── Greetings ────────────────────────────────────────────

const GREETINGS = [
  "Ready to build something great.",
  "What shall we work on today?",
  "Your code, my wings. Let's go.",
  "Standing by, fully caffeinated.",
  "Another day, another diff.",
  "Watching over your codebase.",
  "Perched and ready to help.",
  "Eyes on the code. What's the plan?",
];

function randomGreeting(): string {
  return GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
}

// ── Startup ──────────────────────────────────────────────

export function renderStartup(config: AgentConfig): string {
  const bannerLines = renderBannerText("PAUL CODE");

  // Apply gradient to each line (cyan → purple range in 256-color)
  const gradientBanner = bannerLines
    .filter((line) => line.trim().length > 0)
    .map((line) => gradient(line, palette.softCyan, palette.owlPurple))
    .join("\n");

  const owl = getOwlFrame("idle");
  const greeting = dim(randomGreeting());

  const contextSize = `${Math.round(config.contextWindowSize / 1000)}k`;
  const statusBar = dim(
    `model: ${config.model} | context: 0/${contextSize} | /help for commands`,
  );

  return [
    "",
    gradientBanner,
    "",
    owl,
    "",
    greeting,
    statusBar,
    "",
  ].join("\n");
}
```

**Step 2: Verify banner renders**

Run: `bun -e "import { renderStartup } from './app/banner.ts'; import { loadConfig } from './app/config.ts'; console.log(renderStartup(loadConfig()))"`
Expected: A colorful gradient "PAUL CODE" banner with owl and greeting.

---

## Task 5: Bordered Blocks (`app/blocks.ts`)

Tool output blocks with box-drawing borders, headers, and footers.

**Files:**
- Create: `app/blocks.ts`

**Step 1: Create `app/blocks.ts`**

```typescript
// app/blocks.ts

import { dim, green, red, purple, amber, slate, stripAnsi, getTermWidth, bold } from "./theme.js";

// ── Tool Block ───────────────────────────────────────────

export interface ToolBlockOptions {
  toolName: string;
  args: string;      // Summarized args string
  content: string;   // Tool output
  elapsed: number;   // ms
  lineCount: number;
  isError: boolean;
}

const MAX_CONTENT_LINES = 15;

export function renderToolBlock(options: ToolBlockOptions): string {
  const { toolName, args, content, elapsed, lineCount, isError } = options;
  const width = Math.min(getTermWidth() - 2, 80);
  const innerWidth = width - 4; // │ + space + content + space + │

  const borderColor = isError ? red : purple;
  const icon = isError ? "✗" : "🔧";
  const statusIcon = isError ? red("✗") : green("✓");

  // Header
  const headerText = ` ${icon} ${toolName} ─── ${args} `;
  const headerPad = Math.max(0, width - stripAnsi(headerText).length - 2);
  const header = borderColor("┌─") + bold(headerText) + borderColor("─".repeat(headerPad) + "┐");

  // Content lines (collapsed if too long)
  const contentLines = content.split("\n");
  const displayLines =
    contentLines.length > MAX_CONTENT_LINES
      ? [
          ...contentLines.slice(0, MAX_CONTENT_LINES),
          slate(`  ... ${contentLines.length - MAX_CONTENT_LINES} more lines`),
        ]
      : contentLines;

  const body = displayLines.map((line) => {
    const truncated = stripAnsi(line).length > innerWidth
      ? line.slice(0, innerWidth - 1) + "…"
      : line;
    return borderColor("│") + " " + dim(truncated);
  });

  // Footer
  const elapsedStr =
    elapsed >= 1000 ? `${(elapsed / 1000).toFixed(1)}s` : `${Math.round(elapsed)}ms`;
  const footerText = ` ${statusIcon} ${elapsedStr} ─── ${lineCount} lines `;
  const footerPad = Math.max(0, width - stripAnsi(footerText).length - 2);
  const footer = borderColor("└─") + footerText + borderColor("─".repeat(footerPad) + "┘");

  return [header, ...body, footer].join("\n");
}

// ── Summary Block ────────────────────────────────────────

export interface SessionSummary {
  toolsUsed: number;
  elapsed: number; // total ms
  filesChanged: number;
  tokens: number;
}

export function renderSessionSummary(summary: SessionSummary): string {
  const elapsedStr =
    summary.elapsed >= 1000
      ? `${(summary.elapsed / 1000).toFixed(1)}s`
      : `${Math.round(summary.elapsed)}ms`;

  const content = [
    `  Tools used: ${amber(String(summary.toolsUsed))}  │  Time: ${amber(elapsedStr)}`,
    `  Files changed: ${amber(String(summary.filesChanged))}  │  Tokens: ${amber(summary.tokens.toLocaleString())}`,
  ].join("\n");

  const width = Math.min(getTermWidth() - 2, 50);
  const innerWidth = width - 2;

  const title = " Session Summary ";
  const titlePad = Math.max(0, innerWidth - title.length - 1);
  const top = purple("┌─") + bold(title) + purple("─".repeat(titlePad) + "┐");
  const bottom = purple("└" + "─".repeat(innerWidth) + "┘");

  const lines = content.split("\n").map((line) => purple("│") + line);

  return [top, ...lines, bottom].join("\n");
}

// ── Connector ────────────────────────────────────────────

/** Vertical connector between tool blocks in a timeline. */
export function renderConnector(): string {
  return purple("│");
}
```

**Step 2: Verify block renders**

Run: `bun -e "import { renderToolBlock } from './app/blocks.ts'; console.log(renderToolBlock({ toolName: 'read_file', args: 'src/index.ts', content: 'hello world', elapsed: 42, lineCount: 1, isError: false }))"`
Expected: A bordered block with purple borders, tool name, and green checkmark.

---

## Task 6: Upgraded Spinner (`app/spinner.ts`)

Replace the basic braille spinner with a gradient-cycling spinner that shows elapsed time.

**Files:**
- Modify: `app/spinner.ts` (full rewrite)

**Step 1: Rewrite `app/spinner.ts`**

```typescript
// app/spinner.ts

import { palette } from "./theme.js";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const isTTY = !!process.stdout.isTTY;

// Gradient colors for the spinner to cycle through
const GRADIENT_COLORS = [
  palette.softCyan,
  palette.owlPurple,
  palette.warmAmber,
  palette.owlPurple,
  palette.softCyan,
];

let interval: ReturnType<typeof setInterval> | null = null;
let frameIndex = 0;
let startTime = 0;

export function startSpinner(message = "Thinking"): void {
  if (!isTTY) return;
  frameIndex = 0;
  startTime = performance.now();

  interval = setInterval(() => {
    const frame = FRAMES[frameIndex % FRAMES.length];
    const colorIndex = frameIndex % GRADIENT_COLORS.length;
    const color = GRADIENT_COLORS[colorIndex];
    const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);

    process.stdout.write(
      `\r\x1b[K\x1b[38;5;${color}m${frame}\x1b[0m \x1b[2m${message}... (${elapsed}s)\x1b[0m`,
    );
    frameIndex++;
  }, 80);
}

export function stopSpinner(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
    process.stdout.write("\r\x1b[K");
  }
}
```

**Step 2: Verify spinner works**

Run: `bun -e "import { startSpinner, stopSpinner } from './app/spinner.ts'; startSpinner(); setTimeout(() => { stopSpinner(); console.log('done'); }, 2000)"`
Expected: A color-cycling spinner with elapsed timer for 2 seconds, then "done".

---

## Task 7: Update Display Layer (`app/display.ts`)

Update the display module to use theme and provide the new tool display functions.

**Files:**
- Modify: `app/display.ts` (update imports, add helper functions)

**Step 1: Update `app/display.ts`**

Replace full contents of `app/display.ts`:

```typescript
// app/display.ts

import { createTwoFilesPatch } from "diff";
import { bold, cyan, dim, green, red, slate } from "./theme.js";
import { renderToolBlock, renderConnector, type ToolBlockOptions } from "./blocks.js";

const MAX_DISPLAY_LINES = 20;

// ── Diff Display ─────────────────────────────────────────

export function formatDiff(filePath: string, oldContent: string, newContent: string): string {
  const patch = createTwoFilesPatch(
    `a/${filePath}`,
    `b/${filePath}`,
    oldContent,
    newContent,
    "",
    "",
    { context: 3 },
  );

  return patch
    .split("\n")
    .map((line) => {
      if (line.startsWith("+++") || line.startsWith("---")) return bold(line);
      if (line.startsWith("+")) return green(line);
      if (line.startsWith("-")) return red(line);
      if (line.startsWith("@@")) return cyan(line);
      return dim(line);
    })
    .join("\n");
}

// ── Tool Display (New: Bordered Blocks) ──────────────────

export function displayToolExecution(
  toolName: string,
  args: Record<string, unknown>,
  result: string,
  elapsed: number,
  isError: boolean,
): string {
  const summary = summarizeArgs(toolName, args);
  const lineCount = result.split("\n").length;

  return renderToolBlock({
    toolName,
    args: summary,
    content: result,
    elapsed,
    lineCount,
    isError,
  });
}

// ── Legacy Functions (kept for backward compat) ──────────

export function formatToolHeader(toolName: string, args: Record<string, unknown>): string {
  const summary = summarizeArgs(toolName, args);
  return `${cyan("⏵")} ${cyan(toolName)} ${dim(summary)}`;
}

export function formatToolResult(toolName: string, elapsedMs: number, result: string): string {
  const elapsed =
    elapsedMs >= 1000 ? `${(elapsedMs / 1000).toFixed(1)}s` : `${Math.round(elapsedMs)}ms`;

  const lineCount = result.split("\n").length;
  const summary = lineCount > 1 ? ` — ${lineCount} lines` : "";

  return `${green("✓")} ${green(toolName)} ${dim(`(${elapsed})${summary}`)}`;
}

export function formatToolOutput(result: string): string {
  const lines = result.split("\n");
  if (lines.length <= MAX_DISPLAY_LINES) {
    return dim(result);
  }

  const shown = lines.slice(0, MAX_DISPLAY_LINES).join("\n");
  const hidden = lines.length - MAX_DISPLAY_LINES;
  return `${dim(shown)}\n${dim(`[... ${hidden} more lines]`)}`;
}

// ── Agent Output Gutter ──────────────────────────────────

/** Wrap text with a subtle dim left gutter to distinguish agent output. */
export function withGutter(text: string): string {
  return text
    .split("\n")
    .map((line) => slate("│ ") + line)
    .join("\n");
}

// ── Helpers ──────────────────────────────────────────────

export function summarizeArgs(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case "read_file":
    case "write_file":
    case "edit_file":
      return String(args.file_path ?? "");
    case "bash":
      return truncate(String(args.command ?? ""), 80);
    case "grep_search":
    case "glob_find":
      return truncate(String(args.pattern ?? ""), 60);
    case "list_directory":
      return String(args.path ?? ".");
    default:
      return "";
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}
```

**Step 2: Verify module compiles**

Run: `bun -e "import { displayToolExecution } from './app/display.ts'; console.log('ok')"`
Expected: Prints "ok".

---

## Task 8: Integrate into Agent Loop (`app/agent.ts`)

Wire everything together: owl state transitions, bordered tool blocks, session summary, and the new spinner.

**Files:**
- Modify: `app/agent.ts`

**Step 1: Update imports in `app/agent.ts`**

Replace lines 1-23 with:

```typescript
import type OpenAI from "openai";
import type {
  ChatCompletionMessage,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions/completions.js";
import type { ChatCompletionMessageToolCall } from "openai/resources/chat/completions/completions.mjs";
import * as readline from "readline/promises";
import { red, yellow, dim } from "./theme.js";
import {
  countToolSchemaTokens,
  formatCompactionResult,
  formatContextUsage,
  getContextUsage,
  needsCompaction,
  performCompaction,
} from "./context.js";
import { displayToolExecution, summarizeArgs } from "./display.js";
import { buildSystemPrompt } from "./prompts.js";
import { classifyRisk, confirmDangerous } from "./safety.js";
import { startSpinner, stopSpinner } from "./spinner.js";
import { countStringTokens } from "./tokens.js";
import { executeTool, toolSchemas } from "./tools/index.js";
import type { AgentConfig, ContextBudget } from "./types.js";
import { setOwlState, stopOwl, OWL_PROMPT } from "./owl.js";
import { renderConnector } from "./blocks.js";
import { renderSessionSummary } from "./blocks.js";
```

**Step 2: Add session tracking to `runAgentLoop`**

After line `let iterations = 0;` (inside `runAgentLoop`), add session tracking variables:

```typescript
  let totalToolsUsed = 0;
  let totalFilesChanged = 0;
  const loopStartTime = performance.now();
```

**Step 3: Replace tool execution display in agent loop**

Replace the tool execution block (lines 102-115, the formatToolHeader → formatToolResult section) with:

```typescript
      // Execute with timing and bordered display
      setOwlState("working");

      if (totalToolsUsed > 0) {
        console.log(renderConnector());
      }

      const start = performance.now();
      let result: string;
      let isError = false;
      try {
        result = await executeTool(toolName, parsedArgs);
      } catch (err) {
        result = `Error: ${err instanceof Error ? err.message : String(err)}`;
        isError = true;
      }
      const elapsed = performance.now() - start;

      console.log(displayToolExecution(toolName, parsedArgs, result, elapsed, isError));

      // Track stats
      totalToolsUsed++;
      if (["write_file", "edit_file"].includes(toolName) && !isError) {
        totalFilesChanged++;
      }

      if (isError) {
        setOwlState("concerned");
      }
```

**Step 4: Add session summary after loop exits**

Before the final `return message.content ?? "";` (around line 74-75), add:

```typescript
    // Show session summary if we used multiple tools
    stopOwl();
    if (totalToolsUsed >= 2) {
      const totalElapsed = performance.now() - loopStartTime;
      const tokenCount = getContextUsage(messageHistory, budget).used;
      setOwlState("happy");
      // Let happy animation play briefly
      await new Promise((resolve) => setTimeout(resolve, 800));
      stopOwl();
      console.log("");
      console.log(
        renderSessionSummary({
          toolsUsed: totalToolsUsed,
          elapsed: totalElapsed,
          filesChanged: totalFilesChanged,
          tokens: tokenCount,
        }),
      );
    } else {
      setOwlState("idle");
    }
```

**Step 5: Add owl state to thinking**

In `processStream` function (around line 166), replace `startSpinner("Thinking");` with:

```typescript
  setOwlState("thinking");
  startSpinner("Thinking");
```

And at the `stopSpinner()` after first chunk (around line 185-187), add after `stopSpinner()`:

```typescript
      stopOwl();
```

Also at the safety `stopSpinner()` at the end (around line 215), add:

```typescript
  stopOwl();
```

**Step 6: Verify agent runs**

Run: `bun run app/main.ts -p "what is 2+2?"`
Expected: Owl thinking animation → spinner → response with owl states transitioning. No tool blocks for a simple Q&A (no tools called).

---

## Task 9: Integrate Startup & REPL (`app/main.ts`)

Wire in the startup banner and styled prompt.

**Files:**
- Modify: `app/main.ts`

**Step 1: Update `app/main.ts`**

Replace the full contents:

```typescript
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions/completions.mjs";
import { parseArgs } from "node:util";
import { runAgentLoop, runInteractiveMode } from "./agent.ts";
import { loadConfig } from "./config.ts";
import { renderStartup } from "./banner.ts";
import { stopOwl } from "./owl.ts";

process.on("SIGINT", () => {
  stopOwl(); // Clean up any running animation
  console.log("\nGoodbye! 🦉");
  process.exit(0);
});

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      prompt: { type: "string", short: "p" },
      model: { type: "string" },
      "max-iterations": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: false,
  });
  if (values.help) {
    console.log(`Usage: paul-code [options]
      -p, --prompt <text>     Single-shot mode
      --model <name>          Override model
      --max-iterations <n>    Override max iterations
      -h, --help              Show help`);
    process.exit(0);
  }
  const config = loadConfig();
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });
  const messageHistory: ChatCompletionMessageParam[] = [];

  if (values.prompt && typeof values.prompt === "string") {
    // Headless (single shot mode) — no banner
    messageHistory.push({ role: "user", content: values.prompt });
    const result = await runAgentLoop(client, messageHistory, config);
    console.log(result);
  } else {
    // Interactive mode — show banner
    console.log(renderStartup(config));
    await runInteractiveMode(client, messageHistory, config);
  }
}

main().catch((err) => {
  stopOwl();
  console.error(err);
  process.exit(1);
});
```

**Step 2: Update REPL in `app/agent.ts` — styled prompt**

In `runInteractiveMode` (around line 246-247), replace:
```typescript
  console.log("Paul Code — interactive mode");
  console.log("/help for commands. Ctrl+C or /exit to quit.\n");
```
with:
```typescript
  // Banner is shown by main.ts, so we skip the old text header
```

Replace the prompt line (line 277):
```typescript
    const userInputRaw = (await rl.question("\nYou > ")).trim();
```
with:
```typescript
    const userInputRaw = (await rl.question(`\n${OWL_PROMPT}`)).trim();
```

And import `OWL_PROMPT` — it's already imported from the Step 1 import update.

Replace the divider + "Paul Code > " output (lines 327-328):
```typescript
    printDivider();
    process.stdout.write("Paul Code > ");
```
with:
```typescript
    console.log("");
```

**Step 3: Verify interactive mode**

Run: `bun run app/main.ts`
Expected: Gradient "PAUL CODE" banner, owl, greeting, status bar, then `🦉 ›` prompt.

---

## Task 10: Final Polish & Cleanup

Clean up any remaining references to the old system.

**Files:**
- Delete: `app/colors.ts` (if not already deleted in Task 1)
- Verify: All imports reference `./theme.js` not `./colors.js`

**Step 1: Search for any remaining `colors.js` imports**

Run: `grep -r "colors.js" app/`
Expected: No results. If any found, update them to `theme.js`.

**Step 2: Full integration test**

Run: `bun run app/main.ts`
Then type a prompt that triggers tool use, e.g.: `read the file package.json`
Expected:
1. Banner with gradient, owl, greeting
2. `🦉 ›` prompt
3. Owl thinking animation while API responds
4. Bordered tool block for `read_file`
5. Streaming response
6. Back to `🦉 ›` prompt

**Step 3: Test single-shot mode**

Run: `bun run app/main.ts -p "list the files in the current directory"`
Expected: No banner. Tool blocks render. Session summary if multiple tools used.

**Step 4: Test error case**

Run: `bun run app/main.ts -p "read the file /nonexistent/path"`
Expected: Red-bordered tool block with error. Owl concerned state.

---

## Summary of All Changes

| File | Action | Description |
|------|--------|-------------|
| `app/theme.ts` | **Create** | Color palette, 256-color, gradients, box drawing |
| `app/owl.ts` | **Create** | Archie ASCII art, 6 states, state machine |
| `app/animations.ts` | **Create** | Frame animation engine, cursor repositioning |
| `app/banner.ts` | **Create** | Startup banner, greetings, status bar |
| `app/blocks.ts` | **Create** | Bordered tool blocks, session summary |
| `app/spinner.ts` | **Rewrite** | Gradient cycling, elapsed timer |
| `app/display.ts` | **Rewrite** | Use blocks, add gutter, keep diff formatting |
| `app/agent.ts` | **Modify** | Owl states, block display, session tracking |
| `app/main.ts` | **Modify** | Banner startup, styled prompt, owl cleanup |
| `app/colors.ts` | **Delete** | Replaced by `theme.ts` |

**Zero new dependencies.** Everything is pure ANSI escape codes and Unicode.
