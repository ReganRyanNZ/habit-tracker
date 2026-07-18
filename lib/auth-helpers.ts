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
