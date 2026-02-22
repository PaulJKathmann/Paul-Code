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
