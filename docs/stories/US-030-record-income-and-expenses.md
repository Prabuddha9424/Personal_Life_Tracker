# US-030: Record income and expenses

| | |
|---|---|
| **Status** | Ready |
| **Epic** | E3 Personal finance |
| **Priority** | Must |
| **Size** | L |
| **Milestone** | M3 |
| **PRD** | FIN-1, FIN-2, FIN-4 |
| **Depends on** | [US-011](./US-011-log-in-stay-logged-in-log-out.md), [US-031](./US-031-manage-categories.md), [US-006](./US-006-exact-money-and-dates.md) |

## User story

> **As** a user, **I want** to record, edit and delete income and expense transactions and browse them, **so that** I know where my money comes from and goes.

## Acceptance criteria

1. **Given** the Finance page, **when** I add an expense of 12.50 in a category, **then** it is stored as 1250 minor units in my currency and appears at the top of the list.
2. **Given** JPY or BHD, **when** I add an amount, **then** whole yen and three-decimal dinar amounts work, and too many decimals are rejected with a message.
3. **Given** a transaction, **when** I edit it or delete it (with confirmation), **then** the list, totals and charts follow.
4. **Given** the list, **when** I filter by type, category and date range and page through it, **then** it shows newest first, a filter change goes back to page 1, and the page count is right.
5. **Given** a category of the other kind, another user's category, or an unknown one, **when** I try to use it, **then** it is refused with the same message for the last two.
6. **Given** no transactions, **when** I open the list, **then** I see an empty state that invites the first one.

## Tasks

| ID | Task | Plan reference | Status |
|---|---|---|---|
| US-030-T1 | Add the category and transaction models, default categories, schemas, DTOs and test helpers | [M3 Finance](../plans/04-finance.md), Task 1 | To do |
| US-030-T2 | Add transaction create, list, update and delete with tests (currency from the profile, category checks) | [M3 Finance](../plans/04-finance.md), Task 3 | To do |
| US-030-T3 | Add the frontend types, API, keys and hooks | [M3 Finance](../plans/04-finance.md), Task 7 | To do |
| US-030-T4 | Add the transaction form (currency-aware amount), the list with filters and paging, with tests | [M3 Finance](../plans/04-finance.md), Task 10 (form modal, list) | To do |
| US-030-T5 | Add the Finance page, route and navigation entry | [M3 Finance](../plans/04-finance.md), Task 12 | To do |
| US-030-T6 | Walk the flows in a real browser, including a JPY account | [M3 Finance](../plans/04-finance.md), Task 13 | To do |

## Out of scope

Recurring transactions, splits, attachments and transfers between accounts.

## Definition of Done

The shared [Definition of Done](./README.md#definition-of-done) applies, plus every acceptance criterion demonstrated:

- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2
- [ ] Acceptance criterion 3
- [ ] Acceptance criterion 4
- [ ] Acceptance criterion 5
- [ ] Acceptance criterion 6
