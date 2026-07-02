import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { generateSlug } from '@/lib/utils'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, habits } = body

    // Generate a unique slug
    let slug = generateSlug()
    let exists = await prisma.habitSheet.findUnique({ where: { slug } })
    while (exists) {
      slug = generateSlug()
      exists = await prisma.habitSheet.findUnique({ where: { slug } })
    }

    const sheet = await prisma.habitSheet.create({
      data: {
        slug,
        habits: habits
          ? {
              create: habits.map((h: any, index: number) => ({
                name: h.name,
                group: h.group || 'My Habits',
                completions: typeof h.completions === 'string' ? h.completions : JSON.stringify(h.completions || {}),
                order: index,
              })),
            }
          : undefined,
      },
      include: {
        habits: {
          orderBy: { order: 'asc' },
        },
      },
    })

    // Parse completions back to objects for the response
    const response = {
      ...sheet,
      habits: sheet.habits.map(h => ({
        ...h,
        completions: JSON.parse(h.completions as string),
      })),
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error creating sheet:', error)
    return NextResponse.json({ error: 'Failed to create sheet' }, { status: 500 })
  }
}
