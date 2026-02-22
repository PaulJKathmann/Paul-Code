const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

let interval: ReturnType<typeof setInterval> | null = null;
let frameIndex = 0;

export function startSpinner(message = "Thinking"): void {
  if (!process.stdout.isTTY) return;
  frameIndex = 0;

  interval = setInterval(() => {
    const frame = FRAMES[frameIndex % FRAMES.length];
    process.stdout.write(`\r\x1b[K\x1b[2m${frame} ${message}...\x1b[0m`);
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
