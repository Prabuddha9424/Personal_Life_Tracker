# US-040: Track recurring bills

| | |
|---|---|
| **Status** | Ready |
| **Epic** | E4 Fixed expenses and reminders |
| **Priority** | Must |
| **Size** | L |
| **Milestone** | M4 |
| **PRD** | FIX-1, FIX-2, FIX-3 |
| **Depends on** | [US-011](./US-011-log-in-stay-logged-in-log-out.md), [US-006](./US-006-exact-money-and-dates.md) |

## User story

> **As** a user, **I want** to record my regular bills (weekly, monthly or yearly) and see when each is next due, **so that** I never miss a payment.

## Acceptance criteria

1. **Given** the Bills page, **when** I add a bill with a name, amount, repeat, first due date and reminder lead time, **then** it is saved in my currency and shown sorted by next due date.
2. **Given** a bill whose first due date was in the past, **when** it is saved, **then** its next due date is the next occurrence on or after today, and its schedule date is kept.
3. **Given** a bill on the 29th, 30th or 31st, **when** the month is shorter, **then** it falls on the last day of that month and returns to its day afterwards; a yearly 29 February bill is 28 February in common years.
4. **Given** the list, **when** I look at it, **then** each bill says "due in N days", "due today" or "overdue by N days" in words, and paused bills are marked Paused.
5. **Given** I edit a bill, **when** I change only the amount, name or lead time, **then** the schedule is unchanged; changing the schedule date or the repeat recomputes the next due date.
6. **Given** I pause and resume a bill, **when** I resume it, **then** its next due date is recomputed from today.
7. **Given** a lead time outside 0 to 30, a name with a line break, a zero amount or a date outside 2000 to 2100, **when** I submit, **then** it is refused with an inline message.

## Tasks

| ID | Task | Plan reference | Status |
|---|---|---|---|
| US-040-T1 | Add the drift-free recurrence maths with exhaustive tests (month ends, leap years, weekly) | [M4 Fixed expenses](../plans/05-fixed-expenses.md), Task 1 | To do |
| US-040-T2 | Add the bill model, request schemas, DTO and test helper | [M4 Fixed expenses](../plans/05-fixed-expenses.md), Task 2 | To do |
| US-040-T3 | Add bill CRUD with schedule-aware updates and tests | [M4 Fixed expenses](../plans/05-fixed-expenses.md), Task 3 | To do |
| US-040-T4 | Add the frontend types, API, hooks, due labels and form logic with tests | [M4 Fixed expenses](../plans/05-fixed-expenses.md), Task 8 | To do |
| US-040-T5 | Add the bill form dialog (paused switch, two-step delete) with tests | [M4 Fixed expenses](../plans/05-fixed-expenses.md), Task 9 | To do |
| US-040-T6 | Add the Bills page, route and navigation entry | [M4 Fixed expenses](../plans/05-fixed-expenses.md), Task 10 | To do |
| US-040-T7 | Walk the flows in a real browser, including a bill anchored on the 31st | [M4 Fixed expenses](../plans/05-fixed-expenses.md), Task 11 | To do |

## Out of scope

Marking a bill paid or posting it to finance (PRD section 3.2).

## Notes and risks

The form edits the schedule's base date, not the next due date, so saving never silently moves a bill from the 31st to the 28th.

## Definition of Done

The shared [Definition of Done](./README.md#definition-of-done) applies, plus every acceptance criterion demonstrated:

- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2
- [ ] Acceptance criterion 3
- [ ] Acceptance criterion 4
- [ ] Acceptance criterion 5
- [ ] Acceptance criterion 6
- [ ] Acceptance criterion 7
