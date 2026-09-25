# US-032: Understand my spending with charts

| | |
|---|---|
| **Status** | In Review |
| **Epic** | E3 Personal finance |
| **Priority** | Must |
| **Size** | L |
| **Milestone** | M3 |
| **PRD** | FIN-5, FIN-6, FIN-7, FIN-8, FIN-9 |
| **Depends on** | [US-030](./US-030-record-income-and-expenses.md), [US-004](./US-004-interface-shell.md) |

## User story

> **As** a user, **I want** summary cards and charts for a chosen month and the last 6 or 12 months, **so that** I can see at a glance where my money goes and how my balance is moving.

## Acceptance criteria

1. **Given** a month, **when** I pick it with the arrows or the picker, **then** I see total income, expenses and net, and a doughnut of spending by category, all for that month.
2. **Given** the last 6 or 12 months, **when** I choose the range, **then** a bar chart of income against expenses and a line chart of my running balance follow it, oldest first, with empty months as zero.
3. **Given** a transaction on the 30th and one on the 1st, **when** I look at the two months, **then** each lands in its own month, and a range that ends in February spans the year end.
4. **Given** a chart, **when** I use a screen reader or a keyboard, **then** the same numbers are available as a table, formatted as money.
5. **Given** I switch theme, **when** the chart redraws, **then** its colours follow the theme.
6. **Given** no data, loading or a failure, **when** a chart is shown, **then** it has its own empty message, loading state, or error with a retry.
7. **Given** a category deleted after use, **when** the report is built, **then** its spending still counts and shows as "Deleted category".

## Tasks

| ID | Task | Plan reference | Status |
|---|---|---|---|
| US-032-T1 | Add the reports (summary, by category, monthly totals, balance trend) with aggregations that always match an ObjectId `userId`, with tests | [M3 Finance](../plans/04-finance.md), Task 5 | Done |
| US-032-T2 | Add the chart plumbing (Chart.js registration, theme colours, data table) and the three charts, with tests | [M3 Finance](../plans/04-finance.md), Task 9 | Done |
| US-032-T3 | Add the month picker and the summary cards with tests | [M3 Finance](../plans/04-finance.md), Task 10 (month picker, summary cards) | Done |
| US-032-T4 | Assemble the Finance page with the range selector and check it in a browser in both themes | [M3 Finance](../plans/04-finance.md), Tasks 12-13 | To do |

## Out of scope

Budgets, forecasts and custom date ranges.

## Notes and risks

Two users with data in the same month must each see only their own totals, and those totals must be non-zero (proving the match works).

## Definition of Done

The shared [Definition of Done](./README.md#definition-of-done) applies, plus every acceptance criterion demonstrated:

- [x] Acceptance criterion 1
- [x] Acceptance criterion 2
- [x] Acceptance criterion 3
- [x] Acceptance criterion 4
- [x] Acceptance criterion 5
- [x] Acceptance criterion 6
- [x] Acceptance criterion 7
