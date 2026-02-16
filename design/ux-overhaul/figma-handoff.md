# Figma Handoff Spec

## Current Constraint

Figma MCP is not configured in this Codex session yet, so this package provides implementation-ready mockup artboards and a deterministic frame/component spec for import/rebuild in Figma.

## Source Mockups

- `/Users/grayson/Desktop/Portfolio/design/ux-overhaul/mockups/portfolio-overhaul.html`
- `/Users/grayson/Desktop/Portfolio/design/ux-overhaul/mockups/blog-authoring-overhaul.html`
- `/Users/grayson/Desktop/Portfolio/design/ux-overhaul/mockups/shared.css`

## Frame Set

Create these desktop frames:
1. `A1 Home`
2. `A2 Work Experience`
3. `A3 Projects`
4. `A4 Blog List + Detail`
5. `B1 Blog Authoring Dashboard`
6. `B2 Blog Authoring Editor`

Create these mobile frames:
1. `M1 Home`
2. `M2 Projects`
3. `M3 Blog`
4. `M4 Authoring Editor`

## Component Library

Define reusable components (variants where applicable):
1. Top nav pill (`default`, `active`)
2. Status badge (`connected`, `testing`, `disconnected`, `draft`, `scheduled`, `published`)
3. Metric/stat card
4. Project card row
5. Blog post row
6. Tag chip
7. Section container
8. CTA button (`primary`, `secondary`)
9. Workflow lane card

## Token Set

Use values from:
- `/Users/grayson/Desktop/Portfolio/design/ux-overhaul/brand-system.md`

Minimum tokens to register:
1. Colors (`motor-blue`, `gm-electric`, `burnt-orange`, `sunset-amber`, neutrals)
2. Typography styles (`display`, `heading`, `body`, `caption`)
3. Radius (`12`, `18`, `26`)
4. Shadow (`panel`, `card`)
5. Spacing scale (`4`, `8`, `12`, `16`, `24`, `32`)

## QA Checklist

1. Verify all existing page sections are represented in redesigned layout.
2. Verify no content categories are removed.
3. Verify desktop and mobile navigation hierarchy.
4. Verify component variants map to current app states.
