# US-022: Find and prioritise tasks

| | |
|---|---|
| **Status** | In Review |
| **Epic** | E2 Tasks (Kanban) |
| **Priority** | Should |
| **Size** | M |
| **Milestone** | M2 |
| **PRD** | TASK-5, TASK-6, TASK-7 |
| **Depends on** | [US-020](./US-020-create-and-edit-tasks.md) |

## User story

> **As** a user, **I want** to see priority and overdue state on cards and to filter by tag or search by title, **so that** I can focus on what matters.

## Acceptance criteria

1. **Given** a card, **when** I look at it, **then** I see its priority marker, due date and tags, and a task that is not Done and past its due date shows an Overdue badge in words.
2. **Given** the tag filter, **when** I open it, **then** it lists only my own tags, and choosing one narrows every column.
3. **Given** the search box, **when** I type a title fragment and press Enter, **then** every column shows only matching tasks, ignoring case.
4. **Given** search text with special characters such as `a.b`, `(`, `[`, `*` or `$`, **when** I search, **then** they are matched literally and never break the search.
5. **Given** a filter that matches nothing, **when** I apply it, **then** each column shows a clear empty message.

## Tasks

| ID | Task | Plan reference | Status |
|---|---|---|---|
| US-022-T1 | Cover the list filters (status, tag, search, due date, open) and the tags endpoint with tests | [M2 Tasks](../plans/03-tasks.md), Task 3 (list tests) | Done |
| US-022-T2 | Add the card's priority and overdue display and the board toolbar (tag filter, submit-only search) with tests | [M2 Tasks](../plans/03-tasks.md), Task 8 (card, toolbar) | Done |
| US-022-T3 | Walk filters and search in a real browser | [M2 Tasks](../plans/03-tasks.md), Task 10 | To do |

## Out of scope

Saved filters and full-text search of descriptions.

## Definition of Done

The shared [Definition of Done](./README.md#definition-of-done) applies, plus every acceptance criterion demonstrated:

- [x] Acceptance criterion 1
- [x] Acceptance criterion 2
- [x] Acceptance criterion 3
- [x] Acceptance criterion 4
- [x] Acceptance criterion 5
