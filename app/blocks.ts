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
