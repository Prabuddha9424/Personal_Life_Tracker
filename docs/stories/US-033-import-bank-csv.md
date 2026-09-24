# US-033: Import transactions from a bank CSV

| | |
|---|---|
| **Status** | Ready |
| **Epic** | E3 Personal finance |
| **Priority** | Should |
| **Size** | L |
| **Milestone** | M3 |
| **PRD** | FIN-10 |
| **Depends on** | [US-030](./US-030-record-income-and-expenses.md), [US-031](./US-031-manage-categories.md) |

## User story

> **As** a user, **I want** to import a CSV exported from my bank, **so that** I do not have to type months of transactions by hand.

## Acceptance criteria

1. **Given** a CSV file, **when** I choose it, **then** the delimiter (comma, semicolon or tab), a byte-order mark, quotes, line breaks inside quotes and blank lines are handled, and the date, amount and note columns are guessed from the header.
2. **Given** the mapping, **when** I choose the date format and whether negative amounts are spending, **then** the preview updates to show how many rows are ready and lists each problem row by number, and problem rows are skipped.
3. **Given** rows that match transactions I already have, **when** the preview loads, **then** I am warned, and can still import them.
4. **Given** a large file, **when** I import it, **then** it is sent in batches of 200 with progress, and each batch is all-or-nothing.
5. **Given** a batch fails, **when** the import stops, **then** I am told how many rows were imported and how many were not.
6. **Given** an empty file or a header-only file, **when** I choose it, **then** I get a clear message and no import button.

## Tasks

| ID | Task | Plan reference | Status |
|---|---|---|---|
| US-033-T1 | Add the all-or-nothing bulk endpoint (up to 500 rows, category checks, row-numbered errors) with tests | [M3 Finance](../plans/04-finance.md), Task 4 | To do |
| US-033-T2 | Add the CSV parser and the import mapping (dates, signed amounts, column guess, duplicates, batching) as pure functions with tests | [M3 Finance](../plans/04-finance.md), Task 8 | To do |
| US-033-T3 | Add the import dialog with tests (preview, duplicates, batches, partial failure) | [M3 Finance](../plans/04-finance.md), Task 11 | To do |
| US-033-T4 | Try the sample file from the plan in a real browser and import it twice | [M3 Finance](../plans/04-finance.md), Task 13 | To do |

## Out of scope

Bank connections, rules for auto-categorising and undoing an import.

## Notes and risks

The browser parses the file; the API only receives JSON rows, so no new backend dependency is needed.

## Definition of Done

The shared [Definition of Done](./README.md#definition-of-done) applies, plus every acceptance criterion demonstrated:

- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2
- [ ] Acceptance criterion 3
- [ ] Acceptance criterion 4
- [ ] Acceptance criterion 5
- [ ] Acceptance criterion 6
