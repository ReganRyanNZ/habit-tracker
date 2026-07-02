import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params
    const sheet = await prisma.habitSheet.findUnique({
      where: { slug },
      include: {
        habits: {
          orderBy: { order: 'asc' },
        },
      },
    })

    if (!sheet) {
      return NextResponse.json({ error: 'Sheet not found' }, { status: 404 })
    }

    // Parse completions from strings to objects
    const response = {
      ...sheet,
      habits: sheet.habits.map(h => ({
        ...h,
        completions: JSON.parse(h.completions as string),
      })),
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error fetching sheet:', error)
    return NextResponse.json({ error: 'Failed to fetch sheet' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params
    const body = await request.json()

    const sheet = await prisma.habitSheet.findUnique({
      where: { slug },
    })

    if (!sheet) {
      return NextResponse.json({ error: 'Sheet not found' }, { status: 404 })
    }

    const { habits, name, deletedHabitIds } = body

    // Get current server habits for comparison
    const serverHabits = await prisma.habit.findMany({
      where: { sheetId: sheet.id },
    })
    const serverHabitsMap = new Map(serverHabits.map(h => [h.id, h]))

    const habitsToCreate: any[] = []
    const habitsToUpdate: any[] = []
    const habitsSkipped: string[] = [] // IDs where server version is newer
    const clientHabitIds = new Set((habits || []).map((h: any) => h.id))

    // Process deletions FIRST - before any creates/updates
    // This ensures deleted habits don't get re-created
    if (deletedHabitIds && Array.isArray(deletedHabitIds) && deletedHabitIds.length > 0) {
      const existingIds = serverHabits.map(h => h.id)
      const idsToDelete = deletedHabitIds.filter((id: string) => existingIds.includes(id))

      if (idsToDelete.length > 0) {
        console.log('Deleting habits:', idsToDelete)
        await prisma.habit.deleteMany({
          where: {
            id: { in: idsToDelete },
            sheetId: sheet.id,
          },
        })
        // Remove deleted habits from server map so they don't get re-created
        idsToDelete.forEach(id => serverHabitsMap.delete(id))
      }
    }

    // Process each habit from client
    for (const habit of habits || []) {
      const isLocalHabit = !habit.id || habit.id.startsWith('local-')

      if (isLocalHabit) {
        // New habit from client - always create
        habitsToCreate.push({
          sheetId: sheet.id,
          name: habit.name,
          group: habit.group,
          completions: typeof habit.completions === 'string' ? habit.completions : JSON.stringify(habit.completions || {}),
          order: habit.order || 0,
        })
      } else {
        // Existing habit - check timestamps
        const serverHabit = serverHabitsMap.get(habit.id)
        const clientUpdatedAt = new Date(habit.updatedAt)

        if (!serverHabit) {
          // Habit doesn't exist on server (might have been deleted by another user)
          // Re-create it only if it was also deleted on client (otherwise it's a true re-creation)
          habitsToCreate.push({
            id: habit.id,
            sheetId: sheet.id,
            name: habit.name,
            group: habit.group,
            completions: typeof habit.completions === 'string' ? habit.completions : JSON.stringify(habit.completions || {}),
            order: habit.order || 0,
          })
        } else if (clientUpdatedAt > serverHabit.updatedAt) {
          // Client's version is newer - update server
          habitsToUpdate.push({
            where: { id: habit.id },
            data: {
              name: habit.name,
              group: habit.group,
              completions: typeof habit.completions === 'string' ? habit.completions : JSON.stringify(habit.completions || {}),
              order: habit.order,
            },
          })
        } else {
          // Server's version is newer or same - keep server's, skip this one
          habitsSkipped.push(habit.id)
        }
      }
    }

    // Execute creates and updates
    const createdHabits = await prisma.habit.createMany({
      data: habitsToCreate,
    })

    for (const update of habitsToUpdate) {
      await prisma.habit.update(update)
    }

    // Update sheet timestamp and optionally name
    const updatedSheet = await prisma.habitSheet.update({
      where: { id: sheet.id },
      data: {
        updatedAt: new Date(),
        ...(name !== undefined && { name }),
      },
      include: {
        habits: {
          orderBy: { order: 'asc' },
        },
      },
    })

    // Parse completions from strings to objects
    const response = {
      ...updatedSheet,
      habits: updatedSheet.habits.map(h => ({
        ...h,
        completions: JSON.parse(h.completions as string),
      })),
    }

    // Log merge stats
    console.log('Sync merge stats:', {
      created: habitsToCreate.length,
      updated: habitsToUpdate.length,
      skipped: habitsSkipped.length,
      deleted: deletedHabitIds?.length || 0,
    })

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error updating sheet:', error)
    return NextResponse.json({ error: 'Failed to update sheet' }, { status: 500 })
  }
}
