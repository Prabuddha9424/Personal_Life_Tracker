# US-006: Exact money and calendar-date handling

| | |
|---|---|
| **Status** | Ready |
| **Epic** | E0 Project setup |
| **Priority** | Must |
| **Size** | S |
| **Milestone** | M0 |
| **PRD** | FIN-2, NFR-6 |
| **Depends on** | [US-001](./US-001-repository-and-tooling-baseline.md) |

## User story

> **As** a user of any currency, **I want** amounts and dates handled exactly, **so that** totals are never off by a cent or a day.

## Acceptance criteria

1. **Given** a typed amount such as `12.34`, `1,234.50`, `12,50` or `1.234,50`, **when** it is parsed for a two-decimal currency, **then** it becomes an integer number of minor units (1234, 123450, 1250, 123450) with no floating-point arithmetic.
2. **Given** JPY (no decimals) and BHD (three decimals), **when** I type `500` and `1.234`, **then** they become 500 and 1234 minor units, and `5.5` yen or four decimals are rejected instead of rounded.
3. **Given** an amount in minor units, **when** it is shown, **then** it is formatted with the currency symbol and the currency's own number of decimals.
4. **Given** a calendar date, **when** "today", day differences, month shifts and month names are needed, **then** they use the user's local day, count whole days across daylight-saving changes, and shift months across year ends without moving the date by a time zone.

## Tasks

| ID | Task | Plan reference | Status |
|---|---|---|---|
| US-006-T1 | Add the money helpers (`minorUnitDigits`, `toMinorUnits`, `minorToMajor`, `formatMinorUnits`) with tests for USD, JPY, BHD and EU formats | [M0 Foundation](../plans/01-foundation.md), Task 11, steps 1-2 | To do |
| US-006-T2 | Add the date helpers (`todayIso`, `addDaysIso`, `daysBetween`, `formatDate`, month helpers) with tests | [M0 Foundation](../plans/01-foundation.md), Task 11, steps 3-4 | To do |
| US-006-T3 | Add `formatMinorForInput` for pre-filling edit forms with integer arithmetic | [M3 Finance](../plans/04-finance.md), Task 7, step 1 | To do |

## Out of scope

Currency conversion.

## Notes and risks

`minorToMajor` divides and is for display and chart plotting only; stored and transmitted amounts stay integers.

## Definition of Done

The shared [Definition of Done](./README.md#definition-of-done) applies, plus every acceptance criterion demonstrated:

- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2
- [ ] Acceptance criterion 3
- [ ] Acceptance criterion 4
