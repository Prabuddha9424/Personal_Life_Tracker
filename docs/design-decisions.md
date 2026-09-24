# Personal Life Tracker: Design Decisions

Companion to [`PRD.md`](./PRD.md). Records the product and visual decisions made during requirements brainstorming on 2026-09-24, so the reasoning survives after the chat.

## 1. Decision log

| Topic                         | Decision                                                                                               | Alternatives considered                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| POC purpose                   | Real daily use by a small circle **and** validating as a real product                                  | Portfolio demo, learning exercise                            |
| Reminder channel              | **Email only**                                                                                         | In-app only, web push                                        |
| Fixed-expense link to finance | **Standalone** reminders, no mark-as-paid or auto-posting                                              | Mark paid creates a transaction, auto-post on due date       |
| Recurrence                    | Weekly, monthly, yearly                                                                                | Monthly only, fully custom                                   |
| Reminder timing               | Per-expense lead time (default 3 days)                                                                 | Global setting, fixed schedule                               |
| Hosting                       | Split: **Netlify** free (frontend, proxy rewrite) + **Render** free (backend) + **Atlas** free cluster | All on Vercel, all on Render                                 |
| Email provider                | **Brevo** SMTP relay on port 2525 (Render blocks 25, 465, 587)                                         | Resend (needs a verified domain), Gmail SMTP (blocked ports) |
| Scheduler                     | GitHub Actions daily cron calling a secret-protected endpoint                                          | External pinger, in-process timer                            |
| Board model                   | One board, fixed columns (To Do, In Progress, Done)                                                    | Custom columns, multiple boards                              |
| Task fields                   | Description, due date, priority, tags                                                                  |                                                              |
| Finance categories            | Preset defaults plus user-defined                                                                      | Preset only, free text                                       |
| Currency                      | One per user, chosen at signup                                                                         | Per transaction, full conversion                             |
| Charts                        | Summary cards, category doughnut, income vs expenses bars, net trend line                              |                                                              |
| Sign-up                       | Open, with email verification                                                                          | Open without verification, invite-only                       |
| Sessions                      | Refresh cookie plus same-origin proxy rewrite                                                          | Cross-site cookie, no refresh token                          |
| Account and data              | Export, delete account, change password and profile, CSV import                                        |                                                              |
| Success criteria              | Tenant-isolation tests, reminders on time, real usage for 2+ weeks, $0 budget holds                    |                                                              |
| App layout                    | **A: sidebar with a "Today" dashboard**                                                                | B: top tabs board-first, C: mobile bottom nav                |
| Visual style                  | **Dark-first**                                                                                         | Clean light, warm and friendly                               |
| Theme switching               | Dark by default with a manual toggle                                                                   | Dark only, follow system                                     |

## 2. Layout (option A)

Wireframe of the desktop layout. On phone width the sidebar collapses to a drawer (UI-1).

```
+---------------+--------------------------------------------------------+
| Tracker       |  Today                                    [theme] [me] |
|               |                                                        |
| > Dashboard   |  +----------------+ +----------------+ +-------------+ |
|   Board       |  | Tasks due      | | Net this month | | Next bills  | |
|   Finance     |  | this week: 3   | | +$420.00       | | Rent, 2 d   | |
|   Bills       |  | (1 overdue)    | |                | | Netflix, 5 d| |
|   Settings    |  +----------------+ +----------------+ +-------------+ |
|               |                                                        |
|               |  +--------------------------+ +----------------------+ |
|               |  | Spending by category     | | Income vs expenses   | |
|               |  |        (doughnut)        | |     (bars, 6 mo)     | |
|               |  +--------------------------+ +----------------------+ |
+---------------+--------------------------------------------------------+
```

Screens to design and build:

| Screen                                                         | Contents                                                                                                       |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Register, Verify email, Login, Forgot password, Reset password | Centred form cards. Verify shows a "check your inbox" state and a resend action.                               |
| Dashboard                                                      | The three cards and two mini-charts above, each linking to its page.                                           |
| Board                                                          | Three columns of cards, filter by tag, search, and a "New task" action.                                        |
| Finance                                                        | Summary cards, month picker, the three charts, transaction list with filters, "Add transaction", "Import CSV". |
| Bills                                                          | Table sorted by next due date, with "due in N days" status, and an add/edit form.                              |
| Settings                                                       | Profile, change password, theme toggle, export, delete account (in a clearly separated danger zone).           |

Every data screen needs loading, empty and error states (UI-3).

## 3. Visual style (dark-first)

Starting palette taken from the approved mockup. These are **starting values**: final colours must pass WCAG AA contrast in both themes (NFR-8) and get a chart palette that is distinguishable for colour-blind users, so expect small tweaks during implementation.

| Token             | Dark value | Use                                                                              |
| ----------------- | ---------- | -------------------------------------------------------------------------------- |
| `--bg`            | `#0f1420`  | App background                                                                   |
| `--surface`       | `#1a2133`  | Cards, panels, sidebar                                                           |
| `--border`        | `#2a3350`  | Card and divider borders (decorative, no contrast requirement)                   |
| `--border-strong` | `#68749a`  | Form-control borders (WCAG 1.4.11, 3:1): 3.99:1 on `--bg`, 3.48:1 on `--surface` |
| `--text`          | `#e6eaf5`  | Primary text                                                                     |
| `--text-muted`    | `#8b95b3`  | Secondary text, due dates                                                        |
| `--accent`        | `#9fb0ff`  | Links, focus rings, tags (on `#232c4a`)                                          |
| `--danger`        | `#ff8a94`  | High priority, overdue (on `#4a1d24`)                                            |
| `--positive`      | `#4ade80`  | Positive net, income                                                             |

The light theme palette is defined in the design tokens during M0. Its `--border-strong` is `#7a869e` (3.42:1 on `--bg` `#f6f7f9`, 3.66:1 on `--surface` `#ffffff`). Tokens are CSS custom properties, switched by a `data-theme` attribute on the root element, so components never hard-code colours.

Card anatomy (Kanban): title, priority chip (top right), due date line (turns danger-coloured when overdue), tag chips at the bottom.

## 4. Mockup references

The interactive wireframes and style comparison used for these decisions are saved locally in `.superpowers/brainstorm/` (git-ignored). They are not part of the deliverable.
