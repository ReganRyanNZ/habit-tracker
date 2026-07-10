import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/db'

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

    return NextResponse.json(habits)
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
    const { habits, deletedHabitIds } = await request.json()

    // Get user's group
    const group = await prisma.habitGroup.findUnique({
      where: { userId },
    })

    if (!group) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 })
    }

    // Delete habits
    if (deletedHabitIds && deletedHabitIds.length > 0) {
      await prisma.habit.deleteMany({
        where: {
          id: { in: deletedHabitIds },
          groupId: group.id,
        },
      })
    }

    // Upsert habits
    if (habits && habits.length > 0) {
      for (const habit of habits) {
        const { id, name, completions, order, createdAt, updatedAt } = habit

        // Convert completions object to string
        const completionsStr = JSON.stringify(completions || {})

        await prisma.habit.upsert({
          where: { id },
          create: {
            id,
            groupId: group.id,
            name,
            completions: completionsStr,
            order,
            createdAt: createdAt ? new Date(createdAt) : new Date(),
            updatedAt: updatedAt ? new Date(updatedAt) : new Date(),
          },
          update: {
            name,
            completions: completionsStr,
            order,
            updatedAt: updatedAt ? new Date(updatedAt) : new Date(),
          },
        })
      }
    }

    // Return all habits for this group
    const updatedHabits = await prisma.habit.findMany({
      where: { groupId: group.id },
      orderBy: { order: 'asc' },
    })

    return NextResponse.json(
      updatedHabits.map(h => ({
        ...h,
        completions: JSON.parse(h.completions || '{}'),
      }))
    )
  } catch (error) {
    console.error('Failed to sync habits:', error)
    return NextResponse.json({ error: 'Failed to sync habits' }, { status: 500 })
  }
}
