# US-050: See my day at a glance

| | |
|---|---|
| **Status** | Ready |
| **Epic** | E5 Dashboard and account |
| **Priority** | Must |
| **Size** | L |
| **Milestone** | M5 |
| **PRD** | DASH-1, DASH-2, DASH-3, DASH-4 |
| **Depends on** | [US-021](./US-021-move-tasks-on-the-board.md), [US-032](./US-032-see-where-my-money-goes.md), [US-040](./US-040-track-recurring-bills.md) |

## User story

> **As** a logged-in user, **I want** a Today page that summarises my tasks, money and bills, **so that** I see what needs attention as soon as I open the app.

## Acceptance criteria

1. **Given** I log in, **when** the Today page opens, **then** I see three cards: tasks due in the next 7 days with an overdue count, this month's net with income and expenses, and my next bills with how soon each is due.
2. **Given** below the cards, **when** I look further, **then** I see spending by category for this month and income against expenses for six months.
3. **Given** a card, **when** I click its link, **then** I go to the full page (board, finance or bills).
4. **Given** a card has nothing to show, **when** it loads, **then** it says so and offers the first action (open the board, add a transaction, add a bill).
5. **Given** one summary fails to load, **when** the page renders, **then** the other cards and charts still show and the failed card offers a retry.
6. **Given** the code, **when** I read the dashboard slice, **then** it imports only from the public `index.ts` of the tasks, finance and fixed-expenses slices.

## Tasks

| ID | Task | Plan reference | Status |
|---|---|---|---|
| US-050-T1 | Export `endSession` from auth and `dueLabel` from fixed-expenses and pin the auth API with a test | [M5 Dashboard and account](../plans/06-dashboard-account.md), Task 4 | To do |
| US-050-T2 | Add the three cards and the page, give `Card` an accessible region name, and test loading, empty, error and independent failure | [M5 Dashboard and account](../plans/06-dashboard-account.md), Task 5 | To do |
| US-050-T3 | Check the dashboard in a real browser, including with the backend stopped | [M5 Dashboard and account](../plans/06-dashboard-account.md), Task 8 | To do |

## Out of scope

Customisable widgets.

## Notes and risks

The tasks card uses `useDueSoonTasks` (US-020/021), the net card and charts use finance (US-032), the bills card uses `useUpcomingBills` (US-040).

## Definition of Done

The shared [Definition of Done](./README.md#definition-of-done) applies, plus every acceptance criterion demonstrated:

- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2
- [ ] Acceptance criterion 3
- [ ] Acceptance criterion 4
- [ ] Acceptance criterion 5
- [ ] Acceptance criterion 6
