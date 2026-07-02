'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { ArrowRight, Sparkles } from 'lucide-react'
import { useRouter } from 'next/navigation'

export default function HomePage() {
  const router = useRouter()
  const [slug, setSlug] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  // Check if user has a saved sheet and redirect
  useEffect(() => {
    const savedSlug = localStorage.getItem('habitSheetSlug')
    if (savedSlug) {
      router.replace(`/${savedSlug}`)
    }
  }, [router])

  const handleCreate = async () => {
    setIsCreating(true)
    try {
      const response = await fetch('/api/sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'My Habits',
          habits: [
            { name: 'Exercise', group: 'My Habits' },
            { name: 'Read', group: 'My Habits' },
          ],
        }),
      })

      if (response.ok) {
        const sheet = await response.json()
        localStorage.setItem('habitSheetSlug', sheet.slug)
        router.push(`/${sheet.slug}`)
      }
    } catch (error) {
      console.error('Failed to create sheet:', error)
    } finally {
      setIsCreating(false)
    }
  }

  const handleGo = () => {
    if (slug.trim()) {
      localStorage.setItem('habitSheetSlug', slug.trim())
      router.push(`/${slug.trim()}`)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-50 to-zinc-100">
      <div className="w-full max-w-md p-8 space-y-8">
        <div className="text-center space-y-2">
          <div className="flex justify-center">
            <div className="p-3 bg-gradient-to-br from-zinc-900 to-zinc-800 rounded-2xl">
              <Sparkles className="h-8 w-8 text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-zinc-900">Habits</h1>
          <p className="text-zinc-600">
            Track daily habits with friends. No login required.
          </p>
        </div>

        <div className="space-y-4">
          <Button
            onClick={handleCreate}
            disabled={isCreating}
            className="w-full h-12 text-base"
            size="lg"
          >
            {isCreating ? 'Creating...' : 'Create New Habit Sheet'}
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-zinc-200" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-2 text-zinc-500">or open existing</span>
            </div>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={slug}
              onChange={e => setSlug(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleGo()}
              placeholder="Enter sheet code..."
              className="flex-1 h-12 px-4 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-500"
            />
            <Button onClick={handleGo} variant="outline" className="h-12 px-4">
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="text-center text-sm text-zinc-500 space-y-2">
          <p>Share the URL with friends to collaborate</p>
          <p>Works offline • No account needed</p>
        </div>
      </div>
    </div>
  )
}
