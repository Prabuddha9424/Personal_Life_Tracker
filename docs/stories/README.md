# User Stories

The user stories for the Personal Life Tracker POC, derived from the [PRD](../PRD.md) and organised for the [implementation plans](../plans/00-overview.md). Each story is one file with a standard template, a status, and its work broken into tasks that point at the exact task in the plan. Start with **US-001** (project setup) and follow the build order below.

30 stories, 132 tasks. Every PRD requirement is covered by at least one story (see the traceability table).

## The story template

Every story follows [`_TEMPLATE.md`](./_TEMPLATE.md):

- **Header table** with status, epic, priority (MoSCoW), size, milestone, PRD references and dependencies.
- **User story** in the standard "As a … I want … so that …" form, written to be independent, negotiable, valuable, estimable, small and testable (INVEST).
- **Acceptance criteria** in "Given … when … then …" form, including unhappy paths.
- **Tasks** as a table: ID, description, reference to the plan task that has the steps and code, and a status.
- **Out of scope**, **notes and risks**, and a **Definition of Done** checklist with one tick per acceptance criterion.

## Status

| Story status | Meaning |
|---|---|
| **Backlog** | Written, but not ready to start (a dependency is unfinished or a question is open) |
| **Ready** | Meets the Definition of Ready and can be started once its dependencies are Done |
| **In Progress** | At least one task is being worked on; work is on its milestone branch |
| **In Review** | All tasks are done; checks are green; waiting for review or the manual check |
| **Blocked** | Cannot continue; say why in the story's notes |
| **Done** | Every acceptance criterion is demonstrated and the Definition of Done is met |

Task status: **To do**, **In progress**, **Done**. A story is *In Progress* as soon as one task starts and *Done* only when every task is Done and every acceptance-criterion box is ticked. Update the status in the story file in the same commit that changes the work.

## Definition of Ready

- [ ] The story has a role, a goal, a benefit and acceptance criteria that include an unhappy path.
- [ ] Its tasks point at plan tasks (or say plainly that they are new work).
- [ ] Its dependencies are known and are Done or being finished first.
- [ ] It is size L or smaller, or it has been split (XL stories are big because they are security critical, and are split into tasks).

## Definition of Done

- [ ] Every acceptance criterion is demonstrated, by an automated test where possible and by the manual check in the plan where not.
- [ ] `npm run lint`, `npm run typecheck` and `npm test` pass in every app the story touched, locally and in CI.
- [ ] Behaviour changes have tests in the same slice; tenant data has a tenant-isolation test; nothing uses `any`, `console.*` or floating-point money.
- [ ] Slice boundaries hold: no deep cross-slice imports, and `shared/` imports nothing from `features/`.
- [ ] Every data view has loading, empty and error states.
- [ ] No secrets or `.env` files are committed; `.env.example` is current.
- [ ] The work was done on a branch named `feature/…`, `fix/…` or `chore/…` with Conventional Commit messages, and merged (never committed straight to `main`).
- [ ] The PRD, the design decisions or the runbook are updated if the story changed what they say.

## Board

| Status | Count | Stories |
|---|---|---|
| Backlog | 1 | [US-063](./US-063-run-the-pilot.md) |
| Ready | 28 | [US-002](./US-002-automated-tests-and-ci.md), [US-003](./US-003-shared-backend-foundations.md), [US-004](./US-004-interface-shell.md), [US-005](./US-005-sleeping-server-handling.md), [US-006](./US-006-exact-money-and-dates.md), [US-010](./US-010-register-with-email-verification.md), [US-011](./US-011-log-in-stay-logged-in-log-out.md), [US-012](./US-012-reset-forgotten-password.md), [US-013](./US-013-change-password-and-profile.md), [US-020](./US-020-create-and-edit-tasks.md), [US-021](./US-021-move-tasks-on-the-board.md), [US-022](./US-022-find-and-prioritise-tasks.md), [US-030](./US-030-record-income-and-expenses.md), [US-031](./US-031-manage-categories.md), [US-032](./US-032-see-where-my-money-goes.md), [US-033](./US-033-import-bank-csv.md), [US-040](./US-040-track-recurring-bills.md), [US-041](./US-041-email-reminders-before-bills-are-due.md), [US-050](./US-050-dashboard-at-a-glance.md), [US-051](./US-051-export-my-data.md), [US-052](./US-052-delete-my-account.md), [US-053](./US-053-choose-dark-or-light-theme.md), [US-054](./US-054-change-currency-before-data.md), [US-060](./US-060-production-hardening.md), [US-061](./US-061-deploy-on-free-hosting.md), [US-062](./US-062-operate-and-back-up.md), [US-070](./US-070-my-data-is-private.md), [US-071](./US-071-phone-and-keyboard.md) |
| In Progress | 1 | [US-001](./US-001-repository-and-tooling-baseline.md) |
| In Review | 0 | – |
| Blocked | 0 | – |
| Done | 0 | – |

