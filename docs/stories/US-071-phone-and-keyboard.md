# US-071: Usable on a phone and with a keyboard

| | |
|---|---|
| **Status** | Ready |
| **Epic** | E7 Cross-cutting quality |
| **Priority** | Should |
| **Size** | M |
| **Milestone** | M0-M6 |
| **PRD** | UI-4, NFR-8 |
| **Depends on** | [US-004](./US-004-interface-shell.md), [US-021](./US-021-move-tasks-on-the-board.md), [US-032](./US-032-see-where-my-money-goes.md) |

## User story

> **As** a user on a phone or using only a keyboard or screen reader, **I want** every screen to work for me, **so that** the app is usable in daily life, not only on a desktop with a mouse.

## Acceptance criteria

1. **Given** a window 360 px wide, **when** I visit every screen, **then** nothing overflows the page sideways (the board and tables scroll inside their area) and every action is reachable.
2. **Given** only a keyboard, **when** I use the app, **then** I can reach and operate every control, including dragging a card, and the focus is always visible.
3. **Given** a screen reader, **when** I use forms and charts, **then** controls have labels, errors are announced, and each chart's numbers are available as a table.
4. **Given** both themes, **when** I check text and controls, **then** contrast meets WCAG AA.
5. **Given** motion preferences, **when** reduced motion is on, **then** spinners and drawers do not animate strongly.

## Tasks

| ID | Task | Plan reference | Status |
|---|---|---|---|
| US-071-T1 | Phone-width pass over every screen at the end of each milestone's manual check | [M2 Tasks](../plans/03-tasks.md), Task 10 (repeat in M3, M4, M5 wrap-ups) | To do |
| US-071-T2 | Keyboard-only run through sign-up, board (including keyboard drag), a transaction, a bill and Settings | No plan task (new work described here) | To do |
| US-071-T3 | Contrast and label audit of both themes with the browser's accessibility tools, and fix findings | No plan task (new work described here) | To do |
| US-071-T4 | Final audit on the deployed site before the pilot | [M6 Deploy and pilot](../plans/07-deploy-pilot.md), Task 6, step 2 | To do |

## Out of scope

A native mobile app.

## Notes and risks

No new dependency is added for auditing; use the browser's built-in accessibility tools.

## Definition of Done

The shared [Definition of Done](./README.md#definition-of-done) applies, plus every acceptance criterion demonstrated:

- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2
- [ ] Acceptance criterion 3
- [ ] Acceptance criterion 4
- [ ] Acceptance criterion 5
