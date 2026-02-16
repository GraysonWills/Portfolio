# Figma Handoff: Email Subscription + Notification Scheduling

## Source Mockups

- `/Users/grayson/Desktop/Portfolio/design/email-notifications/mockups/portfolio-subscription-update.html`
- `/Users/grayson/Desktop/Portfolio/design/email-notifications/mockups/blog-authoring-notifications-update.html`
- `/Users/grayson/Desktop/Portfolio/design/email-notifications/mockups/shared.css`

## Required Frames

Desktop:
1. `N1 Portfolio Blog + Subscribe Card`
2. `N2 Subscription Preferences / Unsubscribe`
3. `N3 Blog Authoring Editor Notification Panel`
4. `N4 Blog Authoring Scheduled Sends Dashboard`

Mobile:
1. `N5 Blog Subscribe Card (mobile)`
2. `N6 Preferences Center (mobile)`
3. `N7 Editor Notification Controls (mobile)`

## Components to Define

1. Subscribe card
2. Topic checkbox group
3. Frequency selector (`Instant`, `Weekly digest`)
4. Unsubscribe confirmation banner
5. Notification toggle row
6. Schedule queue row with status badge
7. Delivery metrics card (sent, bounced, complained)

## Token Mapping

Use and extend the existing Kinetic Atlas tokens:

1. Colors:
   - `motor-blue`, `gm-electric`, `burnt-orange`, `sunset-amber`, neutral scale
2. Typography:
   - `Space Grotesk` headings
   - `IBM Plex Sans` body
3. Radius:
   - `12`, `18`, `26`
4. Shadows:
   - panel + card
5. Spacing:
   - 4/8/12/16/24/32

## Functional Guardrails

1. Keep current routes and page content hierarchy.
2. Add notification controls without removing existing save/publish controls.
3. Keep status values aligned with current metadata (`draft|scheduled|published`).
4. Preserve accessibility: focus states, contrast, keyboard navigation.
