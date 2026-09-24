# US-070: My data is private to me

| | |
|---|---|
| **Status** | In Progress |
| **Epic** | E7 Cross-cutting quality |
| **Priority** | Must |
| **Size** | L |
| **Milestone** | M2-M5 |
| **PRD** | NFR-1, S1 |
| **Depends on** | [US-020](./US-020-create-and-edit-tasks.md), [US-030](./US-030-record-income-and-expenses.md), [US-040](./US-040-track-recurring-bills.md) |

## User story

> **As** a user, **I want** to be sure that no other user can see or change my data, **so that** I can put real financial and personal information in the app.

## Acceptance criteria

1. **Given** another user's task, transaction, category or bill id, **when** I try to read, change, delete or move it, **then** it looks like it does not exist (404) and nothing changes.
2. **Given** lists, search, filters, tag lists, exports and reports, **when** another user asks, **then** they never include my data, and reports match `userId` as an ObjectId.
3. **Given** a `userId` in a request body, **when** a client sends it, **then** it is ignored and the record belongs to the caller.
4. **Given** another user's category or task as a neighbour, **when** I use it in my own request, **then** it is refused as if it did not exist.
5. **Given** two people use one browser, **when** one logs out and the other logs in, **then** the second never sees the first's cached data.
6. **Given** a deleted account's old token, **when** it is used, **then** it cannot create money data.

## Tasks

| ID | Task | Plan reference | Status |
|---|---|---|---|
| US-070-T1 | Tasks: tenant isolation tests (read, update, delete, move, list, tags, neighbours, planted `userId`) | [M2 Tasks](../plans/03-tasks.md), Task 5 | Done |
| US-070-T2 | Finance: tenant isolation tests (transactions, categories, bulk, reports) | [M3 Finance](../plans/04-finance.md), Task 6 | To do |
| US-070-T3 | Fixed expenses: tenant isolation tests | [M4 Fixed expenses](../plans/05-fixed-expenses.md), Task 7 | To do |
| US-070-T4 | Account: deletion leaves other users intact and old tokens harmless | [M5 Dashboard and account](../plans/06-dashboard-account.md), Task 3 (delete tests) | To do |
| US-070-T5 | Frontend: cache cleared on login, logout and failed refresh | [M1 Auth](../plans/02-auth.md), Tasks 9, 10, 12 (tests) | Done |
| US-070-T6 | Two-user manual check on the deployed site, using two browser profiles | [M6 Deploy and pilot](../plans/07-deploy-pilot.md), Task 6, step 2 | To do |
| US-070-T7 | Review every query in the codebase once more for a missing `userId` before the pilot | No plan task (new work described here) | To do |

## Out of scope

Field-level encryption.

## Notes and risks

A failing isolation test means a tenant leak: fix the service, never the test.

## Definition of Done

The shared [Definition of Done](./README.md#definition-of-done) applies, plus every acceptance criterion demonstrated:

- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2
- [ ] Acceptance criterion 3
- [ ] Acceptance criterion 4
- [ ] Acceptance criterion 5
- [ ] Acceptance criterion 6
