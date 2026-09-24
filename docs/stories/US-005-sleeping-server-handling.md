# US-005: Friendly handling of a sleeping free server

| | |
|---|---|
| **Status** | In Progress |
| **Epic** | E0 Project setup |
| **Priority** | Must |
| **Size** | M |
| **Milestone** | M0 |
| **PRD** | UI-5 |
| **Depends on** | [US-004](./US-004-interface-shell.md) |

## User story

> **As** a user, **I want** the app to wait and retry while the free server wakes up, **so that** the first visit after a quiet period shows a short wait, not an error.

## Acceptance criteria

1. **Given** a GET request that gets 502, 503, 504 or no response at all, **when** the server is waking up, **then** the request is retried automatically, a "waking up the server" banner is shown, and the page recovers once the server answers.
2. **Given** a POST, PATCH or DELETE that fails with a gateway error, **when** it fails, **then** it is not retried automatically, so a request that may have been processed is never repeated.
3. **Given** a 4xx answer such as 404, **when** the request fails, **then** it is not retried.
4. **Given** the retries are used up, **when** the server still does not answer, **then** the original error is shown and the banner disappears.
5. **Given** the app starts, **when** it loads, **then** the backend is pinged first so it starts waking before the user acts.

## Tasks

| ID | Task | Plan reference | Status |
|---|---|---|---|
| US-005-T1 | Add the server-status store, the type augmentation, the cold-start retry interceptor (GET and HEAD only) and the warm-up call, with tests | [M0 Foundation](../plans/01-foundation.md), Task 10, steps 1-3 | Done |
| US-005-T2 | Add the waking-up banner and mount it in the root layout, with a test | [M0 Foundation](../plans/01-foundation.md), Task 10, step 4 | Done |
| US-005-T3 | Confirm session restore pings the backend first (delivered with US-011) | [M1 Auth](../plans/02-auth.md), Task 9 (`bootstrapSession`) | Done |
| US-005-T4 | Confirm on the real deployment that the first request after 20 minutes idle shows the banner and recovers | [M6 Deploy and pilot](../plans/07-deploy-pilot.md), Task 6, step 4 | To do |

## Out of scope

Keeping the server awake (optional runbook step).

## Notes and risks

Netlify's proxy gives up after 26 s while a cold Render start takes about a minute, so the first GET often answers 504 even though the backend is waking.

## Definition of Done

The shared [Definition of Done](./README.md#definition-of-done) applies, plus every acceptance criterion demonstrated:

- [x] Acceptance criterion 1
- [x] Acceptance criterion 2
- [x] Acceptance criterion 3
- [x] Acceptance criterion 4
- [ ] Acceptance criterion 5
