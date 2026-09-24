# US-012: Reset a forgotten password

| | |
|---|---|
| **Status** | In Review |
| **Epic** | E1 Authentication |
| **Priority** | Must |
| **Size** | M |
| **Milestone** | M1 |
| **PRD** | AUTH-9, AUTH-13 |
| **Depends on** | [US-010](./US-010-register-with-email-verification.md) |

## User story

> **As** a user who forgot their password, **I want** to reset it by email, **so that** I can get back into my account without asking anyone.

## Acceptance criteria

1. **Given** any email address, **when** I ask for a reset, **then** I always see the same message, whether or not an account exists, and only a verified account receives an email.
2. **Given** the reset email, **when** I open its link within 15 minutes, **then** I can choose a new password, the link works once, and the token is removed from the address bar.
3. **Given** I set a new password, **when** the reset succeeds, **then** the old password stops working and every session I had is signed out.
4. **Given** an expired, used or unknown link, or an email-verification link, **when** I try to use it, **then** it is refused with a clear message and a way to request a new link.
5. **Given** a weak new password, **when** I submit it, **then** it is rejected and the link is not used up.

## Tasks

| ID | Task | Plan reference | Status |
|---|---|---|---|
| US-012-T1 | Add forgot-password and reset-password (hashed single-use 15-minute token, all sessions revoked) with tests | [M1 Auth](../plans/02-auth.md), Task 6 (forgot and reset) | Done |
| US-012-T2 | Add the forgot-password and reset-password pages (token captured once and stripped from the URL) with tests | [M1 Auth](../plans/02-auth.md), Task 11 (forgot and reset pages) | Done |

## Out of scope

Changing the email address.

## Notes and risks

A wrong current password on change-password answers 403, not 401, because the client treats 401 as an expired session.

## Definition of Done

The shared [Definition of Done](./README.md#definition-of-done) applies, plus every acceptance criterion demonstrated:

- [x] Acceptance criterion 1
- [x] Acceptance criterion 2
- [x] Acceptance criterion 3
- [x] Acceptance criterion 4
- [x] Acceptance criterion 5
