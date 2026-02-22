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
