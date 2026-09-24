# US-051: Export my data

| | |
|---|---|
| **Status** | Ready |
| **Epic** | E5 Dashboard and account |
| **Priority** | Must |
| **Size** | M |
| **Milestone** | M5 |
| **PRD** | ACC-1 |
| **Depends on** | [US-013](./US-013-change-password-and-profile.md), [US-021](./US-021-move-tasks-on-the-board.md), [US-030](./US-030-record-income-and-expenses.md), [US-040](./US-040-track-recurring-bills.md) |

## User story

> **As** a user, **I want** to download all my data as JSON or each dataset as CSV, **so that** I own my data and have a backup on a service with no automated backups.

## Acceptance criteria

1. **Given** Settings, **when** I choose "Download everything (JSON)", **then** I get a dated file with my profile, tasks, categories, transactions and bills, and no password, hash, token or anyone else's data.
2. **Given** Settings, **when** I download transactions, tasks or bills as CSV, **then** I get a dated CSV whose amounts are exact decimals next to the integer minor units, with the category name for transactions.
3. **Given** a task, note or bill name that starts with `=`, `+`, `-`, `@`, a tab or a return, **when** it is exported to CSV, **then** it is prefixed so a spreadsheet shows the text instead of running it as a formula.
4. **Given** text with commas, quotes or line breaks, **when** it is exported, **then** it round-trips correctly.
5. **Given** a download fails, **when** I try, **then** I see a message and no file is saved.

## Tasks

| ID | Task | Plan reference | Status |
|---|---|---|---|
| US-051-T1 | Add CSV serialisation with formula neutralisation and exact decimal amounts, with tests | [M5 Dashboard and account](../plans/06-dashboard-account.md), Task 1 | To do |
| US-051-T2 | Add the export endpoint (JSON and CSV, dated file names) using only the other slices' public export functions, with end-to-end tests | [M5 Dashboard and account](../plans/06-dashboard-account.md), Task 2 | To do |
| US-051-T3 | Add the export API, the download helper and the Your data section with tests | [M5 Dashboard and account](../plans/06-dashboard-account.md), Task 6 (download) and Task 7 (data section) | To do |
| US-051-T4 | Open the downloaded files in a spreadsheet and check that `=1+1` stays text | [M5 Dashboard and account](../plans/06-dashboard-account.md), Task 8 | To do |

## Out of scope

Scheduled backups and importing an export back in.

## Notes and risks

Each slice exposes `export…ForUser` in its `index.ts` (US-021, US-030, US-040 tasks).

## Definition of Done

The shared [Definition of Done](./README.md#definition-of-done) applies, plus every acceptance criterion demonstrated:

- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2
- [ ] Acceptance criterion 3
- [ ] Acceptance criterion 4
- [ ] Acceptance criterion 5
