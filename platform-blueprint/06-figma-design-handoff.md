# 06. Figma + Design Handoff Library

## Existing Design Packages

### UX/UI Overhaul Package

- Root: `/Users/grayson/Desktop/Portfolio/design/ux-overhaul`
- Includes:
  - `README.md`
  - `brand-system.md`
  - `blog-authoring-improvements.md`
  - `figma-handoff.md`
  - HTML mockups under `mockups/`

### Email Notification UX Package

- Root: `/Users/grayson/Desktop/Portfolio/design/email-notifications`
- Includes:
  - `README.md`
  - `aws-email-architecture.md`
  - `security-compliance.md`
  - `figma-handoff.md`
  - HTML mockups under `mockups/`

## New Architecture FigJam Files

These capture the **frontend/backend/middleware/data** interactions for reuse in future projects:

- Platform architecture board: [Portfolio Platform Architecture](https://www.figma.com/online-whiteboard/create-diagram/2cf18970-4df0-4474-aed5-a647190da3b3?utm_source=other&utm_content=edit_in_figjam&oai_id=&request_id=8a0d7073-d88b-49ff-96b4-bcc5b82ae294)
- Publish + email automation board: [Blog Publish + Email Automation Flow](https://www.figma.com/online-whiteboard/create-diagram/e89331b0-3b0b-4d0c-8e37-1e9577eeecab?utm_source=other&utm_content=edit_in_figjam&oai_id=&request_id=18481ad8-414e-445e-aaf3-ed3d46532221)

## How To Reuse In New Projects

1. Duplicate frame sets and component tokens from the existing handoff docs.
2. Keep your page/content map constant while swapping brand tokens.
3. Preserve route-level information architecture before styling iteration.
4. Use architecture boards to align engineering + design before coding.

## Recommended Figma Files Per New Website

1. `Site Core UX` (public pages)
2. `Authoring Console UX`
3. `System Architecture` (FigJam)
4. `Content Schema + API Flows` (FigJam)
5. `Notification/Automation UX` (if email or scheduled publish exists)

