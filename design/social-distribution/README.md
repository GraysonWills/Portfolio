# Social Distribution Studio Mockup

## Purpose

This package sketches a quiet social distribution layer for the blog authoring studio. The goal is to let a post announce itself across useful media-awareness channels without turning the studio into an engagement dashboard.

## Artifacts

- `brand-system.md`: scoped visual and interaction principles.
- `mockups/social-distribution-studio.html`: high-fidelity HTML/CSS mockup.
- `mockups/shared.css`: mockup styling.
- `figma-handoff.md`: frame and implementation notes for a future Figma pass.
- `approval-checklist.md`: review gate before production implementation.
- `blog-authoring-improvements.md`: current-system integration notes.

## Authoring App Placement

The production-facing shell for this concept now lives in the blog authoring studio at `/distribution`, not in the public portfolio app.

## Channel Set

Core requested channels:
- Facebook Page
- X / Twitter
- LinkedIn
- Instagram
- YouTube

Additional automation candidates:
- Threads
- Bluesky
- Mastodon
- Pinterest
- TikTok
- Reddit
- Medium
- Tumblr
- Discord
- Substack

## Product Constraint

The studio should store and display delivery state only. It should not fetch or surface likes, comments, replies, shares, views, or follower deltas.
