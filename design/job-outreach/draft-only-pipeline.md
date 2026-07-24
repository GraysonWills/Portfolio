# Draft-Only Job Outreach Pipeline

## Decision

Build the job-search workflow as a staged pipeline with small, testable workers.
The first production policy ends at a Gmail draft and a recoverable update to
the existing Excel tracker. It does not send email, submit applications, scrape
LinkedIn, or fabricate contact details.

The live tracker is:

- OneDrive: `Personal/Documents/Copy of Job Search Organization Template.xlsx`
- Worksheet: `Job Applications`
- Current data columns: rank, company, title, remote, location, date applied,
  job link, salary low/high, asked for, contacted back, and interview data
- Research notes: existing cell comments

The workbook's drive and item identifiers are runtime configuration. They do
not belong in source code.

## User Profile and Hard Filters

### Supported experience

- Applied AI/ML and computer vision
- AI agents and LLM workflows
- Full-stack and platform engineering
- Data engineering, data analysis, and BI engineering
- Technical leadership, mentoring, and enablement

### Unsupported claims

- Formal people-management experience
- Skills, credentials, clearances, or domain experience absent from the resume

### Job filters

- United States remote; any US time zone
- Advertised salary floor of at least USD 100,000
- AI/ML, full-stack, generalist/wildcard, data analyst, BI engineer, and
  adjacent roles
- Prefer roles that do not require a security clearance and are not primarily
  defense work
- A missing salary is not silently treated as meeting the floor. It can enter a
  separate `salary_unknown` review lane, but it cannot enter the automatic
  outreach lane.

## Pipeline Topology

These are workers with bounded contracts, not free-running agents:

1. **Source adapter** — reads official ATS feeds and explicitly supplied pilot
   job URLs, normalizes job records, and retains source URLs.
2. **Eligibility filter** — applies remote, geography, compensation,
   clearance, defense, freshness, and duplicate rules.
3. **Fit scorer** — compares the normalized job against resume evidence and
   emits a score with supporting and missing evidence.
4. **Company researcher** — produces a source-backed briefing on product,
   customers, mission, strategy, recent activity, and relevant engineering
   context.
5. **Contact resolver** — finds a plausible hiring manager or recruiter through
   permitted sources and records provenance, role relevance, verification
   status, and confidence. It never guesses an address.
6. **Draft composer** — writes a concise cold-outreach email in Grayson's voice,
   grounded only in verified resume, job, company, and contact evidence.
7. **Tracker synchronizer** — appends or updates the Excel row with an
   optimistic-concurrency check and preserves the original workbook.
8. **Evaluator** — scores job fit, evidence grounding, contact confidence,
   voice similarity, usefulness, and safety before a human sees the draft.

The orchestrator advances a candidate only when the prior stage's contract
passes. Each stage stores an immutable input/output artifact and provenance.

## State Machine

`discovered` → `eligible` → `researched` → `contact_verified` →
`draft_ready` → `human_reviewed`

Terminal or review states:

- `rejected_policy`
- `duplicate`
- `salary_unknown`
- `insufficient_fit`
- `contact_unverified`
- `research_incomplete`
- `draft_rejected`
- `stale_or_closed`

The first release has no transition from `human_reviewed` to `sent`.

## Source Policy

Preferred job sources:

1. Official ATS endpoints such as Greenhouse, Lever, and Ashby.
2. Explicitly supplied job URLs or normalized seed records for bounded pilots.
3. Direct company career pages where automated access is permitted.

LinkedIn is not scraped or browser-automated. The currently connected LinkedIn
grant is useful for Grayson's own identity and posting, not recruiter search.
Future LinkedIn use must remain inside official, explicitly granted APIs.

## Contact Policy

Every contact candidate must contain:

- name and current title
- company
- source URL and retrieval time
- relationship to the role
- email source
- email verification result, if available
- confidence: `high`, `medium`, or `low`

Only a public, directly supplied, or provider-verified email can produce a
draft. A pattern-derived address is a research lead, not a sendable contact.

Contact enrichment remains a separate provider interface so a future vendor can
be added without changing the rest of the pipeline.

## Email Policy

Voice calibration uses sent Gmail messages except messages whose subject is
exactly `thing` (case-insensitive). Private messages stay in the private
environment; evaluation fixtures store derived style attributes or redacted
examples, not unrelated personal content.

Draft requirements:

- one specific reason for contacting this person
- one to three resume-backed fit points
- one company- or role-specific reason for interest
- one clear ask
- at most two high-value questions
- no inflated experience, invented relationship, fake urgency, or tracking
  pixel
- concise plain text by default
- the configured resume attached

The Gmail integration exposes search/read and draft creation. It intentionally
does not expose a send operation in this release.

## OneDrive Personal Workbook Strategy

Microsoft Graph's workbook/range APIs are not officially supported for
consumer OneDrive accounts. The integration therefore uses the supported file
API:

1. Read item metadata and capture its ETag.
2. Download the `.xlsx` bytes.
3. Update the workbook outside Graph while preserving styles and comments.
4. Create an upload session with `If-Match: <captured ETag>`.
5. Replace the item only if the ETag still matches.
6. Treat HTTP 412 as a conflict requiring a fresh read and reconciliation.

The Graph MCP surface transfers a bounded workbook payload. It does not parse
or rewrite Excel itself. This keeps the cloud connector simple and lets the
workflow use a workbook-aware library with round-trip regression fixtures.
OneDrive version history provides an additional recovery layer.

## Evaluation Plan

Use task-specific model aliases rather than model names in workflow code.
Evaluate candidates separately for:

- job/resume fit classification
- evidence extraction
- company research synthesis
- contact relevance classification
- cold-email drafting

The private golden set starts with Grayson's review actions:

- accepted unchanged
- accepted after edits, with the before/after delta
- rejected with a reason
- contact reply outcome

Public data can supplement fit scoring. Candidate Hugging Face datasets include
`med2425/resume-job-fit-merged-v1`, `netsol/resume-score-details`, and
`renhehuang/resume-job-fairness-eval`. Public cold-email corpora are treated as
weak auxiliary data because many are synthetic or marketing-oriented.

Primary metrics:

- hard-filter precision
- duplicate rate
- grounded-claim precision
- contact verification precision
- human draft acceptance rate
- median edit distance after human review
- positive reply and interview-conversion rates
- policy violations (target: zero)

The pilot should begin with five to ten drafts, reviewed individually, before
expanding daily volume.

## Secret and Data Handling

- API keys and OAuth secrets live in AWS-managed secrets or encrypted provider
  records.
- Never paste keys into chat, Git, Notion, workbook notes, logs, or prompts.
- Gmail and Microsoft access tokens are encrypted at rest.
- Tool output excludes raw tokens and unrelated private message bodies.
- Logs store stable hashes, record IDs, and bounded metadata rather than full
  email or workbook contents.
