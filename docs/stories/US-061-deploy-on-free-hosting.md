# US-061: Deploy on free hosting

| | |
|---|---|
| **Status** | Ready |
| **Epic** | E6 Deployment and pilot |
| **Priority** | Must |
| **Size** | L |
| **Milestone** | M6 |
| **PRD** | Section 6.4, Section 6.5, S4 |
| **Depends on** | [US-060](./US-060-production-hardening.md), [US-062](./US-062-operate-and-back-up.md) |

## User story

> **As** the operator, **I want** the app running on Netlify, Render, Atlas, Brevo and GitHub Actions at no cost, **so that** the pilot users can use it from the internet.

## Acceptance criteria

1. **Given** the repository, **when** I read the deploy files, **then** `render.yaml` describes a free Node web service and `netlify.toml` proxies `/api/*` to it before the app fallback, with security headers and a script-blocking content policy, guarded by a test.
2. **Given** a visitor's browser, **when** it uses the site, **then** it only talks to the Netlify origin, so the refresh cookie is first-party and a reload keeps them logged in.
3. **Given** two visitors on different networks, **when** they use the site, **then** the backend logs show two different client addresses, so rate limiting is per visitor (a blocking check).
4. **Given** the deployed site, **when** I run the smoke tests, **then** registration, email, login, the board, finance, bills, export, rate limiting and the cookie and storage checks all pass.
5. **Given** the reminder workflow, **when** I run it by hand, **then** the email arrives once, and a second run sends nothing.
6. **Given** the free tiers, **when** a month passes, **then** usage stays within every provider's limits.

## Tasks

| ID | Task | Plan reference | Status |
|---|---|---|---|
| US-061-T1 | Add `render.yaml`, `netlify.toml` and the guard test, and prove the frontend build has no inline scripts | [M6 Deploy and pilot](../plans/07-deploy-pilot.md), Task 3 | To do |
| US-061-T2 | Write the README, the runbook and the pilot guide | [M6 Deploy and pilot](../plans/07-deploy-pilot.md), Task 4 | To do |
| US-061-T3 | Merge the code, create the accounts and services in the runbook order, and check the health endpoint | [M6 Deploy and pilot](../plans/07-deploy-pilot.md), Task 5 | To do |
| US-061-T4 | Fix the Render hostname in both files if it differs, and confirm login survives a reload through the proxy | [M6 Deploy and pilot](../plans/07-deploy-pilot.md), Task 5, steps 4-5 | To do |
| US-061-T5 | Verify the visitor's address and set `TRUST_PROXY_HOPS` (blocking) | [M6 Deploy and pilot](../plans/07-deploy-pilot.md), Task 6, step 1 | To do |
| US-061-T6 | Run every smoke test on the deployed site | [M6 Deploy and pilot](../plans/07-deploy-pilot.md), Task 6, step 2 | To do |

## Out of scope

A custom domain and paid tiers.

## Notes and risks

Free-tier limits were verified on 2026-09-24 and are recorded in the runbook. Render's free tier blocks SMTP ports 25, 465 and 587, so Brevo is used on port 2525.

## Definition of Done

The shared [Definition of Done](./README.md#definition-of-done) applies, plus every acceptance criterion demonstrated:

- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2
- [ ] Acceptance criterion 3
- [ ] Acceptance criterion 4
- [ ] Acceptance criterion 5
- [ ] Acceptance criterion 6
