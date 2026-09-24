# US-010: Register with email verification

| | |
|---|---|
| **Status** | In Review |
| **Epic** | E1 Authentication |
| **Priority** | Must |
| **Size** | L |
| **Milestone** | M1 |
| **PRD** | AUTH-1, AUTH-2, AUTH-3, AUTH-4, AUTH-13 |
| **Depends on** | [US-003](./US-003-shared-backend-foundations.md), [US-004](./US-004-interface-shell.md), [US-005](./US-005-sleeping-server-handling.md) |

## User story

> **As** a visitor, **I want** to create an account and verify my email address, **so that** I can use the app and my reminders reach the right person.

## Acceptance criteria

1. **Given** a valid name, email, password of at least 10 characters that is not a common one, and a currency, **when** I register, **then** I see "check your inbox", receive a verification email, and cannot log in until I verify.
2. **Given** the emailed link, **when** I open it, **then** my address is verified once, the token disappears from the address bar, and I can log in; reusing the link or opening one older than 24 hours fails with a clear message and offers a new link.
3. **Given** an email address that already has an account, **when** someone registers with it, **then** the response is identical to a new registration and only the owner receives an email saying an account exists.
4. **Given** a weak or common password, an invalid email, or an unsupported currency, **when** I submit the form, **then** I see inline errors and nothing is created.
5. **Given** the mail provider is down, **when** I register, **then** the answer is the same as normal, the account exists, and I can ask for the email again.
6. **Given** many sign-up or resend requests from one network, **when** the limit is passed, **then** further requests are refused with 429.

## Tasks

| ID | Task | Plan reference | Status |
|---|---|---|---|
| US-010-T1 | Add the token, cookie and password-policy utilities with tests | [M1 Auth](../plans/02-auth.md), Task 1 | Done |
| US-010-T2 | Add the user, email-token and refresh-token models (password hashed in a `pre('save')` hook at cost 12, hidden by default) | [M1 Auth](../plans/02-auth.md), Task 2 | Done |
| US-010-T3 | Add registration, email verification and resend (generic answers, hashed single-use tokens, mail failures swallowed) with tests | [M1 Auth](../plans/02-auth.md), Task 3 | Done |
| US-010-T4 | Add the shared auth building blocks and the login and register pages | [M1 Auth](../plans/02-auth.md), Task 10 (register page, layout, schemas) | Done |
| US-010-T5 | Add the verification page (token captured once and removed from the URL) and the resend form, with tests including React StrictMode | [M1 Auth](../plans/02-auth.md), Task 11 (verify page, resend form) | Done |
| US-010-T6 | Walk sign-up and verification in a real browser with a mail catcher | [M1 Auth](../plans/02-auth.md), Task 13 | To do |

## Out of scope

Social login and multi-factor authentication.

## Notes and risks

Register, resend and forgot-password do slightly more work for existing accounts, which a patient attacker could time; the 5-per-hour mail limit makes bulk enumeration impractical. `register` is timing-equalised.

## Definition of Done

The shared [Definition of Done](./README.md#definition-of-done) applies, plus every acceptance criterion demonstrated:

- [x] Acceptance criterion 1
- [x] Acceptance criterion 2
- [x] Acceptance criterion 3
- [x] Acceptance criterion 4
- [x] Acceptance criterion 5
- [ ] Acceptance criterion 6
