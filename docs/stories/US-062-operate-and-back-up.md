# US-062: Operate and back up the app

| | |
|---|---|
| **Status** | Ready |
| **Epic** | E6 Deployment and pilot |
| **Priority** | Must |
| **Size** | M |
| **Milestone** | M6 |
| **PRD** | NFR-4, NFR-10, S4 |
| **Depends on** | [US-060](./US-060-production-hardening.md) |

## User story

> **As** the operator, **I want** usage counts, backups and a weekly checklist, **so that** I can run the pilot, keep data safe and stay inside the free limits.

## Acceptance criteria

1. **Given** the production database, **when** I run the stats script, **then** I get user, verified, active (7 and 14 days) and content counts, and never an email, name, title, note or id.
2. **Given** no backups on the free database, **when** I follow the runbook, **then** I can take a dump and restore it into a scratch database, and the restore is checked.
3. **Given** each week, **when** I follow the checklist, **then** I check emails sent, Netlify credits, Render hours, Atlas usage and that the daily workflow ran.
4. **Given** the deployed site, **when** I measure it, **then** warm API answers are under 300 ms at pilot data sizes and the first paint is under 2 s on a mid-range phone over 4G.
5. **Given** a secret must change, **when** I follow the rotation table, **then** the app keeps working.

## Tasks

| ID | Task | Plan reference | Status |
|---|---|---|---|
| US-062-T1 | Add the counts-only usage statistics script and its npm scripts, with tests including the no-content check | [M6 Deploy and pilot](../plans/07-deploy-pilot.md), Task 2 | To do |
| US-062-T2 | Take and test-restore a backup | [M6 Deploy and pilot](../plans/07-deploy-pilot.md), Task 6, step 5 | To do |
| US-062-T3 | Measure warm response times and first paint on the deployed site and record them | [M6 Deploy and pilot](../plans/07-deploy-pilot.md), Task 6, step 2 (add to the smoke-test notes) | To do |
| US-062-T4 | Set up the optional keep-alive ping if cold starts hurt daily use | [M6 Deploy and pilot](../plans/07-deploy-pilot.md), Task 6, step 6 | To do |

## Out of scope

Dashboards, alerting and log shipping.

## Notes and risks

Free Render has no shell, so the stats script and backups are run from the operator's computer against the Atlas connection string.

## Definition of Done

The shared [Definition of Done](./README.md#definition-of-done) applies, plus every acceptance criterion demonstrated:

- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2
- [ ] Acceptance criterion 3
- [ ] Acceptance criterion 4
- [ ] Acceptance criterion 5
