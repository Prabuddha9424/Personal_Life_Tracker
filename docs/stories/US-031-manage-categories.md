# US-031: Organise spending with categories

| | |
|---|---|
| **Status** | In Review |
| **Epic** | E3 Personal finance |
| **Priority** | Must |
| **Size** | M |
| **Milestone** | M3 |
| **PRD** | FIN-3 |
| **Depends on** | [US-011](./US-011-log-in-stay-logged-in-log-out.md) |

## User story

> **As** a user, **I want** a sensible set of categories that I can extend and rename, **so that** my spending is grouped the way I think about it.

## Acceptance criteria

1. **Given** I open categories for the first time, **when** the list loads, **then** I get 11 expense and 5 income defaults, even if two requests race, and never duplicates.
2. **Given** I add a category, **when** I give it a name and a type, **then** it appears; a name that already exists for that type (ignoring case) is refused, while the same name for the other type is allowed.
3. **Given** a category, **when** I rename it, **then** the new name shows everywhere, and a clash is refused with a message.
4. **Given** a category with transactions, **when** I delete it, **then** it is refused with the number of transactions using it; an unused one is deleted.
5. **Given** two users, **when** each opens categories, **then** each has their own set, unaffected by the other.

## Tasks

| ID | Task | Plan reference | Status |
|---|---|---|---|
| US-031-T1 | Add category endpoints with lazily created defaults, case-insensitive uniqueness and the in-use check, with tests (including racing first requests) | [M3 Finance](../plans/04-finance.md), Task 2 | Done |
| US-031-T2 | Add the category manager dialog (add, inline rename, delete, server messages) with tests | [M3 Finance](../plans/04-finance.md), Task 10 (category manager) | Done |

## Out of scope

Category colours, icons and budgets.

## Notes and risks

Defaults are created on first use, not at registration, so the auth slice never depends on finance.

## Definition of Done

The shared [Definition of Done](./README.md#definition-of-done) applies, plus every acceptance criterion demonstrated:

- [x] Acceptance criterion 1
- [x] Acceptance criterion 2
- [x] Acceptance criterion 3
- [x] Acceptance criterion 4
- [x] Acceptance criterion 5
