import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/db'
import { ensureUserExists } from '@/lib/auth-helpers'

// GET - Fetch shared group by token (for viewing)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  try {
    const group = await prisma.habitGroup.findUnique({
      where: { shareToken: token },
      include: {
        habits: {
          orderBy: { order: 'asc' },
        },
        user: {
          select: {
            id: true,
          },
        },
      },
    })

    if (!group) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 })
    }

    // Parse completions
    const habits = group.habits.map(h => ({
      ...h,
      completions: JSON.parse(h.completions || '{}'),
    }))

    return NextResponse.json({
      id: group.id,
      name: group.name,
      shareToken: group.shareToken,
      userId: group.user.id,
      habits,
    })
  } catch (error) {
    console.error('Failed to fetch shared group:', error)
    return NextResponse.json({ error: 'Failed to fetch shared group' }, { status: 500 })
  }
}

// POST - Follow or unfollow a shared group
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { token } = await params
  const { action } = await request.json()

  if (action !== 'follow' && action !== 'unfollow') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  try {
    const group = await prisma.habitGroup.findUnique({
      where: { shareToken: token },
    })

    if (!group) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 })
    }

    // Don't let users follow their own group
    if (group.userId === userId) {
      return NextResponse.json({ error: 'Cannot follow your own group' }, { status: 400 })
    }

    if (action === 'follow') {
      // Ensure the follower's User row exists (FK target for Follow)
      await ensureUserExists(userId)

      // Check if already following
      const existing = await prisma.follow.findUnique({
        where: {
          userId_groupId: {
            userId,
            groupId: group.id,
          },
        },
      })

      if (existing) {
        return NextResponse.json({ message: 'Already following' })
      }

      // Create follow relationship
      await prisma.follow.create({
        data: {
          userId,
          groupId: group.id,
        },
      })

      return NextResponse.json({ message: 'Now following' })
    } else {
      // Unfollow
      await prisma.follow.deleteMany({
        where: {
          userId,
          groupId: group.id,
        },
      })

      return NextResponse.json({ message: 'Unfollowed' })
    }
  } catch (error) {
    console.error('Failed to update follow status:', error)
    return NextResponse.json({ error: 'Failed to update follow status' }, { status: 500 })
  }
}
