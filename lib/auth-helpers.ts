import { clerkClient } from '@clerk/nextjs/server'
import { prisma } from '@/lib/db'

/**
 * Ensure a User row exists for the given Clerk userId.
 *
 * The `User` table is the foreign-key target for `HabitGroup` and `Follow`, so a
 * row must exist before any user-owned record can be created. Clerk manages auth
 * separately and does not provision rows into our database (there is no webhook),
 * so we upsert lazily here on first authenticated write. Without this, a new
 * user's first request fails with a Postgres FK constraint violation and their
 * group is never created.
 */
export async function ensureUserExists(userId: string): Promise<void> {
  await prisma.user.upsert({
    where: { id: userId },
    create: { id: userId },
    update: {},
  })
}

/**
 * Best-effort display name for a user, sourced from Clerk.
 *
 * Used as the default habit-group name so a shared/followed group is recognizable
 * as a *person* rather than a generic "My Habits". Falls back gracefully through
 * every field Clerk might have, then to "My Habits" if nothing is set.
 */
export async function getUserDisplayName(userId: string): Promise<string> {
  try {
    const client = await clerkClient()
    const user = await client.users.getUser(userId)
    const first = user.firstName?.trim()
    const last = user.lastName?.trim()
    if (first && last) return `${first} ${last}`
    if (first) return first
    if (last) return last
    if (user.username) return user.username
    const email = user.primaryEmailAddress?.emailAddress
    if (email) return email.split('@')[0]
    return 'My Habits'
  } catch {
    return 'My Habits'
  }
}
