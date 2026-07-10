'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@clerk/nextjs'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Loader2, UserPlus, UserMinus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import HabitGrid from '@/app/components/HabitGrid'
import type { Habit } from '@/lib/db-local'

interface SharedGroup {
  id: string
  name: string
  shareToken: string
  userId: string
  habits: Habit[]
}

export default function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { userId, isLoaded } = useAuth()
  const router = useRouter()
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [group, setGroup] = useState<SharedGroup | null>(null)
  const [isFollowing, setIsFollowing] = useState(false)
  const [followingLoading, setFollowingLoading] = useState(false)

  useEffect(() => {
    params.then(p => setToken(p.token))
  }, [params])

  useEffect(() => {
    if (!token) return
    loadSharedGroup()
  }, [token])

  useEffect(() => {
    if (!userId || !group) return
    checkIfFollowing()
  }, [userId, group])

  const loadSharedGroup = async () => {
    if (!token) return

    try {
      setLoading(true)
      const res = await fetch(`/api/share/${token}`)
      if (res.ok) {
        const data = await res.json()
        setGroup(data)
      }
    } catch (error) {
      console.error('Failed to load shared group:', error)
    } finally {
      setLoading(false)
    }
  }

  const checkIfFollowing = async () => {
    if (!userId || !group) return

    try {
      const res = await fetch('/api/user/following')
      if (res.ok) {
        const following = await res.json()
        setIsFollowing(following.some((g: SharedGroup) => g.id === group.id))
      }
    } catch (error) {
      console.error('Failed to check following status:', error)
    }
  }

  const handleFollowToggle = async () => {
    if (!userId || !group) return

    setFollowingLoading(true)
    try {
      const res = await fetch(`/api/share/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: isFollowing ? 'unfollow' : 'follow' }),
      })

      if (res.ok) {
        setIsFollowing(!isFollowing)
        if (!isFollowing) {
          // Just followed, redirect to main app
          router.push('/')
        }
      }
    } catch (error) {
      console.error('Failed to update follow status:', error)
    } finally {
      setFollowingLoading(false)
    }
  }

  if (loading || !isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    )
  }

  if (!group) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <div className="text-center space-y-4">
          <p className="text-zinc-600">Habit group not found</p>
          <Button onClick={() => router.push('/')}>Go Home</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-50 pt-4 pl-2">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-7 mx-4 gap-2">
          <div className="flex items-center gap-2">
            <Button onClick={() => router.push('/')} variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-xl font-bold">{group.name}</h1>
              <p className="text-xs text-zinc-500">Shared habit group</p>
            </div>
          </div>
          {userId ? (
            <Button
              onClick={handleFollowToggle}
              disabled={followingLoading}
              variant={isFollowing ? "outline" : "default"}
              className="gap-2"
            >
              {followingLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isFollowing ? (
                <>
                  <UserMinus className="h-4 w-4" />
                  Unfollow
                </>
              ) : (
                <>
                  <UserPlus className="h-4 w-4" />
                  Follow
                </>
              )}
            </Button>
          ) : (
            <Button onClick={() => router.push('/')} variant="outline">
              Sign in to follow
            </Button>
          )}
        </div>

        {/* Habits - view only */}
        <HabitGrid
          habits={group.habits}
          onHabitsChange={() => {}}
          onAddHabit={() => {}}
          groupId={group.id}
          isOwner={false}
        />
      </div>
    </div>
  )
}
