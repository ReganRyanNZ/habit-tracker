import { NextRequest, NextResponse } from 'next/server'
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
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    })

    const result = follows.map(follow => ({
      id: follow.group.id,
      name: follow.group.name,
      shareToken: follow.group.shareToken,
      userId: follow.group.userId,
      order: follow.order,
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

// Reorder a followed group (move up/down). Re-sequences the user's follows to 0..n-1.
export async function PATCH(request: NextRequest) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { groupId, direction } = await request.json()
    if (direction !== 'up' && direction !== 'down') {
      return NextResponse.json({ error: 'Invalid direction' }, { status: 400 })
    }

    const follows = await prisma.follow.findMany({
      where: { userId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    })
    const idx = follows.findIndex(f => f.groupId === groupId)
    if (idx === -1) {
      return NextResponse.json({ error: 'Not following this group' }, { status: 404 })
    }
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= follows.length) {
      return NextResponse.json({ ok: true }) // already at the boundary, no-op
    }

    ;[follows[idx], follows[swapIdx]] = [follows[swapIdx], follows[idx]]
    await prisma.$transaction(
      follows.map((f, i) =>
        prisma.follow.update({ where: { id: f.id }, data: { order: i } })
      )
    )
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Failed to reorder follows:', error)
    return NextResponse.json({ error: 'Failed to reorder' }, { status: 500 })
  }
}
