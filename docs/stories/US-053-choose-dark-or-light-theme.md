# US-053: Choose a dark or light theme

| | |
|---|---|
| **Status** | In Progress |
| **Epic** | E5 Dashboard and account |
| **Priority** | Must |
| **Size** | S |
| **Milestone** | M0 |
| **PRD** | UI-2 |
| **Depends on** | [US-004](./US-004-interface-shell.md) |

## User story

> **As** a user, **I want** a dark interface by default and a way to switch to light, **so that** the app is comfortable in any lighting.

## Acceptance criteria

1. **Given** I open the app for the first time, **when** it loads, **then** it is dark, with no flash of the wrong theme.
2. **Given** the top bar or Settings, **when** I switch to light, **then** the whole app, including charts, changes at once and my choice is remembered on this browser.
3. **Given** browser storage is blocked, **when** I switch the theme, **then** it still switches for this visit and never throws.
4. **Given** both themes, **when** I check contrast, **then** text and controls meet WCAG AA (verified in US-071).

## Tasks

| ID | Task | Plan reference | Status |
|---|---|---|---|
| US-053-T1 | Add the theme store, the no-flash init script and the toggle with tests (storage failures included) | [M0 Foundation](../plans/01-foundation.md), Task 7 | Done |
| US-053-T2 | Add the Appearance section to Settings with a test | [M5 Dashboard and account](../plans/06-dashboard-account.md), Task 6 (appearance section) | To do |

## Out of scope

Following the operating-system setting automatically.

## Notes and risks

The theme is the only thing kept in `localStorage`; access tokens never are.

## Definition of Done

The shared [Definition of Done](./README.md#definition-of-done) applies, plus every acceptance criterion demonstrated:

- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2
- [ ] Acceptance criterion 3
- [ ] Acceptance criterion 4