## Build order

Stories follow the milestones in the implementation plans. Finish a milestone (all checks green and merged) before starting the next one.

| Milestone | Stories, in order |
|---|---|
| M0 Foundation | [US-001](./US-001-repository-and-tooling-baseline.md) → [US-002](./US-002-automated-tests-and-ci.md) → [US-003](./US-003-shared-backend-foundations.md) → [US-004](./US-004-interface-shell.md) → [US-005](./US-005-sleeping-server-handling.md) → [US-006](./US-006-exact-money-and-dates.md) → [US-053](./US-053-choose-dark-or-light-theme.md) |
| M1 Auth | [US-010](./US-010-register-with-email-verification.md) → [US-011](./US-011-log-in-stay-logged-in-log-out.md) → [US-012](./US-012-reset-forgotten-password.md) → [US-013](./US-013-change-password-and-profile.md) |
| M2 Tasks | [US-020](./US-020-create-and-edit-tasks.md) → [US-021](./US-021-move-tasks-on-the-board.md) → [US-022](./US-022-find-and-prioritise-tasks.md) |
| M3 Finance | [US-031](./US-031-manage-categories.md) → [US-030](./US-030-record-income-and-expenses.md) → [US-032](./US-032-see-where-my-money-goes.md) → [US-033](./US-033-import-bank-csv.md) |
| M4 Fixed expenses | [US-040](./US-040-track-recurring-bills.md) → [US-041](./US-041-email-reminders-before-bills-are-due.md) |
| M5 Dashboard and account | [US-050](./US-050-dashboard-at-a-glance.md) → [US-051](./US-051-export-my-data.md) → [US-052](./US-052-delete-my-account.md) → [US-054](./US-054-change-currency-before-data.md) |
| M6 Deploy and pilot | [US-060](./US-060-production-hardening.md) → [US-062](./US-062-operate-and-back-up.md) → [US-061](./US-061-deploy-on-free-hosting.md) → [US-063](./US-063-run-the-pilot.md) |
| Throughout | [US-070](./US-070-my-data-is-private.md) → [US-071](./US-071-phone-and-keyboard.md) |

Notes on the order: US-013 finishes in M5 (its Settings sections), US-053 finishes in M5 (the Appearance section), and US-031 comes before US-030 because a transaction needs a category. US-060 and US-062 come before US-061 because the deployment uses the hardening and the stats script.

## Stories by epic

### E0 Project setup

| Story | Title | Status | Priority | Size | Milestone | Tasks done | Depends on |
|---|---|---|---|---|---|---|---|
| [US-001](./US-001-repository-and-tooling-baseline.md) | Repository and tooling baseline | In Progress | Must | M | M0 | 5/8 | – |
| [US-002](./US-002-automated-tests-and-ci.md) | Automated tests and continuous integration | Ready | Must | M | M0 | 0/4 | US-001 |
| [US-003](./US-003-shared-backend-foundations.md) | Shared backend foundations | Ready | Must | M | M0 | 0/5 | US-001, US-002 |
| [US-004](./US-004-interface-shell.md) | Consistent dark-first interface shell | Ready | Must | L | M0 | 0/4 | US-001 |
| [US-005](./US-005-sleeping-server-handling.md) | Friendly handling of a sleeping free server | Ready | Must | M | M0 | 0/4 | US-004 |
| [US-006](./US-006-exact-money-and-dates.md) | Exact money and calendar-date handling | Ready | Must | S | M0 | 0/3 | US-001 |

