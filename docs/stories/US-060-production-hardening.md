# US-060: Production hardening

| | |
|---|---|
| **Status** | Ready |
| **Epic** | E6 Deployment and pilot |
| **Priority** | Must |
| **Size** | M |
| **Milestone** | M6 |
| **PRD** | NFR-2, NFR-3, NFR-9 |
| **Depends on** | [US-041](./US-041-email-reminders-before-bills-are-due.md), [US-052](./US-052-delete-my-account.md) |

## User story

> **As** the operator, **I want** the API hardened for the public internet, **so that** a real user's data and credentials are protected.

## Acceptance criteria

1. **Given** a page on another origin, **when** it calls the API, **then** CORS refuses it, while the configured client origin is accepted even if `CLIENT_URL` had a trailing slash or path.
2. **Given** the mail provider, **when** the app runs in production, **then** the connection must upgrade to TLS before credentials are sent.
3. **Given** an oversized JSON body, **when** it is posted, **then** the answer is `413 { message }`, not a 500, and malformed JSON still answers 400.
4. **Given** any response, **when** I inspect the headers, **then** helmet's headers are present and `X-Powered-By` is absent.
5. **Given** a request, **when** it is logged, **then** the log line carries the resolved client address, and never a token or cookie.
6. **Given** the operator, **when** wants active-user counts, **then** refresh tokens record when they were issued.

## Tasks

| ID | Task | Plan reference | Status |
|---|---|---|---|
| US-060-T1 | Add the app-level tests and fix the CORS origin, request logging and 413 mapping | [M6 Deploy and pilot](../plans/07-deploy-pilot.md), Task 1, steps 1-2 | To do |
| US-060-T2 | Require TLS for the mailer in production and record the issue time of refresh tokens, with tests | [M6 Deploy and pilot](../plans/07-deploy-pilot.md), Task 1, step 3 | To do |
| US-060-T3 | Run all checks and commit | [M6 Deploy and pilot](../plans/07-deploy-pilot.md), Task 1, step 4 | To do |

## Out of scope

A web application firewall and DDoS protection.

## Notes and risks

A 200-row import batch with 200-character notes is about 70 KB, under the 100 KB body limit; the import dialog sends 200 rows per batch (US-033).

## Definition of Done

The shared [Definition of Done](./README.md#definition-of-done) applies, plus every acceptance criterion demonstrated:

- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2
- [ ] Acceptance criterion 3
- [ ] Acceptance criterion 4
- [ ] Acceptance criterion 5
- [ ] Acceptance criterion 6
