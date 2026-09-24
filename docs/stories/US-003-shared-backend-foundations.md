# US-003: Shared backend foundations

| | |
|---|---|
| **Status** | In Progress |
| **Epic** | E0 Project setup |
| **Priority** | Must |
| **Size** | M |
| **Milestone** | M0 |
| **PRD** | NFR-2, NFR-3, NFR-6 |
| **Depends on** | [US-001](./US-001-repository-and-tooling-baseline.md), [US-002](./US-002-automated-tests-and-ci.md) |

## User story

> **As** a developer, **I want** validated configuration, rate limiting, a scheduler-only guard and shared validation and date helpers, **so that** every feature slice can be built securely without repeating this code.

## Acceptance criteria

1. **Given** a missing or too-short `JWT_SECRET` or `CRON_SECRET`, **when** the server starts, **then** it refuses to start and names the variable.
2. **Given** the API behind one or more proxies, **when** `TRUST_PROXY_HOPS` is set, **then** rate limiting and `req.ip` use the visitor's address, not the proxy's.
3. **Given** an endpoint behind the cron guard, **when** a request has no secret, a wrong secret, an empty secret or one of a different length, **then** it gets `401 { message: "Not authorized" }`, and the correct secret is accepted.
4. **Given** request input, **when** a page is 0, a limit is 201, an id is 24 characters but not hex, or a date is `2026-02-30`, **then** validation rejects it with a 400.
5. **Given** the shared date helpers, **when** days are added or months are shifted across a month or year end, **then** the results are correct in UTC.

## Tasks

| ID | Task | Plan reference | Status |
|---|---|---|---|
| US-003-T1 | Add `REFRESH_TOKEN_TTL_DAYS`, `TRUST_PROXY_HOPS` and `CRON_SECRET` to the validated env, the test env and `.env.example`; use the hop count for `trust proxy` | [M0 Foundation](../plans/01-foundation.md), Task 3, step 3 | Done |
| US-003-T2 | Add the rate-limiter factory and the `auth`, `mail` and `internal` limiters, with a test | [M0 Foundation](../plans/01-foundation.md), Task 3, steps 1-2 | Done |
| US-003-T3 | Add the `requireCronSecret` guard with a test covering missing, wrong, empty and different-length secrets | [M0 Foundation](../plans/01-foundation.md), Task 4 | Done |
| US-003-T4 | Add the shared request schemas (id, pagination, calendar date, month) with tests | [M0 Foundation](../plans/01-foundation.md), Task 5, steps 1-2 | To do |
| US-003-T5 | Add the UTC calendar-date helpers with tests | [M0 Foundation](../plans/01-foundation.md), Task 5, steps 3-4 | To do |

## Out of scope

Feature endpoints.

## Notes and risks

A wrong hop count would put every visitor in one rate-limit bucket. It is verified against the real deployment in US-061.

## Definition of Done

The shared [Definition of Done](./README.md#definition-of-done) applies, plus every acceptance criterion demonstrated:

- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2
- [ ] Acceptance criterion 3
- [ ] Acceptance criterion 4
- [ ] Acceptance criterion 5