### E1 Authentication

| Story | Title | Status | Priority | Size | Milestone | Tasks done | Depends on |
|---|---|---|---|---|---|---|---|
| [US-010](./US-010-register-with-email-verification.md) | Register with email verification | Ready | Must | L | M1 | 0/6 | US-003, US-004, US-005 |
| [US-011](./US-011-log-in-stay-logged-in-log-out.md) | Log in, stay logged in, and log out | Ready | Must | XL | M1 | 0/8 | US-010 |
| [US-012](./US-012-reset-forgotten-password.md) | Reset a forgotten password | Ready | Must | M | M1 | 0/2 | US-010 |
| [US-013](./US-013-change-password-and-profile.md) | Change my password and edit my profile | Ready | Must | S | M1 | 0/3 | US-011, US-004 |

### E2 Tasks (Kanban)

| Story | Title | Status | Priority | Size | Milestone | Tasks done | Depends on |
|---|---|---|---|---|---|---|---|
| [US-020](./US-020-create-and-edit-tasks.md) | Create and edit tasks | Ready | Must | L | M2 | 0/5 | US-011, US-004, US-006 |
| [US-021](./US-021-move-tasks-on-the-board.md) | Move tasks across the Kanban board | Ready | Must | XL | M2 | 0/6 | US-020 |
| [US-022](./US-022-find-and-prioritise-tasks.md) | Find and prioritise tasks | Ready | Should | M | M2 | 0/3 | US-020 |

### E3 Personal finance

| Story | Title | Status | Priority | Size | Milestone | Tasks done | Depends on |
|---|---|---|---|---|---|---|---|
| [US-030](./US-030-record-income-and-expenses.md) | Record income and expenses | Ready | Must | L | M3 | 0/6 | US-011, US-031, US-006 |
| [US-031](./US-031-manage-categories.md) | Organise spending with categories | Ready | Must | M | M3 | 0/2 | US-011 |
| [US-032](./US-032-see-where-my-money-goes.md) | Understand my spending with charts | Ready | Must | L | M3 | 0/4 | US-030, US-004 |
| [US-033](./US-033-import-bank-csv.md) | Import transactions from a bank CSV | Ready | Should | L | M3 | 0/4 | US-030, US-031 |

### E4 Fixed expenses and reminders

| Story | Title | Status | Priority | Size | Milestone | Tasks done | Depends on |
|---|---|---|---|---|---|---|---|
| [US-040](./US-040-track-recurring-bills.md) | Track recurring bills | Ready | Must | L | M4 | 0/7 | US-011, US-006 |
| [US-041](./US-041-email-reminders-before-bills-are-due.md) | Get email reminders before bills are due | Ready | Must | XL | M4 | 0/5 | US-040, US-003 |

### E5 Dashboard and account

| Story | Title | Status | Priority | Size | Milestone | Tasks done | Depends on |
|---|---|---|---|---|---|---|---|
| [US-050](./US-050-dashboard-at-a-glance.md) | See my day at a glance | Ready | Must | L | M5 | 0/3 | US-021, US-032, US-040 |
| [US-051](./US-051-export-my-data.md) | Export my data | Ready | Must | M | M5 | 0/4 | US-013, US-021, US-030, US-040 |
| [US-052](./US-052-delete-my-account.md) | Delete my account | Ready | Must | M | M5 | 0/3 | US-013, US-021, US-030, US-040 |
| [US-053](./US-053-choose-dark-or-light-theme.md) | Choose a dark or light theme | Ready | Must | S | M0 | 0/2 | US-004 |
| [US-054](./US-054-change-currency-before-data.md) | Change my currency before I have data | Ready | Could | S | M5 | 0/2 | US-013, US-030, US-040 |

