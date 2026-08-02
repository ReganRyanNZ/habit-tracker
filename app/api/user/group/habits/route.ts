import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/db'
import { ensureUserExists, getUserDisplayName, getUserEmail } from '@/lib/auth-helpers'
import { randomUUID } from 'crypto'

// Action type definition (must match client)
type Action =
  | { type: 'create_habit'; id: string; name: string; order: number; timestamp: number }
  | { type: 'rename_habit'; id: string; name: string; timestamp: number }
  | { type: 'delete_habit'; id: string; timestamp: number }
  | { type: 'toggle_completion'; id: string; dateKey: string; state: 'grey' | 'green' | 'clear'; timestamp: number }
  | { type: 'reorder_habit'; id: string; order: number; timestamp: number }

export async function GET() {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Get user's habit group
    const group = await prisma.habitGroup.findUnique({
      where: { userId },
      include: { habits: true },
    })

    if (!group) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 })
    }

    // Parse completions from strings to objects
    const habits = group.habits.map(h => ({
      ...h,
      completions: JSON.parse(h.completions || '{}'),
    }))

    return NextResponse.json({ habits, group })
  } catch (error) {
    console.error('Failed to fetch habits:', error)
    return NextResponse.json({ error: 'Failed to fetch habits' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { actions } = await request.json()

    // Ensure the User row exists (it's the FK target for HabitGroup), then
    // get-or-create the group. This is what lets brand-new users use the app
    // on first load — without ensureUserExists, the create below throws a
    // Postgres foreign-key violation because no User row exists yet.
    await ensureUserExists(userId)
    // One-time dev→prod Clerk migration: re-parent this user's old data (keyed to
    // their dev user ID) onto their current user ID, matched by email. No-op unless
    // CLERK_MIGRATION_MAP is set; safe to re-run.
    await selfHealMigration(userId)

    let group = await prisma.habitGroup.findUnique({ where: { userId } })
    if (!group) {
      group = await prisma.habitGroup.create({
        data: {
          userId,
          name: await getUserDisplayName(userId),
          shareToken: randomUUID(),
        },
      })
    }

    // One-time upgrade: groups still on the old default name get renamed to the
    // owner's display name, so shared/followed groups show a person. Only calls
    // Clerk while the name is still the default; afterwards this is a no-op.
    if (group.name === 'My Habits') {
      const displayName = await getUserDisplayName(userId)
      if (displayName !== 'My Habits') {
        group = await prisma.habitGroup.update({
          where: { id: group.id },
          data: { name: displayName },
        })
      }
    }

    // Sort actions by timestamp and apply them sequentially
    const sortedActions = [...(actions || [])].sort((a, b) => a.timestamp - b.timestamp)

    for (const action of sortedActions) {
      await applyActionToDatabase(action, group.id)
    }

    // Get all current habits as the new base state
    const updatedHabits = await prisma.habit.findMany({
      where: { groupId: group.id },
      orderBy: { order: 'asc' },
    })

    // Return new base state and current timestamp
    const now = Date.now()
    return NextResponse.json({
      habits: updatedHabits.map(h => ({
        ...h,
        completions: JSON.parse(h.completions || '{}'),
      })),
      group,
      serverTimestamp: now,
    })
  } catch (error) {
    console.error('Failed to sync actions:', error)
    return NextResponse.json(
      { error: 'Failed to sync actions', details: error instanceof Error ? error.message : 'Unknown error', userId },
      { status: 500 }
    )
  }
}

// Apply a single action to the database
async function applyActionToDatabase(action: Action, groupId: string): Promise<void> {
  switch (action.type) {
    case 'create_habit': {
      // Only create if doesn't exist (might have been created by another client)
      const existing = await prisma.habit.findUnique({ where: { id: action.id } })
      if (!existing) {
        await prisma.habit.create({
          data: {
            id: action.id,
            groupId,
            name: action.name,
            completions: '{}',
            order: action.order,
            createdAt: new Date(action.timestamp),
            updatedAt: new Date(action.timestamp),
          },
        })
      }
      break
    }

    case 'rename_habit': {
      const existing = await prisma.habit.findUnique({ where: { id: action.id } })
      if (existing) {
        // Only update if our action is newer
        if (action.timestamp > existing.updatedAt.getTime()) {
          await prisma.habit.update({
            where: { id: action.id },
            data: {
              name: action.name,
              updatedAt: new Date(action.timestamp),
            },
          })
        }
      }
      break
    }

    case 'delete_habit': {
      await prisma.habit.delete({
        where: { id: action.id },
      }).catch(() => {
        // Habit might not exist, that's ok
      })
      break
    }

    case 'toggle_completion': {
      const habit = await prisma.habit.findUnique({ where: { id: action.id } })
      if (habit) {
        // Accept the new `state` payload; fall back to legacy `completed`.
        const a = action as { id: string; dateKey: string; state?: 'grey' | 'green' | 'clear'; completed?: boolean; timestamp: number }
        const state = a.state ?? (a.completed ? 'green' : 'grey')
        let completions = JSON.parse(habit.completions || '{}')
        const existing = completions[action.dateKey]

        // Only update if our action is newer
        if (!existing || action.timestamp > (existing.timestamp || 0)) {
          if (state === 'grey') delete completions[action.dateKey]
          else completions[action.dateKey] = { state, timestamp: action.timestamp }
          await prisma.habit.update({
            where: { id: action.id },
            data: {
              completions: JSON.stringify(completions),
              updatedAt: new Date(action.timestamp),
            },
          })
        }
      }
      break
    }

    case 'reorder_habit': {
      const habit = await prisma.habit.findUnique({ where: { id: action.id } })
      if (habit) {
        // Get all habits for this group
        const allHabits = await prisma.habit.findMany({
          where: { groupId },
          orderBy: { order: 'asc' },
        })

        // Remove the habit from its current position
        const otherHabits = allHabits.filter(h => h.id !== action.id)

        // Insert at the new position
        const reordered = [...otherHabits]
        const insertIndex = Math.max(0, Math.min(action.order, reordered.length))
        reordered.splice(insertIndex, 0, habit)

        // Update order values for all habits
        await Promise.all(
          reordered.map((h, i) =>
            prisma.habit.update({
              where: { id: h.id },
              data: { order: i },
            })
          )
        )
      }
      break
    }
  }
}

// One-time dev→prod Clerk self-heal migration.
// When a user first signs in on the production Clerk instance (new user ID),
// re-parent their old (dev-instance) data onto the new ID, matched by email.
// Driven by the CLERK_MIGRATION_MAP env var: a JSON { email: oldUserId } map.
// No-op if the var is unset/invalid. Idempotent; delete the env var once done.
async function selfHealMigration(userId: string): Promise<void> {
  const mapRaw = process.env.CLERK_MIGRATION_MAP
  if (!mapRaw) return
  let map: Record<string, string>
  try {
    map = JSON.parse(mapRaw)
  } catch {
    return
  }

  const email = await getUserEmail(userId)
  if (!email) return
  const oldUserId = map[email]
  if (!oldUserId || oldUserId === userId) return

  // Move the old user's habit group to this user (only if they don't already have one)
  const myGroup = await prisma.habitGroup.findUnique({ where: { userId } })
  if (!myGroup) {
    const oldGroup = await prisma.habitGroup.findUnique({ where: { userId: oldUserId } })
    if (oldGroup) {
      await prisma.habitGroup.update({ where: { id: oldGroup.id }, data: { userId } })
      console.log(`[migration] re-parented group for ${email}: ${oldUserId} -> ${userId}`)
    }
  }

  // Move their follows
  const follows = await prisma.follow.updateMany({ where: { userId: oldUserId }, data: { userId } })
  if (follows.count > 0) {
    console.log(`[migration] re-parented ${follows.count} follow(s) for ${email}`)
  }
}
