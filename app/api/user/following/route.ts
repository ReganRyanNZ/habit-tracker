import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/db'

export async function GET() {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Get all groups the user follows
    const follows = await prisma.follow.findMany({
      where: { userId },
      include: {
        group: {
          include: {
            habits: {
              orderBy: { order: 'asc' },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    const result = follows.map(follow => ({
      id: follow.group.id,
      name: follow.group.name,
      shareToken: follow.group.shareToken,
      userId: follow.group.userId,
      followedAt: follow.createdAt,
      habits: follow.group.habits.map(h => ({
        ...h,
        completions: JSON.parse(h.completions || '{}'),
      })),
    }))

    return NextResponse.json(result)
  } catch (error) {
    console.error('Failed to fetch following:', error)
    return NextResponse.json({ error: 'Failed to fetch following' }, { status: 500 })
  }
}
