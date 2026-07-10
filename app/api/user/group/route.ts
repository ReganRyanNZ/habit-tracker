import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/db'

export async function GET() {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Ensure user exists in database
    await prisma.user.upsert({
      where: { id: userId },
      create: { id: userId },
      update: {},
    })

    // Check if user already has a habit group
    let group = await prisma.habitGroup.findUnique({
      where: { userId },
    })

    // Create one if it doesn't exist
    if (!group) {
      group = await prisma.habitGroup.create({
        data: {
          userId,
          name: 'My Habits',
        },
      })
    }

    return NextResponse.json(group)
  } catch (error) {
    console.error('Failed to fetch habit group:', error)
    return NextResponse.json({ error: 'Failed to fetch habit group' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { name } = await request.json()

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Invalid name' }, { status: 400 })
    }

    const group = await prisma.habitGroup.update({
      where: { userId },
      data: { name },
    })

    return NextResponse.json(group)
  } catch (error) {
    console.error('Failed to update habit group:', error)
    return NextResponse.json({ error: 'Failed to update habit group' }, { status: 500 })
  }
}
