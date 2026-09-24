# US-020: Create and edit tasks

| | |
|---|---|
| **Status** | In Review |
| **Epic** | E2 Tasks (Kanban) |
| **Priority** | Must |
| **Size** | L |
| **Milestone** | M2 |
| **PRD** | TASK-1, TASK-4, NFR-1 |
| **Depends on** | [US-011](./US-011-log-in-stay-logged-in-log-out.md), [US-004](./US-004-interface-shell.md), [US-006](./US-006-exact-money-and-dates.md) |

## User story

> **As** a user, **I want** to create tasks with a description, due date, priority and tags, and to edit or delete them, **so that** I capture everything I need to do.

## Acceptance criteria

1. **Given** the board, **when** I add a task with only a title, **then** it is created as Medium priority in To Do, at the top of the column.
2. **Given** a task form, **when** I enter a blank or 201-character title, an impossible date, an unknown priority, more than 10 tags or a tag over 30 characters, **then** I see an inline error and nothing is saved.
3. **Given** tags, **when** I type ` Home, HOME, work `, **then** they are stored as `home` and `work`.
4. **Given** an existing task, **when** I change some fields, **then** only those fields change, I can clear the due date, and I cannot change status or position through the edit form.
5. **Given** a task, **when** I choose delete, **then** I am asked to confirm first, and it is gone afterwards.
6. **Given** the request body, **when** it contains a `userId`, **then** it is ignored and the task belongs to me.

## Tasks

| ID | Task | Plan reference | Status |
|---|---|---|---|
| US-020-T1 | Add the task model, request schemas, DTO and test helper | [M2 Tasks](../plans/03-tasks.md), Task 2 | Done |
| US-020-T2 | Add task create, read, update, delete, list and tags endpoints with tests | [M2 Tasks](../plans/03-tasks.md), Task 3 | Done |
| US-020-T3 | Add the frontend types, API, query keys and task-form logic with tests | [M2 Tasks](../plans/03-tasks.md), Task 6 (types, API, keys, form) | Done |
| US-020-T4 | Add the task card and the create/edit/delete modal (two-step delete) with tests | [M2 Tasks](../plans/03-tasks.md), Task 8 (card, form modal) | Done |
| US-020-T5 | Walk create, edit and delete in a real browser | [M2 Tasks](../plans/03-tasks.md), Task 10 | To do |

## Out of scope

Subtasks, attachments and comments.

## Definition of Done

The shared [Definition of Done](./README.md#definition-of-done) applies, plus every acceptance criterion demonstrated:

- [x] Acceptance criterion 1
- [x] Acceptance criterion 2
- [x] Acceptance criterion 3
- [x] Acceptance criterion 4
- [x] Acceptance criterion 5
- [x] Acceptance criterion 6
