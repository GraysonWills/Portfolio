# Security Best Practices Report (Portfolio)

Date: 2026-02-15

## Executive Summary

The AWS deployment is in a good place from an infrastructure isolation standpoint (private S3 via CloudFront OAC, ECS behind ALB with TLS 1.3/1.2 policy, ElastiCache Redis in private subnets with TLS + AUTH). The primary security risks are now in **frontend code paths**:

1. **A Mailchimp API key is designed to be used from the browser**, which would expose a secret and also introduces critically vulnerable dependencies.
2. **Blog markdown rendering bypasses Angular’s HTML sanitization**, which can enable stored XSS if untrusted content reaches the blog body.

This report lists prioritized findings with evidence and fixes.

---

## Critical

### [C-1] Mailchimp API Key Used From Browser (Secret Exposure + Vulnerable Deps)

Severity: **Critical**

Location:
- `/Users/grayson/Desktop/Portfolio/portfolio-app/src/app/services/mailchimp.service.ts:23-53`
- `/Users/grayson/Desktop/Portfolio/portfolio-app/src/environments/environment.prod.ts:9-14`

Evidence:
- Frontend code sets an `Authorization` header with `apikey ${this.apiKey}` and calls the Mailchimp REST API directly from the browser:
  - `/Users/grayson/Desktop/Portfolio/portfolio-app/src/app/services/mailchimp.service.ts:23-53`

Impact:
- If you ever populate `environment.mailchimpApiKey`, it will be shipped to every visitor, enabling account abuse and list manipulation.
- `npm audit --omit=dev` currently reports **critical/high** vulnerabilities in production deps driven by this approach (`mailchimp-api-v3`, `request`, `form-data`, `tar`, etc.).

Fix (recommended):
- Remove `mailchimp-api-v3` from the Angular app and implement a server-side subscribe endpoint (e.g., on `redis-api-server`) that uses a secret stored in SSM/Secrets Manager.
- Alternative: use Mailchimp’s hosted embed form (no secret in-browser).

Mitigation (short-term):
- Ensure `environment.mailchimpApiKey` is never set in production builds.

---

### [C-2] Stored XSS Risk: Markdown Rendered as Trusted HTML

Severity: **Critical**

Location:
- `/Users/grayson/Desktop/Portfolio/portfolio-app/src/app/pages/blog/blog-detail/blog-detail.component.ts:126-130`
- `/Users/grayson/Desktop/Portfolio/portfolio-app/src/app/pages/blog/blog-detail/blog-detail.component.html:67-70`
- `/Users/grayson/Desktop/Portfolio/portfolio-app/src/app/pages/blog/blog-detail/blog-detail.component.html:109-112`

Evidence:
- Markdown is parsed to HTML (`marked.parse`) and then explicitly trusted via `bypassSecurityTrustHtml`, and bound into the DOM via `[innerHTML]`:
  - `/Users/grayson/Desktop/Portfolio/portfolio-app/src/app/pages/blog/blog-detail/blog-detail.component.ts:126-130`
  - `/Users/grayson/Desktop/Portfolio/portfolio-app/src/app/pages/blog/blog-detail/blog-detail.component.html:67-70`

Impact:
- If any untrusted content can reach blog body blocks in Redis (including via account compromise, admin tooling, or future multi-author scenarios), this can become **stored XSS** on the public portfolio site.

Fix (recommended):
- Remove `bypassSecurityTrustHtml`.
- Sanitize the HTML produced by `marked` using a well-maintained sanitizer (e.g., DOMPurify) before binding, or render markdown to safe text-only output.

Mitigation:
- Defense-in-depth at the edge: add restrictive security headers (CSP, frame-ancestors, etc.) via CloudFront response headers policy.

---

## High

### [H-1] Missing Security Headers on Static Sites (Edge)

Severity: **High**

Location:
- CloudFront distributions for:
  - `https://www.grayson-wills.com`
  - `https://d39s45clv1oor3.cloudfront.net`

Evidence (runtime):
- `curl -I https://www.grayson-wills.com/` and `curl -I https://d39s45clv1oor3.cloudfront.net/` currently do **not** include headers like:
  - `Content-Security-Policy`
  - `X-Frame-Options`
  - `X-Content-Type-Options`
  - `Referrer-Policy`

Impact:
- Increases susceptibility to clickjacking and reduces defense-in-depth against XSS and content-type sniffing issues.

Fix (recommended):
- Attach a CloudFront **Response Headers Policy** to both distributions to set baseline security headers.
- If you want CSP, start in **Report-Only** mode first to avoid breaking Angular’s runtime style injection.

---

## Medium

### [M-1] Blog Authoring Tokens Stored in localStorage

Severity: **Medium**

Location:
- `/Users/grayson/Desktop/Portfolio/blog-authoring-gui/src/app/services/auth.service.ts:11-17`
- `/Users/grayson/Desktop/Portfolio/blog-authoring-gui/src/app/services/auth.service.ts:170-172`

Evidence:
- ID/access/refresh tokens are persisted in `localStorage`.

Impact:
- If any XSS occurs in the blog authoring origin, an attacker can steal tokens and perform privileged write operations against the Redis API.

Fix (recommended):
- Prefer in-memory storage with short-lived tokens, or switch to HttpOnly cookies via a backend-for-frontend if you later make this broadly accessible.

---

### [M-2] Public /api/admin Routes (If Keys Are Ever Configured)

Severity: **Medium**

Location:
- `/Users/grayson/Desktop/Portfolio/redis-api-server/src/app.js:116-117`
- `/Users/grayson/Desktop/Portfolio/redis-api-server/src/routes/admin.js:15-55`

Evidence:
- `/api/admin/*` endpoints are mounted without authentication and will call Redis Cloud APIs if `REDIS_CLOUD_*` env vars are set.

Impact:
- If Redis Cloud API keys are ever configured in the runtime environment, these endpoints could leak infrastructure metadata to unauthenticated callers.

Fix (recommended):
- Gate `/api/admin/*` behind `requireAuth` or remove/disable in production builds.

---

## Low

### [L-1] Dependency Vulnerabilities (Non-blocking but Track)

Severity: **Low** (for the non-critical projects)

Evidence:
- `blog-authoring-gui`: 1 low finding (quill) in `npm audit --omit=dev`.
- `redis-api-server`: 1 low finding (qs) in `npm audit --omit=dev`.

Fix:
- Evaluate upgrades when convenient; prioritize runtime and exposure.

---

## Deployment / Infra Checks (What’s Working)

- `api.grayson-wills.com`:
  - ALB redirects 80 -> 443; TLS policy `ELBSecurityPolicy-TLS13-1-2-2021-06`.
  - ECS service healthy; ElastiCache is private + TLS + AUTH + at-rest encryption.
- Static sites:
  - Both S3 buckets are private with PublicAccessBlock enabled and CloudFront OAC read-only access.
  - Direct S3 object access returns 403 (expected).
- CI/CD:
  - Production smoke tests are now scriptable via `scripts/smoke_prod.sh`.

