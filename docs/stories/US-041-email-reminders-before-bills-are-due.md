# US-041: Get email reminders before bills are due

| | |
|---|---|
| **Status** | Ready |
| **Epic** | E4 Fixed expenses and reminders |
| **Priority** | Must |
| **Size** | XL |
| **Milestone** | M4 |
| **PRD** | FIX-4, FIX-5, FIX-6, FIX-7, FIX-8, NFR-5, S2 |
| **Depends on** | [US-040](./US-040-track-recurring-bills.md), [US-003](./US-003-shared-backend-foundations.md) |

## User story

> **As** a user with bills, **I want** an email a few days before each bill is due, **so that** I pay on time without checking the app.

## Acceptance criteria

1. **Given** a bill with a 3-day lead time, **when** the daily job runs on the day that is 3 days before it is due, **then** I get one email naming the bill, the amount, the date and a link to the Bills page, and nothing else.
2. **Given** the job runs again the same day, or twice at once, **when** it looks at the same bill, **then** no second email is sent.
3. **Given** the job missed several days and a bill became overdue, **when** it runs, **then** I get exactly one email, and the bill moves to its next occurrence on or after today (a weekly bill lands on the right weekday).
4. **Given** the mail provider fails, **when** the job runs, **then** the failure is counted, an overdue bill is not advanced, and the next run sends the email.
5. **Given** a bill is paused or its reminders are off, **when** the job runs, **then** no email is sent, and a bill with reminders off still moves on after its due date.
6. **Given** two users have bills, **when** the job runs, **then** each gets an email only about their own bills, in their own currency.
7. **Given** the reminder endpoint, **when** it is called without the secret, with a wrong secret, or with a normal user's token, **then** it answers 401 and does nothing; with the right secret it answers only counts.
8. **Given** the backend is asleep at 01:17 UTC, **when** the scheduled workflow runs, **then** it retries for several minutes until the backend answers, and the job is safe to retry.

## Tasks

| ID | Task | Plan reference | Status |
|---|---|---|---|
| US-041-T1 | Add the reminder email (single-line subject, amount formatting, throws on failure) with tests | [M4 Fixed expenses](../plans/05-fixed-expenses.md), Task 4 | To do |
| US-041-T2 | Add the idempotent job: claim then send, release on failure, catch-up, advance, batching by id, with tests for every rule | [M4 Fixed expenses](../plans/05-fixed-expenses.md), Task 5 | To do |
| US-041-T3 | Add the protected endpoint (cron secret, rate limit) and the daily GitHub Actions workflow with retries | [M4 Fixed expenses](../plans/05-fixed-expenses.md), Task 6 | To do |
| US-041-T4 | Run the job by hand against a mail catcher and check content, repeat runs, failures and the 401 cases | [M4 Fixed expenses](../plans/05-fixed-expenses.md), Task 11 | To do |
| US-041-T5 | Prove the scheduler on the real deployment: a manual run, a repeat run and one real scheduled run | [M6 Deploy and pilot](../plans/07-deploy-pilot.md), Task 6, step 3 | To do |

## Out of scope

Push, SMS and per-user reminder times (the run time is fixed at 01:17 UTC).

## Notes and risks

The reminder day is the UTC day of the run, so a user far from UTC may get an email a few hours early or late (PRD question Q3).

## Definition of Done

The shared [Definition of Done](./README.md#definition-of-done) applies, plus every acceptance criterion demonstrated:

- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2
- [ ] Acceptance criterion 3
- [ ] Acceptance criterion 4
- [ ] Acceptance criterion 5
- [ ] Acceptance criterion 6
- [ ] Acceptance criterion 7
- [ ] Acceptance criterion 8
