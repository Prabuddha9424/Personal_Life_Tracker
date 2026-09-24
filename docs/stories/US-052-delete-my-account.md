# US-052: Delete my account

| | |
|---|---|
| **Status** | Ready |
| **Epic** | E5 Dashboard and account |
| **Priority** | Must |
| **Size** | M |
| **Milestone** | M5 |
| **PRD** | ACC-2 |
| **Depends on** | [US-013](./US-013-change-password-and-profile.md), [US-021](./US-021-move-tasks-on-the-board.md), [US-030](./US-030-record-income-and-expenses.md), [US-040](./US-040-track-recurring-bills.md) |

## User story

> **As** a user, **I want** to permanently delete my account and all my data, **so that** I stay in control of my data when I stop using the app.

## Acceptance criteria

1. **Given** Settings, **when** I open "Delete my account", **then** I am warned clearly that it is permanent and asked for my password.
2. **Given** I enter a wrong or empty password, **when** I confirm, **then** I see an error, nothing is deleted and I stay logged in.
3. **Given** I enter the right password, **when** I confirm, **then** my tasks, transactions, categories, bills, tokens and profile are removed, the cookie is cleared, and I am sent to the login page.
4. **Given** another user exists, **when** my account is deleted, **then** their data is untouched, and a new sign-up with my old email starts empty.
5. **Given** an old access token of the deleted account, **when** it is used, **then** it can no longer read the profile or create a transaction or a bill.
6. **Given** the deletion fails half way, **when** I log in again, **then** I still can, because the user is deleted last, and I can retry.

## Tasks

| ID | Task | Plan reference | Status |
|---|---|---|---|
| US-052-T1 | Add password-confirmed account deletion (tenant data first, user last, cookie cleared, rate limited) with end-to-end tests | [M5 Dashboard and account](../plans/06-dashboard-account.md), Task 3 (delete) | To do |
| US-052-T2 | Add the delete-account section and dialog with tests (password required, wrong password keeps the session) | [M5 Dashboard and account](../plans/06-dashboard-account.md), Task 7 (delete section) | To do |
| US-052-T3 | Walk deletion in a real browser with two users | [M5 Dashboard and account](../plans/06-dashboard-account.md), Task 8 | To do |

## Out of scope

A grace period or undo.

## Notes and risks

Accepted risk: the deleted user's access token stays valid for up to 15 minutes for endpoints that do not look the user up (for example creating a task); the frontend clears the session immediately.

## Definition of Done

The shared [Definition of Done](./README.md#definition-of-done) applies, plus every acceptance criterion demonstrated:

- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2
- [ ] Acceptance criterion 3
- [ ] Acceptance criterion 4
- [ ] Acceptance criterion 5
- [ ] Acceptance criterion 6