### E6 Deployment and pilot

| Story | Title | Status | Priority | Size | Milestone | Tasks done | Depends on |
|---|---|---|---|---|---|---|---|
| [US-060](./US-060-production-hardening.md) | Production hardening | Ready | Must | M | M6 | 0/3 | US-041, US-052 |
| [US-061](./US-061-deploy-on-free-hosting.md) | Deploy on free hosting | Ready | Must | L | M6 | 0/6 | US-060, US-062 |
| [US-062](./US-062-operate-and-back-up.md) | Operate and back up the app | Ready | Must | M | M6 | 0/4 | US-060 |
| [US-063](./US-063-run-the-pilot.md) | Run the two-week pilot | Backlog | Must | L | M6 | 0/5 | US-061, US-062, US-070, US-071 |

### E7 Cross-cutting quality

| Story | Title | Status | Priority | Size | Milestone | Tasks done | Depends on |
|---|---|---|---|---|---|---|---|
| [US-070](./US-070-my-data-is-private.md) | My data is private to me | Ready | Must | L | M2-M5 | 0/7 | US-020, US-030, US-040 |
| [US-071](./US-071-phone-and-keyboard.md) | Usable on a phone and with a keyboard | Ready | Should | M | M0-M6 | 0/4 | US-004, US-021, US-032 |

## Sizes and priorities

| Size | Rough meaning |
|---|---|
| S | A few hours to a day, one slice, one or two tasks |
| M | One to two days, backend and frontend or several tasks |
| L | Several days, several tasks across both apps |
| XL | A week or more, or security critical enough to need every task reviewed carefully |

Priority follows the PRD: **Must** (the POC fails without it), **Should** (ship if time allows), **Could** (nice to have). Sizes are relative, not promises.

## PRD traceability

Every requirement in the [PRD](../PRD.md) and its success criteria maps to at least one story.

