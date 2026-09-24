# US-011: Log in, stay logged in, and log out

| | |
|---|---|
| **Status** | In Review |
| **Epic** | E1 Authentication |
| **Priority** | Must |
| **Size** | XL |
| **Milestone** | M1 |
| **PRD** | AUTH-5, AUTH-6, AUTH-7, AUTH-8, AUTH-13 |
| **Depends on** | [US-010](./US-010-register-with-email-verification.md) |

## User story

> **As** a registered user, **I want** to log in, stay logged in across reloads and tabs, and log out when I choose, **so that** I do not have to sign in constantly and my session stays safe.

## Acceptance criteria

1. **Given** a verified account, **when** I log in with the right email and password, **then** I get a short-lived access token held only in memory and an httpOnly refresh cookie; a wrong password or unknown email gives the same generic message, and an unverified account is told to verify only after the password was right.
2. **Given** I am logged in, **when** I reload the page or open a second tab, **then** my session is restored silently and I am not logged out.
3. **Given** my access token has expired, **when** I use the app, **then** it is refreshed once, transparently, and the request is retried; if the refresh fails I am sent to the login page.
4. **Given** a used refresh token is presented again, **when** more than 10 seconds after it was rotated, **then** the whole session family is revoked; within 10 seconds (two tabs restoring at once) it is only refused and my session survives.
5. **Given** I log out, **when** I press the button, **then** the cookie is cleared, the session ends and every cached query is dropped, so the next person on this browser sees none of my data.
6. **Given** I inspect the browser storage, **when** I look at localStorage, sessionStorage and cookies, **then** the access token is in none of them, and the refresh cookie is httpOnly, secure in production and scoped to `/api/auth`.

## Tasks

| ID | Task | Plan reference | Status |
|---|---|---|---|
| US-011-T1 | Add `authUserId` (shared) and `GET /auth/me` | [M1 Auth](../plans/02-auth.md), Task 4 | Done |
| US-011-T2 | Add login, rotating refresh tokens with reuse detection and grace period, and logout, with tests | [M1 Auth](../plans/02-auth.md), Task 5 | Done |
| US-011-T3 | Expose the auth slice's public API for other slices (`getUserProfile`, `verifyPassword`, `setUserCurrency`, `deleteUser`, `clearRefreshCookie`) | [M1 Auth](../plans/02-auth.md), Task 7 | Done |
| US-011-T4 | Make the shared HTTP client refresh the session once on a 401 and retry, and show plain error messages | [M1 Auth](../plans/02-auth.md), Task 8 | Done |
| US-011-T5 | Add the session store, API functions, single-flight refresh, bootstrap and hooks, with tests including cache clearing | [M1 Auth](../plans/02-auth.md), Task 9 | Done |
| US-011-T6 | Add the login page and its tests (including clearing a previous user's cache) | [M1 Auth](../plans/02-auth.md), Task 10 (login page) | Done |
| US-011-T7 | Add route guards, session gate, user menu and wire them into the app | [M1 Auth](../plans/02-auth.md), Task 12 | Done |
| US-011-T8 | Walk log in, reload, two tabs and log out in a real browser; inspect storage and cookies | [M1 Auth](../plans/02-auth.md), Task 13 | To do |

## Out of scope

"Remember me" options and device management.

## Notes and risks

Sessions across the Netlify and Render hosts rely on the same-origin `/api` rewrite; see US-061.

## Definition of Done

The shared [Definition of Done](./README.md#definition-of-done) applies, plus every acceptance criterion demonstrated:

- [x] Acceptance criterion 1
- [ ] Acceptance criterion 2
- [x] Acceptance criterion 3
- [x] Acceptance criterion 4
- [x] Acceptance criterion 5
- [ ] Acceptance criterion 6
