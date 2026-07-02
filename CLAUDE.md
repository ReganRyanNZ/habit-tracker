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

# View database in browser
npx prisma studio
```

## Make notes while working

Our context window is small. When doing tasks, it is better to write out workflows/to do lists/etc into files in `tmp/ai_notes`, so it can be recorded in a file instead of held in active memory.

## Architecture Overview

This is a **collaborative offline-first habit tracker PWA** built with Next.js 15, React 19, TypeScript, and Tailwind CSS. The core architectural pattern is **dual storage with background sync**.

### Dual Storage Pattern

The app uses two storage layers simultaneously:

1. **Server (source of truth)**: Prisma ORM → SQLite (`prisma/dev.db`)
   - Managed via API routes at `/api/sheet/[slug]`
   - Supports multi-user collaboration via shareable URL slugs

2. **Client (offline cache)**: Dexie → IndexedDB (browser storage)
   - Defined in `lib/db-local.ts`
   - Enables full offline functionality

**Data Flow**: On page load (`app/[slug]/page.tsx`), the app:
- First loads from IndexedDB for instant display
- Then fetches from API and updates IndexedDB
- Continues to sync changes in background (every 30s or when online)

### Key Data Models

**Prisma Schema** (`prisma/schema.prisma`):
- `HabitSheet`: Container for habits, has unique slug for sharing
- `Habit`: Individual habits with `completions` stored as JSON string (Map<dateKey, boolean>)

**Dexie Schema** (`lib/db-local.ts`):
- Mirrors Prisma models but with native JS objects (completions as Objects, not strings)
- Includes `syncQueue` table for offline change tracking

### Sync & Conflict Resolution

**Conflict Detection** (`app/api/sheet/[slug]/route.ts`):
- Compares client `updatedAt` with server `updatedAt`
- Returns HTTP 409 if server has newer changes
- On conflict, client reloads from server (last-write-wins for now)

**Local Habit IDs**: Newly created habits use `local-${timestamp}` IDs; server assigns real IDs on sync.

### PWA Configuration

Service worker and manifest configured via `next-pwa` in `next.config.js`. Disabled in development, enabled in production.

## Component Structure

```
app/[slug]/page.tsx          # Main sheet page, manages sync state
  └─ HabitGrid              # Main grid view, groups habits
      └─ HabitRow           # Individual habit row with completion toggles
  └─ AddHabitDialog         # Modal for adding new habits
  └─ ViewToggle             # Week/month view switcher
```

All components in `app/components/` are app-specific. Shared UI components live in `components/ui/` (shadcn/ui).

## Important Implementation Notes

- **Date keys are local time**, not UTC - stored as YYYY-MM-DD strings via `formatDateKey()` in `lib/utils.ts`
- **No authentication** - anyone with the slug can view/edit; access control via slug obscurity only
- **State management** uses local React state with direct IndexedDB manipulation (Zustand is installed but unused)
- **Habit ordering** is maintained via `order` field; UI updates this on drag/move operations
- **Group renaming** updates all habits in that group; groups are virtual (not separate entities)

## Environment

Database URL configured in `.env` (default: `file:./dev.db`). The Prisma client singleton pattern in `lib/db.ts` prevents multiple instances in development.

