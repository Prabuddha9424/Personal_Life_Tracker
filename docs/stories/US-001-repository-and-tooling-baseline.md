# US-001: Repository and tooling baseline

| | |
|---|---|
| **Status** | Done |
| **Epic** | E0 Project setup |
| **Priority** | Must |
| **Size** | M |
| **Milestone** | M0 |
| **PRD** | Section 9 (M0) |
| **Depends on** | None |

## User story

> **As** a developer, **I want** a single, clean repository with the agreed tooling and a green baseline, **so that** every later story starts from a known-good state and follows the same rules.

## Acceptance criteria

1. **Given** a fresh clone of the repository, **when** I run lint, typecheck and tests in `backend` and `frontend`, **then** all of them pass.
2. **Given** the repository, **when** I look at its structure, **then** it has `backend/`, `frontend/`, `docs/`, `CLAUDE.md`, `.nvmrc` (Node 24) and `.editorconfig`, and no `node_modules`, `dist` or `.env` file is tracked.
3. **Given** the git history, **when** I list the branches, **then** `main` exists at the baseline commit and further work happens on `chore/foundation`, so nothing was committed directly to `main`.
4. **Given** the `docs/` folder, **when** I open it, **then** the PRD, the design decisions, the implementation plans and these stories are present and link to each other.

## Tasks

| ID | Task | Plan reference | Status |
|---|---|---|---|
| US-001-T1 | Keep the existing scaffold: backend (Express 5, env validation, Mongo connect, logger, mailer, middleware, health slice) and frontend (Vite, router, HTTP client, query client, dashboard stub) | No plan task (new work described here) | Done |
| US-001-T2 | Move the project into `Personal_Tracker/` and make it its own git repository | No plan task (new work described here) | Done |
| US-001-T3 | Write and get approval for the PRD and the design decisions (`docs/PRD.md`, `docs/design-decisions.md`) | No plan task (new work described here) | Done |
| US-001-T4 | Write the implementation plans, one per milestone (`docs/plans/`) | No plan task (new work described here) | Done |
| US-001-T5 | Write the user stories with tasks and status (`docs/stories/`) | No plan task (new work described here) | Done |
| US-001-T6 | Run lint, typecheck and tests in both apps and record that the baseline is green | [M0 Foundation](../plans/01-foundation.md), Task 1, steps 1-2 | Done |
| US-001-T7 | Check that no generated or secret files would be committed | [M0 Foundation](../plans/01-foundation.md), Task 1, step 3 | Done |
| US-001-T8 | Create branch `chore/foundation`, make the baseline commit, then create `main` at it | [M0 Foundation](../plans/01-foundation.md), Task 1, step 4 | Done |

## Out of scope

Feature code. This story only establishes the starting point.

## Notes and risks

The outer `/Users/samurdhi/Desktop/AI/.git` is an empty repository with no commits and is not used.

## Definition of Done

The shared [Definition of Done](./README.md#definition-of-done) applies, plus every acceptance criterion demonstrated:

- [x] Acceptance criterion 1
- [x] Acceptance criterion 2
- [x] Acceptance criterion 3
- [x] Acceptance criterion 4