| PRD | Stories |
|---|---|
| AUTH-1 | [US-010](./US-010-register-with-email-verification.md) |
| AUTH-2 | [US-010](./US-010-register-with-email-verification.md) |
| AUTH-3 | [US-010](./US-010-register-with-email-verification.md) |
| AUTH-4 | [US-010](./US-010-register-with-email-verification.md) |
| AUTH-5 | [US-011](./US-011-log-in-stay-logged-in-log-out.md) |
| AUTH-6 | [US-011](./US-011-log-in-stay-logged-in-log-out.md) |
| AUTH-7 | [US-011](./US-011-log-in-stay-logged-in-log-out.md) |
| AUTH-8 | [US-011](./US-011-log-in-stay-logged-in-log-out.md) |
| AUTH-9 | [US-012](./US-012-reset-forgotten-password.md) |
| AUTH-10 | [US-013](./US-013-change-password-and-profile.md) |
| AUTH-11 | [US-013](./US-013-change-password-and-profile.md) |
| AUTH-12 | [US-054](./US-054-change-currency-before-data.md) |
| AUTH-13 | [US-010](./US-010-register-with-email-verification.md), [US-011](./US-011-log-in-stay-logged-in-log-out.md), [US-012](./US-012-reset-forgotten-password.md) |
| TASK-1 | [US-020](./US-020-create-and-edit-tasks.md) |
| TASK-2 | [US-021](./US-021-move-tasks-on-the-board.md) |
| TASK-3 | [US-021](./US-021-move-tasks-on-the-board.md) |
| TASK-4 | [US-020](./US-020-create-and-edit-tasks.md) |
| TASK-5 | [US-022](./US-022-find-and-prioritise-tasks.md) |
| TASK-6 | [US-022](./US-022-find-and-prioritise-tasks.md) |
| TASK-7 | [US-022](./US-022-find-and-prioritise-tasks.md) |
| TASK-8 | [US-021](./US-021-move-tasks-on-the-board.md) |
| FIN-1 | [US-030](./US-030-record-income-and-expenses.md) |
| FIN-2 | [US-006](./US-006-exact-money-and-dates.md), [US-030](./US-030-record-income-and-expenses.md) |
| FIN-3 | [US-031](./US-031-manage-categories.md) |
| FIN-4 | [US-030](./US-030-record-income-and-expenses.md) |
| FIN-5 | [US-032](./US-032-see-where-my-money-goes.md) |
| FIN-6 | [US-032](./US-032-see-where-my-money-goes.md) |
| FIN-7 | [US-032](./US-032-see-where-my-money-goes.md) |
| FIN-8 | [US-032](./US-032-see-where-my-money-goes.md) |
| FIN-9 | [US-032](./US-032-see-where-my-money-goes.md) |
| FIN-10 | [US-033](./US-033-import-bank-csv.md) |
| FIX-1 | [US-040](./US-040-track-recurring-bills.md) |
| FIX-2 | [US-040](./US-040-track-recurring-bills.md) |
| FIX-3 | [US-040](./US-040-track-recurring-bills.md) |
| FIX-4 | [US-041](./US-041-email-reminders-before-bills-are-due.md) |
| FIX-5 | [US-041](./US-041-email-reminders-before-bills-are-due.md) |
| FIX-6 | [US-041](./US-041-email-reminders-before-bills-are-due.md) |
| FIX-7 | [US-041](./US-041-email-reminders-before-bills-are-due.md) |
| FIX-8 | [US-041](./US-041-email-reminders-before-bills-are-due.md) |
| DASH-1 | [US-050](./US-050-dashboard-at-a-glance.md) |
| DASH-2 | [US-050](./US-050-dashboard-at-a-glance.md) |
| DASH-3 | [US-050](./US-050-dashboard-at-a-glance.md) |
| DASH-4 | [US-050](./US-050-dashboard-at-a-glance.md) |
| ACC-1 | [US-051](./US-051-export-my-data.md) |
| ACC-2 | [US-052](./US-052-delete-my-account.md) |
| ACC-3 | [US-013](./US-013-change-password-and-profile.md) |
| ACC-4 | [US-054](./US-054-change-currency-before-data.md) |
| UI-1 | [US-004](./US-004-interface-shell.md) |
| UI-2 | [US-053](./US-053-choose-dark-or-light-theme.md) |
| UI-3 | [US-004](./US-004-interface-shell.md) |
| UI-4 | [US-071](./US-071-phone-and-keyboard.md) |
| UI-5 | [US-005](./US-005-sleeping-server-handling.md) |
| UI-6 | [US-004](./US-004-interface-shell.md) |
| NFR-1 | [US-020](./US-020-create-and-edit-tasks.md), [US-070](./US-070-my-data-is-private.md) |
| NFR-2 | [US-003](./US-003-shared-backend-foundations.md), [US-060](./US-060-production-hardening.md) |
| NFR-3 | [US-003](./US-003-shared-backend-foundations.md), [US-060](./US-060-production-hardening.md) |
| NFR-4 | [US-062](./US-062-operate-and-back-up.md) |
| NFR-5 | [US-041](./US-041-email-reminders-before-bills-are-due.md) |
| NFR-6 | [US-003](./US-003-shared-backend-foundations.md), [US-006](./US-006-exact-money-and-dates.md) |
| NFR-7 | [US-002](./US-002-automated-tests-and-ci.md) |
| NFR-8 | [US-071](./US-071-phone-and-keyboard.md) |
| NFR-9 | [US-060](./US-060-production-hardening.md) |
| NFR-10 | [US-062](./US-062-operate-and-back-up.md) |
| S1 | [US-063](./US-063-run-the-pilot.md), [US-070](./US-070-my-data-is-private.md) |
| S2 | [US-041](./US-041-email-reminders-before-bills-are-due.md), [US-063](./US-063-run-the-pilot.md) |
| S3 | [US-063](./US-063-run-the-pilot.md) |
| S4 | [US-061](./US-061-deploy-on-free-hosting.md), [US-062](./US-062-operate-and-back-up.md), [US-063](./US-063-run-the-pilot.md) |
