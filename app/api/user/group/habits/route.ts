import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/db'
import { ensureUserExists } from '@/lib/auth-helpers'
import { randomUUID } from 'crypto'

// Action type definition (must match client)
type Action =
  | { type: 'create_habit'; id: string; name: string; order: number; timestamp: number }
  | { type: 'rename_habit'; id: string; name: string; timestamp: number }
  | { type: 'delete_habit'; id: string; timestamp: number }
  | { type: 'toggle_completion'; id: string; dateKey: string; completed: boolean; timestamp: number }
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

    let group = await prisma.habitGroup.findUnique({ where: { userId } })
    if (!group) {
      group = await prisma.habitGroup.create({
        data: {
          userId,
          name: 'My Habits',
          shareToken: randomUUID(),
        },
      })
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
        let completions = JSON.parse(habit.completions || '{}')
        const existing = completions[action.dateKey]

        // Only update if our action is newer
        if (!existing || action.timestamp > (existing.timestamp || 0)) {
          completions[action.dateKey] = {
            completed: action.completed,
            timestamp: action.timestamp,
          }
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
