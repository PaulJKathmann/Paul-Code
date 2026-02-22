# Design: Delightful UI — Phase 9

**Date**: 2026-02-21
**Status**: Approved

## Problem

Paul Code's terminal UI is functional but generic — colored output, braille spinner,
diffs, tool headers. It could be any CLI tool. There is no visual identity, no personality,
and no moments of delight.

## Goal

Transform Paul Code into a CLI agent that inspires delight through a living owl mascot
("Archie"), a cohesive purple/amber color palette, animated interactions, and rich
bordered output — all in pure ANSI with zero new dependencies.

## Design Decisions

### Mascot: Archie the Owl
- 6 emotional states (idle, thinking, working, happy, concerned, sleeping)
- 2-4 ASCII art frames per state, animated at 200ms intervals
- Cursor-repositioned in-place rendering (no scroll pollution)
- Full owl in startup/thinking, miniaturized `🦉` in prompt

### Startup: Gradient Banner
- Hand-crafted block-letter "PAUL CODE" with cyan→purple gradient
- Owl entrance animation (eyes opening)
- Random friendly greeting from pool of 8-10
- Status bar with model/context/help info
- Styled prompt: `🦉 › `

### Working: Bordered Tool Blocks
- Box-drawing borders around each tool execution
- Header with tool name + args, footer with timing + line count
- Visual timeline connecting sequential tool blocks
- Gradient-cycling spinner during API calls with elapsed timer

### Completion: Tasteful Celebration
- Brief sparkle animation on Archie (2-3 frames)
- Session summary box (tools used, time, files changed, tokens)
- Only after multi-tool interactions, not simple Q&A

### Color Palette
- Owl Purple (#8B5CF6/135): brand, borders, headers
- Warm Amber (#F59E0B/214): owl eyes, highlights
- Soft Cyan (#06B6D4/44): info, secondary
- Forest Green (#10B981/35): success
- Rose Red (#EF4444/196): errors
- Slate Dim (#64748B/245): muted text
- 256-color with 16-color fallback, NO_COLOR respected

### Architecture
- Zero new dependencies
- 5 new files: owl.ts, theme.ts, banner.ts, blocks.ts, animations.ts
- Pure `process.stdout.write()` + ANSI escape codes
- Simple setInterval animation engine with cursor repositioning

## Rejected Alternatives

- **Ink (React for CLI)**: Too many dependencies (~15), overkill for this use case
- **Blessed/blessed-contrib**: Full TUI framework — heavy, complex, unnecessary
- **Static mascot only**: Doesn't achieve "living" feel the user wants
- **Light dependencies (chalk, boxen, ora)**: Violates zero-dep constraint and the existing
  codebase already has hand-rolled equivalents

## References

- Claude Code: Status bar, permission UX, streaming markdown
- Warp: Block paradigm, rich rendering, modern aesthetic
- The user wants to go beyond both — animated mascot is the differentiator
