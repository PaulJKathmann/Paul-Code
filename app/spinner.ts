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
