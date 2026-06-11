# Brand System: Quiet Signal

## Visual Positioning

Quiet Signal extends the existing Kinetic Atlas direction into a calmer, distribution-focused surface. It should feel like a publishing console, not a social media dashboard.

## Principles

1. Delivery over reaction.
2. Platform awareness without platform obsession.
3. Dense enough for repeated use.
4. Clear failure recovery without engagement metrics.
5. Draft first, automate second.

## Color Tokens

Core:
- Ink: `#14171f`
- Slate: `#465162`
- Paper: `#f6f8fb`
- Panel: `#ffffff`
- Line: `#dde4ee`

Signals:
- Action Blue: `#1769d1`
- Publish Green: `#26835f`
- Caution Amber: `#bc6a10`
- Issue Red: `#b42318`
- Creative Pink: `#bd3c73`
- Network Teal: `#087f8c`

Platform accent colors should be small strokes, marks, and status chips only. The screen should not become a collage of social-brand colors.

## Typography

- Headings: `Space Grotesk`
- UI/body: `IBM Plex Sans`

## Components

- Platform cards: compact, 8px radius, platform mark, auth state, capability label, and toggle.
- Caption editor: one primary text area with platform-specific variants in tabs/cards.
- Queue table: status-first rows with timestamps, platform, post title, and retry action.
- Quiet mode banner: persistent state indicator, not an explanatory essay.

## Accessibility

- All controls need text labels.
- Statuses cannot rely on color alone.
- Long platform names must wrap without resizing controls.
- The queue should remain usable on mobile with stacked rows.
