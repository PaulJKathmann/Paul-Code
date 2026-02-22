# Phase 9: Delightful UI — "Archie the Owl"

> Turn Paul Code from a functional CLI agent into one that inspires delight through
> a living mascot, rich visual identity, and animated interactions — all in pure ANSI
> with zero new dependencies.

## Design Philosophy

- **Friendly companion**: Paul Code should feel like a wise, approachable buddy in your shell
- **Living mascot**: An animated owl named "Archie" (short for architect) that reacts to what's happening
- **Pure ANSI art**: No new dependencies — everything with escape codes, box-drawing chars, and Unicode
- **Speed is delight**: Nothing artificial — all rendering <100ms

## 9.1 The Owl Mascot — Archie

### States

Archie has 6 emotional states, each a small ASCII art sprite (~5-7 lines tall, ~12-15 chars wide):

| State | Trigger | Visual |
|-------|---------|--------|
| **Idle** | Waiting for input | Eyes open, calm posture |
| **Thinking** | API call in flight | Eyes half-closed, head tilts side to side |
| **Working** | Tool executing | Eyes tracking, alert posture |
| **Happy** | Task complete | Wings slightly raised, sparkle near eyes |
| **Concerned** | Error or warning | Eyebrows furrowed, one wing up |
| **Sleeping** | Long idle (>60s) | Eyes closed, "zzz" floating |

### Animation

- Each state has 2-4 ASCII art frames
- 200ms frame interval for smooth animation
- Transitions between states: clear + redraw
- Thinking animation: head tilts L/R, blink cycle
- Happy animation: brief `✨` sparkle (2-3 frames, settles)

### Placement

- Full owl renders in the startup banner and during thinking/waiting states
- Miniaturized to `🦉` emoji in the REPL prompt during conversation
- Uses cursor repositioning to animate in-place (no scroll)

### Implementation

New file: `app/owl.ts`
- ASCII art frame arrays for each state
- State machine: `setOwlState(state)` triggers transition
- Animation controller: `startOwlAnimation()` / `stopOwlAnimation()`
- Cursor-based rendering: writes to a reserved screen area

## 9.2 Startup Experience

When Paul Code launches:

1. **Gradient banner** — "PAUL CODE" in large Unicode block characters (`█`, `▄`, `▀`),
   colored with a cyan → blue → purple gradient using ANSI 256-color codes.
   Hand-crafted letter shapes (no figlet dependency).

2. **Owl entrance** — Archie appears below the banner in idle state with a 2-3 frame
   "eyes opening" arrival animation.

3. **Welcome line** — Randomly selected greeting from a pool of 8-10:
   - "Ready to build something great."
   - "What shall we work on today?"
   - "Your code, my wings. Let's go."
   - etc.

4. **Status bar** — Single dim line:
   `model: claude-sonnet-4-20250514 | context: 0/128k | /help for commands`

5. **Styled prompt** — `🦉 › ` with owl emoji and clean chevron.

### Implementation

New file: `app/banner.ts`
- `renderBanner()`: Block-letter "PAUL CODE" with gradient
- `greetings[]`: Pool of welcome messages
- `renderStartup()`: Orchestrates banner → owl entrance → greeting → status → prompt

Modified: `app/main.ts` — call `renderStartup()` on launch, use styled prompt.

## 9.3 Thinking & Working States

### During API Calls (Thinking)

- Archie's thinking animation plays (head tilts, blinks)
- Rich spinner with live elapsed timer: `Thinking... (2.1s)`
- Spinner uses gradient color cycling through braille frames
- Entire thinking block renders in-place via cursor repositioning (no scroll)

### During Tool Execution (Working)

- Owl switches to alert/tracking state
- Tool output in bordered blocks:

```
┌─ 🔧 read_file ─── src/index.ts ──────────┐
│  (dimmed file content, collapsed >15 lines) │
└─ ✓ 12ms ─── 45 lines ───────────────────┘
```

- Sequential tools create a visual timeline with connecting `│` lines
- Success: green borders/footer. Error: red borders/footer.

### During Streaming (Text Output)

- Archie goes to idle state (out of the way)
- Clean text streaming — no boxing
- Subtle dim `│` gutter on left marks agent output vs user input

### Implementation

