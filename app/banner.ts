// app/banner.ts

import { gradient, dim, palette, getTermWidth } from "./theme.js";
import { getOwlFrame } from "./owl.js";
import type { AgentConfig } from "./types.js";

// ── Block Letters ────────────────────────────────────────
// Hand-crafted "PAUL CODE" using Unicode block chars
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
