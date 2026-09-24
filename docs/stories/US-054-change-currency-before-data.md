# US-054: Change my currency before I have data

| | |
|---|---|
| **Status** | Ready |
| **Epic** | E5 Dashboard and account |
| **Priority** | Could |
| **Size** | S |
| **Milestone** | M5 |
| **PRD** | AUTH-12, ACC-4 |
| **Depends on** | [US-013](./US-013-change-password-and-profile.md), [US-030](./US-030-record-income-and-expenses.md), [US-040](./US-040-track-recurring-bills.md) |

## User story

> **As** a new user who picked the wrong currency, **I want** to change my currency while I have no transactions or bills, **so that** all my amounts are in the right currency from the start.

## Acceptance criteria

1. **Given** an account with no transactions and no bills (tasks do not count), **when** I change the currency in Settings, **then** it changes, the top bar and later amounts use it.
2. **Given** an account with any transaction or bill, **when** I try to change it, **then** it is refused with an explanation, because stored amounts would change meaning, and the currency is unchanged.
3. **Given** an unsupported code, **when** I submit, **then** it is refused.
4. **Given** another user has data, **when** I change mine, **then** it is not blocked by their data.

## Tasks

| ID | Task | Plan reference | Status |
|---|---|---|---|
| US-054-T1 | Add the currency endpoint (409 when transactions or bills exist) with tests | [M5 Dashboard and account](../plans/06-dashboard-account.md), Task 3 (currency) | To do |
| US-054-T2 | Add the currency section that updates the signed-in user, with tests including the 409 message | [M5 Dashboard and account](../plans/06-dashboard-account.md), Task 7 (currency section) | To do |

## Out of scope

Converting existing amounts between currencies.

## Notes and risks

Could-have: if time is short the currency stays fixed at sign-up (PRD question Q7).

## Definition of Done

The shared [Definition of Done](./README.md#definition-of-done) applies, plus every acceptance criterion demonstrated:

- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2
- [ ] Acceptance criterion 3
- [ ] Acceptance criterion 4
