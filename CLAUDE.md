# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
# Start development server
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Run linter
npm run lint

# Regenerate Prisma client (after schema changes)
npx prisma generate

# Push schema to the database (this repo uses `db push`, not migrations)
npx prisma db push

# View database in browser
npx prisma studio
```

## Make notes while working

Our context window is small. When doing tasks, it is better to write out workflows/to do lists/etc into files in `tmp/ai_notes`, so it can be recorded in a file instead of held in active memory.

## Architecture Overview

This is a **collaborative offline-first habit tracker PWA** built with Next.js 15 (App Router), React 19, TypeScript, and Tailwind CSS. Auth is **Clerk**; the database is **PostgreSQL via Prisma** (Vercel Postgres). The core pattern is **dual storage with action-based background sync**.

### Auth (Clerk)

- `middleware.ts` runs `clerkMiddleware()` (all routes public; gating is per-route via `auth()`).
- The Clerk user ID is the primary key of the `User` table.
- **There is no Clerk webhook.** `User` rows are created lazily by `ensureUserExists(userId)` in `lib/auth-helpers.ts`, called on the authenticated write routes. Do not assume a `User` row exists for a freshly signed-up user — always `ensureUserExists` before creating any user-owned row (`HabitGroup`, `Follow`), or the Postgres foreign-key constraint will reject it.

### Dual Storage Pattern

1. **Server (source of truth)**: Prisma → PostgreSQL (`DATABASE_URL`)
   - API routes under `app/api/...`
2. **Client (offline cache)**: Dexie → IndexedDB (`lib/db-local.ts`)
   - Enables full offline functionality

**Data flow** (`app/page.tsx`):
- On load, render instantly from IndexedDB, then POST pending actions to the server and adopt the returned base state.
- User edits are queued as **actions** and applied optimistically (`displayHabits = baseHabits + pendingActions`); the background sync POSTs the queue and clears the synced actions on success.

### Key Data Models (`prisma/schema.prisma`)

- `User` — Clerk user. `id` = Clerk user ID.
- `HabitGroup` — one per user (`userId @unique`). Has `name` and a unique `shareToken` for sharing.
- `Habit` — belongs to a `HabitGroup`. `completions` is a JSON string of `{ [dateKey]: { completed, timestamp } }`. Ordered by `order`.
- `Follow` — a user follows another user's `HabitGroup` (view-only). `@@unique([userId, groupId])`.

### Sync & Conflict Resolution (`app/api/user/group/habits/route.ts`)

- Client POSTs `{ actions, lastSyncAt }`. The server sorts actions by `timestamp` and applies each to the DB, then returns the fresh `{ habits, group, serverTimestamp }` as the new base state.
- Actions are idempotent-ish: `create_habit` skips if the id exists; `rename_habit`/`toggle_completion` apply only if the action timestamp is newer than the stored `updatedAt`/completion timestamp (last-write-wins by timestamp).
- Local habit IDs use `local-${timestamp}`; the server uses the client-provided `id` directly (no remapping), so the same id is stable across client and server.

Action types are defined in both `lib/db-local.ts` (`Action`) and the sync route (`type Action`) — **keep them in sync** when adding/changing an action.

### API Routes

- `GET/POST /api/user/group` — get-or-create the caller's group / rename it.
- `POST /api/user/group/habits` — apply queued actions, return base state (the main sync endpoint).
- `GET /api/user/following` — list groups the caller follows (with habits).
- `GET /POST /api/share/[token]` — view a shared group by token / follow or unfollow it.

### Component Structure

```
app/page.tsx                 # Main page: owns sync state, action handlers
  └─ HabitGrid               # Unified grid; sections per group (mine first, then followed)
      └─ HabitRow            # One habit row with completion toggles, inline rename, reorder
  └─ AddHabitDialog          # Modal for adding a habit
app/share/[token]/page.tsx   # View a shared group and follow/unfollow
```

Shared UI (Dialog, Button, etc.) lives in `components/ui/` (shadcn/ui). App components are in `app/components/`.

## Important Implementation Notes

- **Date keys are local time**, stored as `YYYY-MM-DD` via `formatDateKey()` in `lib/utils.ts` — not UTC.
- **State management** is local React state + direct IndexedDB manipulation (Zustand is installed but unused).
- **Habit ordering** is maintained via the `order` field; reorder actions rewrite `order` for all habits in the group.
- **`syncingRef`** guards against concurrent syncs; the 30s interval polls followed groups, and coming back online triggers a sync.
