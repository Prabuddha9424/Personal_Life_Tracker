# US-002: Automated tests and continuous integration

| | |
|---|---|
| **Status** | In Review |
| **Epic** | E0 Project setup |
| **Priority** | Must |
| **Size** | M |
| **Milestone** | M0 |
| **PRD** | NFR-7 |
| **Depends on** | [US-001](./US-001-repository-and-tooling-baseline.md) |

## User story

> **As** a developer, **I want** an in-memory database for tests and CI on every pull request, **so that** every change is proven by automatic checks before it is merged.

## Acceptance criteria

1. **Given** a backend test that needs MongoDB, **when** it runs, **then** it uses a throwaway in-memory database and leaves no data behind between tests.
2. **Given** a test that needs a signed-in user, **when** it asks for a test user, **then** it gets an id and a valid bearer token without creating a user row.
3. **Given** a pull request or a push to `main`, **when** CI runs, **then** lint, typecheck, tests and build run for both apps, and a failure blocks the merge.
4. **Given** a production build of the backend, **when** I inspect `dist/`, **then** it contains no test code or test helpers.

## Tasks

| ID | Task | Plan reference | Status |
|---|---|---|---|
| US-002-T1 | Add `mongodb-memory-server` (dev) and the `startTestDb`, `clearTestDb`, `stopTestDb` helpers with a test | [M0 Foundation](../plans/01-foundation.md), Task 2, steps 1-6 | Done |
| US-002-T2 | Add the `testUser()` helper with a test | [M0 Foundation](../plans/01-foundation.md), Task 2, steps 7-8 | Done |
| US-002-T3 | Raise the Vitest timeouts and exclude test files and `src/test` from the build | [M0 Foundation](../plans/01-foundation.md), Task 2, step 4 | Done |
| US-002-T4 | Add the GitHub Actions CI workflow for both apps and dry-run the same commands locally | [M0 Foundation](../plans/01-foundation.md), Task 12 | Done |

## Out of scope

Code coverage thresholds and end-to-end browser tests.

## Notes and risks

The first run downloads a `mongod` binary (about 100 MB); hooks have a 120 s timeout for that.

## Definition of Done

The shared [Definition of Done](./README.md#definition-of-done) applies, plus every acceptance criterion demonstrated:

- [x] Acceptance criterion 1
- [x] Acceptance criterion 2
- [ ] Acceptance criterion 3
- [x] Acceptance criterion 4
