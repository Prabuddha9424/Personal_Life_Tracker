# US-004: Consistent dark-first interface shell

| | |
|---|---|
| **Status** | In Progress |
| **Epic** | E0 Project setup |
| **Priority** | Must |
| **Size** | L |
| **Milestone** | M0 |
| **PRD** | UI-1, UI-3, UI-6 |
| **Depends on** | [US-001](./US-001-repository-and-tooling-baseline.md) |

## User story

> **As** a user, **I want** a consistent, responsive layout with sidebar navigation, dialogs and notifications, **so that** every screen feels familiar and works on my phone.

## Acceptance criteria

1. **Given** a desktop-width window, **when** I open the app, **then** I see a sidebar with the navigation links and the current page is marked.
2. **Given** a window 800 px wide or less, **when** I open the app, **then** the sidebar becomes a drawer opened by a menu button, and it closes when I choose a page.
3. **Given** a dialog is open, **when** I use the keyboard, **then** focus moves into the dialog, Tab stays inside it, Escape closes it and focus returns to where I was.
4. **Given** an action succeeds or fails, **when** the result is known, **then** a notification appears and disappears by itself, and errors are announced to screen readers.
5. **Given** any screen that loads data, **when** it is loading, empty or failed, **then** shared loading, empty and error views are available and used.
6. **Given** the interface, **when** I look at colours, **then** they come from theme tokens (dark values from the approved design) so both themes can be tuned in one place.

## Tasks

| ID | Task | Plan reference | Status |
|---|---|---|---|
| US-004-T1 | Write the design tokens and base styles (dark default, light values) and the primitives: Button, Spinner, Card, Loading/Empty/Error views, FormField, with tests | [M0 Foundation](../plans/01-foundation.md), Task 6 | Done |
| US-004-T2 | Add the accessible Modal (focus handling, Escape, backdrop, focus trap) and toast notifications with tests | [M0 Foundation](../plans/01-foundation.md), Task 8 | Done |
| US-004-T3 | Add the app shell (sidebar, top bar, mobile drawer), the navigation list, the root layout and the `renderWithProviders` test helper, with tests | [M0 Foundation](../plans/01-foundation.md), Task 9 | To do |
| US-004-T4 | Look at the shell in a browser at desktop and phone widths | [M0 Foundation](../plans/01-foundation.md), Task 9, step 5 | To do |

## Out of scope

Feature pages, and the theme switch (US-053).

## Notes and risks

Each later milestone appends its own entry to the navigation list.

## Definition of Done

The shared [Definition of Done](./README.md#definition-of-done) applies, plus every acceptance criterion demonstrated:

- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2
- [ ] Acceptance criterion 3
- [ ] Acceptance criterion 4
- [ ] Acceptance criterion 5
- [ ] Acceptance criterion 6