New file: `app/blocks.ts`
- `renderToolBlock(header, content, footer, style)`: Box-drawing bordered block
- `renderTimeline(blocks[])`: Stack blocks with connecting lines
- Auto-width detection via `process.stdout.columns`

New file: `app/animations.ts`
- `AnimationController`: setInterval + cursor reposition engine
- `startAnimation(frames, interval)` / `stopAnimation()`
- Handles cleanup on ctrl-c, pipe detection, resize events

Modified: `app/spinner.ts` — Upgrade to gradient color cycling, integrate with animation controller.
Modified: `app/agent.ts` — Owl state transitions, bordered tool blocks, timeline display.

## 9.4 Completion & Celebration

When the agent finishes a multi-tool task:

- **Archie goes happy** — wings up, brief `✨` sparkle animation (2-3 frames, settles)
- **Session summary** in a bordered box:

```
┌─ Session Summary ────────────────────────┐
│  Tools used: 5  │  Time: 12.3s           │
│  Files changed: 2  │  Tokens: 3,421      │
└──────────────────────────────────────────┘
```

- Summary only appears after multi-tool interactions (not simple Q&A)
- For errors: Archie goes concerned, red/yellow borders, clear error formatting
- Prompt returns with Archie back to idle: `🦉 › `

### Implementation

Modified: `app/agent.ts`
- Track tool count, file changes, elapsed time, token usage per turn
- After agent loop ends (no more tool calls), conditionally render summary
- Trigger owl happy/concerned state based on outcome

## 9.5 Color Palette & Theme

Replace basic `colors.ts` with a cohesive visual identity.

### Palette

| Name | Hex | ANSI 256 | Usage |
|------|-----|----------|-------|
| Owl Purple | `#8B5CF6` | 135 | Brand color, borders, headers, owl body |
| Warm Amber | `#F59E0B` | 214 | Owl eyes, highlights, warnings |
| Soft Cyan | `#06B6D4` | 44 | Info, links, secondary elements |
| Forest Green | `#10B981` | 35 | Success, additions, completion |
| Rose Red | `#EF4444` | 196 | Errors, deletions, danger |
| Slate Dim | `#64748B` | 245 | Muted text, timestamps, secondary info |

### Gradient Utility

Interpolates between two ANSI 256 colors across a string. Used for:
- Startup banner (cyan → purple)
- Thinking spinner (cycling through palette)
- Horizontal separators

### Fallback

Detect terminal capability via `TERM` env var. Fall back to basic 16-color ANSI
if 256-color is not supported. Respect `NO_COLOR` env var.

### Implementation

New file: `app/theme.ts`
- Palette constants with ANSI 256 codes
- `gradient(text, fromColor, toColor)`: Per-character color interpolation
- `box(content, options)`: Box-drawing utility with configurable border color
- `rule(width?, color?)`: Horizontal separator
- Backward-compatible exports for `red()`, `green()`, etc.

Deprecated: `app/colors.ts` — replaced by `theme.ts`.

## 9.6 File Structure

### New Files

| File | Purpose |
|------|---------|
| `app/owl.ts` | Archie ASCII art, state machine, animation |
| `app/theme.ts` | Color palette, gradients, box-drawing |
| `app/banner.ts` | Startup banner, greetings, status bar |
| `app/blocks.ts` | Bordered blocks for tool output, summaries |
| `app/animations.ts` | Frame animation engine, cursor management |

### Modified Files

| File | Changes |
|------|---------|
| `app/agent.ts` | Owl state transitions, block-based tool display, session summary |
| `app/main.ts` | Startup banner, styled prompt |
| `app/spinner.ts` | Gradient cycling, animation controller integration |
| `app/display.ts` | Use blocks and theme for formatting |
| `app/colors.ts` | Deprecated → `theme.ts` |

### Key Architectural Decisions

1. **Animation engine**: Simple `setInterval` + cursor repositioning — no framework
2. **Owl state machine**: Object mapping `state → frames[]` with transition logic
3. **Box drawing**: Unicode box chars (`┌─┐│└─┘`) with auto-width via `process.stdout.columns`
4. **256-color with fallback**: Detect capability, degrade gracefully to 16-color
5. **Synchronous rendering**: `process.stdout.write()` — no reconciliation needed
6. **Zero new dependencies**: Everything hand-crafted with ANSI escape codes and Unicode
