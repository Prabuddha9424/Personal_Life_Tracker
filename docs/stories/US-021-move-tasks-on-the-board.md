# US-021: Move tasks across the Kanban board

| | |
|---|---|
| **Status** | Ready |
| **Epic** | E2 Tasks (Kanban) |
| **Priority** | Must |
| **Size** | XL |
| **Milestone** | M2 |
| **PRD** | TASK-2, TASK-3, TASK-8 |
| **Depends on** | [US-020](./US-020-create-and-edit-tasks.md) |

## User story

> **As** a user, **I want** to drag task cards between and within the three columns, **so that** the board always shows where each task stands.

## Acceptance criteria

1. **Given** the board, **when** I open it, **then** I see To Do, In Progress and Done, each with its cards and a count.
2. **Given** a card, **when** I drag it to another column or to another place in its column and reload, **then** it stays exactly where I dropped it.
3. **Given** I use only the keyboard, **when** I focus a card, press Space, use the arrow keys and press Space again, **then** the card moves and the move is announced.
4. **Given** I drop a card, **when** the server is slow, **then** the card moves at once, and if the server refuses it moves back with an error message.
5. **Given** another tab deleted the neighbour I dropped next to, or moved it to another column, **when** I drop a card, **then** the move is refused with "the board changed" and the board refreshes to the true state.
6. **Given** a column with more cards than one page, **when** I scroll to its end, **then** a Load more button fetches the next page.
7. **Given** two cards get almost the same position, **when** I move a card between them, **then** the column is renumbered invisibly and the order is still correct.

## Tasks

| ID | Task | Plan reference | Status |
|---|---|---|---|
| US-021-T1 | Add the ordering logic (`positionBetween`) with tests | [M2 Tasks](../plans/03-tasks.md), Task 1 | To do |
| US-021-T2 | Add the move endpoint (neighbour ids, rebalancing, 400 and 409 cases) with tests | [M2 Tasks](../plans/03-tasks.md), Task 4 | To do |
| US-021-T3 | Add the board-cache logic (remove, insert, neighbours) with tests | [M2 Tasks](../plans/03-tasks.md), Task 6 (board cache) | To do |
| US-021-T4 | Add the query hooks and the optimistic move with rollback, with tests | [M2 Tasks](../plans/03-tasks.md), Task 7 | To do |
| US-021-T5 | Add the columns, the drag-and-drop board, the page, the route and the navigation entry, with page tests | [M2 Tasks](../plans/03-tasks.md), Task 9 | To do |
| US-021-T6 | Walk drag, keyboard drag and the two-tab stale-board case in a real browser | [M2 Tasks](../plans/03-tasks.md), Task 10 | To do |

## Out of scope

Custom columns, multiple boards and swimlanes (PRD section 3.2).

## Notes and risks

Drag and drop cannot be proven in jsdom, so the real-browser check is part of the story.

## Definition of Done

The shared [Definition of Done](./README.md#definition-of-done) applies, plus every acceptance criterion demonstrated:

- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2
- [ ] Acceptance criterion 3
- [ ] Acceptance criterion 4
- [ ] Acceptance criterion 5
- [ ] Acceptance criterion 6
- [ ] Acceptance criterion 7
