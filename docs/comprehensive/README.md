# Portfolio Platform Documentation Pack

Last updated: 2026-03-04

This folder is the central documentation pack for the Portfolio platform. It is organized from high-level architecture down to code-level detail.

## Included Markdown Documents

1. `/Users/grayson/Desktop/Portfolio/docs/comprehensive/01-project-system-visual-mockup.md`
2. `/Users/grayson/Desktop/Portfolio/docs/comprehensive/02-aws-architecture-visual-mockup.md`
3. `/Users/grayson/Desktop/Portfolio/docs/comprehensive/03-backend-service-interplay.md`
4. `/Users/grayson/Desktop/Portfolio/docs/comprehensive/04-code-deep-dive.md`
5. `/Users/grayson/Desktop/Portfolio/docs/comprehensive/05-reference-matrix.md`
6. `/Users/grayson/Desktop/Portfolio/docs/comprehensive/06-authoring-hotkeys-and-page-checklist.md`

## Included Word Documents

1. `/Users/grayson/Desktop/Portfolio/docs/comprehensive/word/portfolio-platform-comprehensive-documentation.docx`
2. `/Users/grayson/Desktop/Portfolio/docs/comprehensive/word/portfolio-platform-visual-mockups.docx`

## Reading Order

1. Start with `01` for overall architecture and visual context.
2. Continue with `02` for AWS topology and deployment paths.
3. Continue with `03` for backend service flows and data contracts.
4. Use `04` for file-level and module-level implementation detail.
5. Use `05` as the lookup index for routes, tables, queues, and CI/CD workflows.
6. Use `06` for blog-authoring keyboard shortcut standards and future-page implementation checklist.

## Scope

- Documents current implemented behavior in this repository.
- Includes route and service flow mapping for `portfolio-app`, `blog-authoring-gui`, and `redis-api-server`.
- Includes AWS deployment patterns currently used in GitHub Actions and runtime code.
- Includes extension guidance for future categories/content types and service expansion.

## Notes

- Mermaid diagrams in Markdown are intended as the primary visual mockups in GitHub.
- The Word documents mirror this content for offline review and sharing.

## Regenerate Word Documents

```bash
cd /Users/grayson/Desktop/Portfolio
. .venv-docs/bin/activate
python scripts/generate_comprehensive_docs_docx.py
```
