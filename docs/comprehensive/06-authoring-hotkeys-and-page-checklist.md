# Authoring Hotkeys And New-Page Checklist

Last updated: 2026-03-04

## Purpose

This document defines the required keyboard shortcut baseline for the blog authoring app and the mandatory implementation checklist for any new route/page.

## Current Hotkey Map

Global:
- `Cmd/Ctrl + Alt + /` -> Show/hide shortcuts help
- `Cmd/Ctrl + Alt + 1` -> Dashboard
- `Cmd/Ctrl + Alt + 2` -> Content Studio
- `Cmd/Ctrl + Alt + 3` -> Subscribers
- `Cmd/Ctrl + Alt + 4` -> Collections
- `Esc` -> Close shortcuts dialog

Dashboard:
- `Cmd/Ctrl + Alt + N` -> Create new blog post
- `Cmd/Ctrl + Alt + R` -> Refresh blog posts
- `Cmd/Ctrl + Alt + T` -> Toggle transaction log

Content Studio:
- `Cmd/Ctrl + Alt + N` -> Create new content item
- `Cmd/Ctrl + Alt + R` -> Refresh content list
- `Cmd/Ctrl + Alt + P` -> Preview selected page

Subscribers:
- `Cmd/Ctrl + Alt + R` -> Refresh subscribers
- `Cmd/Ctrl + Alt + E` -> Focus add-email field
- `Cmd/Ctrl + Alt + A` -> Add subscriber

Collections:
- `Cmd/Ctrl + Alt + N` -> Create new entry
- `Cmd/Ctrl + Alt + R` -> Refresh categories/entries
- `Cmd/Ctrl + Alt + K` -> Focus new-category input

## Required New-Page Checklist

When adding a new route/page to `blog-authoring-gui`, complete all steps below:

1. Add context enum value:
   - File: `/Users/grayson/Desktop/Portfolio/blog-authoring-gui/src/app/services/hotkeys.service.ts`
   - Add new context key in `HotkeyContext`.

2. Route context from URL:
   - File: `/Users/grayson/Desktop/Portfolio/blog-authoring-gui/src/app/app.component.ts`
   - Update `resolveContextFromUrl()` with the new route prefix.

3. Register page shortcuts:
   - File: page component (`/pages/.../*.component.ts`)
   - Use `hotkeys.register('<context>', [...])` in `registerHotkeys()`.
   - Store cleanup function and call it in `ngOnDestroy()`.

4. Keep baseline consistency:
   - Include `Cmd/Ctrl + Alt + R` refresh if the page loads data.
   - Include `Cmd/Ctrl + Alt + N` create action where meaningful.
   - Add one page-specific focus/action shortcut (`E`, `K`, `P`, etc.).

5. Input safety:
   - Set `allowInInputs: true` only for actions safe while typing.
   - Keep destructive shortcuts disabled while focused in editable fields unless explicitly confirmed.

6. UX verification:
   - Open hotkeys dialog with `Cmd/Ctrl + Alt + /`.
   - Confirm new page shortcuts appear under page scope.
   - Confirm `Esc` closes the dialog.

## Reserved/Preferred Patterns

- Global navigation: `Cmd/Ctrl + Alt + 1..9`
- Create/new: `Cmd/Ctrl + Alt + N`
- Refresh: `Cmd/Ctrl + Alt + R`
- Focus key field: `Cmd/Ctrl + Alt + E` or `Cmd/Ctrl + Alt + K`
- Open preview: `Cmd/Ctrl + Alt + P`

Avoid conflicts with common browser/system shortcuts and avoid using `Cmd/Ctrl + S` unless behavior is consistently implemented across all editor forms.
