# US-013: Change my password and edit my profile

| | |
|---|---|
| **Status** | Ready |
| **Epic** | E1 Authentication |
| **Priority** | Must |
| **Size** | S |
| **Milestone** | M1 |
| **PRD** | AUTH-10, AUTH-11, ACC-3 |
| **Depends on** | [US-011](./US-011-log-in-stay-logged-in-log-out.md), [US-004](./US-004-interface-shell.md) |

## User story

> **As** a logged-in user, **I want** to change my password and my name from a Settings page, **so that** I can keep my account secure and correct.

## Acceptance criteria

1. **Given** I am logged in, **when** I change my password with the correct current one, **then** it succeeds, my other devices are signed out and this one stays signed in.
2. **Given** I enter a wrong current password, **when** I submit, **then** I see "Current password is incorrect" and stay logged in.
3. **Given** a short new password or a confirmation that does not match, **when** I submit, **then** I see an inline error and nothing is sent.
4. **Given** I change my name, **when** I save, **then** the name in the top bar updates without a reload; my email is shown read-only.
5. **Given** the Settings page, **when** I open it, **then** it groups profile, password, appearance, currency, data export and account deletion, with deletion in a separate danger zone.

## Tasks

| ID | Task | Plan reference | Status |
|---|---|---|---|
| US-013-T1 | Add change-password (403 for a wrong current password, other sessions revoked, new session issued) and `PATCH /auth/me` (name only) with tests | [M1 Auth](../plans/02-auth.md), Task 6 (change password, profile) | To do |
| US-013-T2 | Add the Profile and Password sections with tests | [M5 Dashboard and account](../plans/06-dashboard-account.md), Task 6 | To do |
| US-013-T3 | Compose the Settings page, its route and the navigation entry | [M5 Dashboard and account](../plans/06-dashboard-account.md), Task 7, step 3 | To do |

## Out of scope

Changing email or currency here (currency is US-054).

## Definition of Done

The shared [Definition of Done](./README.md#definition-of-done) applies, plus every acceptance criterion demonstrated:

- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2
- [ ] Acceptance criterion 3
- [ ] Acceptance criterion 4
- [ ] Acceptance criterion 5
