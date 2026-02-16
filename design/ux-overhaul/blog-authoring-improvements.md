# Blog Authoring UX Improvements

This plan improves drafting speed and editorial confidence without changing the existing Redis write model, metadata fields, or auth/session approach.

## Pain Points Observed

1. Drafting and metadata are in one long form, which increases vertical context switching.
2. Dashboard emphasizes cards but not author workflow states (drafting, refining, scheduled).
3. Editor has limited writing aids for structure, rhythm, and publish readiness.
4. Transaction log and settings are useful but hidden as secondary side actions.

## Proposed UX Changes

### 1) Dashboard as Pipeline

Keep existing post list functionality, but present it as columns:
- Draft
- Scheduled
- Published

Each card keeps current edit/delete actions and status data, but grouping improves triage.

### 2) Editor as 3-Pane Workspace

Left pane:
- Outline blocks
- Reusable templates/snippets

Center pane:
- Main rich-text editor (existing Quill-based editor)

Right pane:
- Metadata (tags/category/status/date)
- Featured image uploader
- Publish readiness checks

### 3) Drafting Accelerators

1. Command palette (`/`) for inserting common sections.
2. Template starts for recurring post formats (tutorial, project deep dive, weekly reflection).
3. Tag suggestions from existing tags in your dataset.
4. Live read-time and heading depth indicators.
5. Autosave indicator and restore draft prompt.

### 4) Publish Readiness Panel

Simple checks before save/publish:
- Title present
- Summary present
- Content length threshold
- At least one heading
- Optional featured image alt text prompt

## Content/Schema Compatibility

No data-model changes required for phase 1:
- Keep `title`, `summary`, `content`, `tags`, `publishDate`, `status`, `category`, image pairing via `ListItemID`.
- Keep existing create/update/delete API interactions.

## Suggested Rollout Sequence

1. Visual shell + dashboard regrouping.
2. Editor 3-pane layout with current controls.
3. Optional drafting accelerators and readiness checks.

## Extension: Email Notification Workflow

To align with scheduled/publish goals, add notification controls without changing core editing behavior:

1. Editor sidebar adds:
   - `Send email update` toggle
   - audience topic selector
   - optional subject/preheader override
2. Dashboard adds:
   - scheduled sends queue
   - delivery status snapshot (sent/bounced/complaints)
3. Publish logic updates:
   - `status=published`: send immediately (if enabled)
   - `status=scheduled`: create one-time scheduler job tied to `publishDate`

Detailed architecture and security controls live in:

- `/Users/grayson/Desktop/Portfolio/design/email-notifications/aws-email-architecture.md`
- `/Users/grayson/Desktop/Portfolio/design/email-notifications/security-compliance.md`
