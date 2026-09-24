# Personal Life Tracker (Task + Finance + Auth System)

A multi-tenant MERN app for personal tasks (Kanban), finances, and fixed expenses, with JWT auth.

## Architecture: Vertical Slice (NON-NEGOTIABLE)

The codebase is organised **by feature, not by technical layer**. Each feature ("slice") owns everything it needs end to end: routes, controller, service, model, validation, types, and tests.

- **Never** create top-level `controllers/`, `models/`, `services/`, or `routes/` folders.
- A new feature = a new folder under `features/`. A change to a feature should stay inside that folder.
- Slices talk to each other **only through the other slice's `index.ts` public API**. Never deep-import another slice's internals (e.g. `features/tasks/task.model.ts` from `features/finance`).
- `shared/` holds code with no feature knowledge (config, db, mailer, middleware, UI primitives). **`shared/` must never import from `features/`.**
- Prefer a little duplication between slices over a premature shared abstraction. Promote to `shared/` only once 3+ slices need it.

## Tech Stack (latest stable majors)

Before adding or upgrading a dependency, check the current version with `npm view <pkg> version` and use the latest stable release. Do not add packages outside this list without asking.

| Area | Choice |
|------|--------|
| Runtime | Node.js 24 LTS (`.nvmrc`), ES Modules (`"type": "module"`) |
| Language | TypeScript 6.0 (strict) in both apps. **Stay on `~6.0` until typescript-eslint supports TS 7.** |
| Backend | Express 5, Mongoose 9, Zod 4, Nodemailer, bcryptjs, jsonwebtoken, helmet, cors, express-rate-limit, pino + pino-http |
| Frontend | React 19, Vite 8 (not CRA; it's deprecated), React Router 8, TanStack Query v5, Zustand 5, Axios, Chart.js 4 + react-chartjs-2, @hello-pangea/dnd, React Hook Form + Zod 4 |
| Testing | Vitest 5 (both apps), Supertest (API), React Testing Library + jsdom (UI). Add mongodb-memory-server when the first DB-backed slice lands. |
| Tooling | ESLint 10 (flat config `eslint.config.js`) + typescript-eslint, Prettier. ESLint enforces the slice import boundaries. |

### Conventions

- **Backend** runs `.ts` directly with Node's built-in type stripping (no tsx/ts-node) and builds to `dist/` with `tsc`. Therefore:
  - Relative imports **must include the `.ts` extension** (`import { app } from './app.ts'`); tsc rewrites them to `.js`.
  - Only erasable TypeScript syntax is allowed: **no `enum`, `namespace`, or constructor parameter properties** (`erasableSyntaxOnly`). Use `as const` objects or union types.
- **Frontend** imports use the `@/` alias for `src/` (`@/shared/api/httpClient`). Inside a slice, use relative imports.

## Repository Structure

```
backend/
  src/
    app.ts                  # Express app setup (middleware, mounts feature routers)
    server.ts               # Entry point: env check, DB connect, listen
    features/
      auth/
        auth.routes.ts      # Router for /api/auth
        auth.controller.ts  # HTTP in/out only, no business logic
        auth.service.ts     # Business logic
        auth.schemas.ts     # Zod request schemas
        user.model.ts       # Mongoose model owned by this slice
        auth.test.ts
        index.ts            # Public API of the slice (router + anything others may use)
      tasks/                # same shape
      finance/              # same shape
      fixed-expenses/       # same shape
      health/               # GET /api/health (reference slice)
    shared/
      config/env.ts         # Zod-validated process.env, fail fast on startup
      auth/token.ts         # signAccessToken / verifyAccessToken (JWT)
      db/connect.ts         # Mongo connection
      logger/logger.ts      # pino (never use console.*)
      mailer/mailer.ts      # sendMail() over Nodemailer
      middleware/           # requireAuth, validate({ body, params, query }), authRateLimiter, errorHandler, notFound
      errors/AppError.ts
    types/express.d.ts      # req.user typing
frontend/
  src/
    app/                    # App root, router, providers (QueryClient, etc.)
    features/
      auth/
        api/                # Axios calls + TanStack Query hooks (useLogin, ...)
        components/
        pages/
        store/              # Zustand store (only if the slice needs client state)
        routes.ts           # RouteObject[] using route-level `lazy`
        types.ts
        index.ts            # Public API (routes, hooks exposed to others)
      tasks/  finance/  fixed-expenses/  dashboard/
    shared/
      api/httpClient.ts     # Single Axios instance; auth slice plugs in via configureAuth()
      config/env.ts         # Zod-validated import.meta.env
      lib/queryClient.ts
      ui/                   # Reusable presentational components
    test/setup.ts           # Vitest + jest-dom setup
```

## Development & Build Commands

### Backend (`cd backend`)

- Install: `npm install`
- Setup: `cp .env.example .env` (needs a running MongoDB)
- Dev server: `npm run dev` (port 5000, `node --watch`)
- Build: `npm run build` · Start (prod): `npm start`
- Test: `npm test`
- Lint: `npm run lint` · Type check: `npm run typecheck`

### Frontend (`cd frontend`)

- Install: `npm install`
- Dev server: `npm run dev` (Vite, port 5173, proxies `/api` to port 5000)
- Build: `npm run build` · Preview: `npm run preview`
- Test: `npm test`
- Lint: `npm run lint` · Type check: `npm run typecheck`

## Dos

### Workflow
- **Create a new branch before any new development**: `feature/<slice>-<short-desc>`, `fix/<short-desc>`, `chore/<short-desc>`. Never commit directly to `main`.
- Use Conventional Commits: `feat(tasks): add drag-and-drop reorder`.
- After writing code, **always run `npm run lint`, `npm run typecheck`, and `npm test`** in the affected app and fix every failure before finishing.
- Add or update tests in the same slice for every behaviour change.

### Backend
- **Multi-tenancy**: scope EVERY query on tasks, finance, and fixed expenses to the authenticated user (`userId: req.user.id`), including `findOne`, `updateOne`, `deleteOne`, and aggregations. Look up by `{ _id, userId }`, never by `_id` alone.
- Index `userId` (and common compound filters like `{ userId: 1, date: -1 }`) on every tenant-owned collection.
- Validate every request body, params, and query with a Zod schema via the `validate` middleware before it reaches the controller.
- Hash passwords in a Mongoose `pre('save')` hook with bcryptjs (cost ≥ 12). Set `select: false` on the password field.
- Password reset: generate with `crypto.randomBytes(32)`, email the raw token, store only its **SHA-256 hash** with a short expiry (≤ 15 min), single use.
- Keep JWT access tokens short-lived (~15 min). Read secrets from the validated env only.
- Apply `helmet`, a whitelisted `cors` origin, and `express-rate-limit` on auth endpoints.
- Store money as **integers in minor units** (cents) and store a currency code. Store dates in UTC.
- Throw `new AppError(status, message)` from services and let the central `errorHandler` respond. Express 5 forwards rejected async handlers automatically, so no try/catch boilerplate is needed in controllers.
- Error response format is always `{ "message": "Error description" }` (validation errors may add an `errors` array).
- Use proper HTTP status codes (201 create, 204 delete, 400/401/403/404/409/422, 500).
- Use `.lean()` for read-only queries and paginate list endpoints.

### Frontend
- Fetch all server state with TanStack Query. Keep Zustand for client-only state (auth session, UI preferences).
- Use the single shared Axios instance (`httpClient`). The auth slice supplies the token getter and 401 handler via `configureAuth()`.
- Co-locate query keys with the slice (`taskKeys.all`, `taskKeys.detail(id)`) and invalidate them after mutations.
- Build forms with React Hook Form + Zod and show loading, error, and empty states on every data view.
- Lazy-load feature pages with the route-level `lazy` property in each slice's `routes.ts`.

## Don'ts

- **Don't** break vertical slicing: no layer-based folders, no deep cross-slice imports, no `shared/` → `features/` imports.
- **Don't** run a database query on tenant data without a `userId` filter, and don't trust a `userId` sent by the client.
- **Don't** return password hashes, reset tokens, or internal error stacks in API responses, and don't log secrets or tokens.
- **Don't** reveal whether an email exists (login and forgot-password return generic messages).
- **Don't** store JWTs in `localStorage`. Keep the access token in memory; use an `httpOnly`, `secure`, `sameSite` cookie if a refresh token is added.
- **Don't** commit `.env` files. Keep an up-to-date `.env.example` in each app.
- **Don't** use `any` in TypeScript, `var`, CommonJS `require`, or floating-point numbers for money.
- **Don't** copy server data into Zustand or `useState`; read it from TanStack Query.
- **Don't** use Create React App or deprecated packages. Don't add a dependency without checking it's maintained and at its latest stable version.
- **Don't** leave `console.log`, commented-out code, or unused exports behind. Use the logger on the backend.
- **Don't** finish a task with failing lint, type checks, or tests.
