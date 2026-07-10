'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth, UserButton } from '@clerk/nextjs'
import { Button } from '@/components/ui/button'
import { Plus, Share2, Loader2, UserMinus } from 'lucide-react'
import { db, clearAllData, getUserHabitGroup, getFollowedGroups } from '@/lib/db-local'
import type { Habit } from '@/lib/db-local'
import HabitGrid from '@/app/components/HabitGrid'
import AddHabitDialog from '@/app/components/AddHabitDialog'

interface HabitGroup {
  id: string
  userId: string
  name: string
  shareToken: string
}

interface FollowedGroup {
  id: string
  name: string
  shareToken: string
  userId: string
  habits: Habit[]
}

export default function HomePage() {
  const { userId, isLoaded } = useAuth()
  const [loading, setLoading] = useState(true)
  const [myHabits, setMyHabits] = useState<Habit[]>([])
  const [followedGroups, setFollowedGroups] = useState<FollowedGroup[]>([])
  const [myGroup, setMyGroup] = useState<HabitGroup | null>(null)
  const [isEditingName, setIsEditingName] = useState(false)
  const [showShareDialog, setShowShareDialog] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const habitsRef = useRef<Habit[]>([])
  useEffect(() => { habitsRef.current = myHabits }, [myHabits])

  // Load data on mount
  useEffect(() => {
    if (!isLoaded) return

    // Redirect to sign-in if not authenticated
    if (!userId) {
      window.location.href = '/sign-in'
      return
    }

    loadData()
  }, [isLoaded, userId])

  // Poll for updates to followed groups every 30s
  useEffect(() => {
    if (!userId) return

    const interval = setInterval(() => {
      loadFollowedGroups()
    }, 30000)

    return () => clearInterval(interval)
  }, [userId])

  const loadData = async () => {
    if (!userId) return

    try {
      setLoading(true)
      console.log('Loading data for user:', userId)

      // Load user's group
      const groupRes = await fetch('/api/user/group')
      console.log('Group response:', groupRes.status, groupRes.ok)
      if (groupRes.ok) {
        const group = await groupRes.json()
        console.log('Group loaded:', group)
        setMyGroup(group)
        await db.habitGroups.put({
          id: group.id,
          userId: group.userId,
          name: group.name,
          shareToken: group.shareToken,
          createdAt: new Date(group.createdAt),
          updatedAt: new Date(group.updatedAt),
        })
      } else {
        console.error('Failed to load group:', groupRes.status, await groupRes.text())
      }

      // Load user's habits
      const habitsRes = await fetch('/api/user/group/habits')
      console.log('Habits response:', habitsRes.status, habitsRes.ok)
      if (habitsRes.ok) {
        const habits = await habitsRes.json()
        console.log('Habits loaded:', habits)
        setMyHabits(habits)
      } else {
        console.error('Failed to load habits:', habitsRes.status, await habitsRes.text())
      }

      // Load followed groups
      await loadFollowedGroups()
    } catch (error) {
      console.error('Failed to load data:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadFollowedGroups = async () => {
    try {
      const res = await fetch('/api/user/following')
      if (res.ok) {
        const groups = await res.json()
        setFollowedGroups(groups)

        // Save to IndexedDB
        for (const group of groups) {
          await db.following.put({
            id: group.id,
            userId: userId!,
            groupId: group.id,
            groupUserId: group.userId,
            groupName: group.name,
            shareToken: group.shareToken,
            followedAt: new Date(group.followedAt),
            habits: group.habits,
          })
        }
      }
    } catch (error) {
      console.error('Failed to load followed groups:', error)
    }
  }

  const handleMyHabitsChange = useCallback((updatedHabits: Habit[]) => {
    const newIds = new Set(updatedHabits.map(h => h.id))
    const deletedIds = myHabits
      .filter(h => !newIds.has(h.id))
      .map(h => h.id)

    setMyHabits(updatedHabits)

    // Update IndexedDB
    for (const habit of updatedHabits) {
      db.habits.put(habit)
    }
    for (const id of deletedIds) {
      db.habits.delete(id)
    }

    // Sync to server
    syncHabits(updatedHabits, deletedIds)
  }, [myHabits])

  const syncHabits = async (habits: Habit[], deletedIds: string[]) => {
    if (syncing || !myGroup) return

    console.log('Syncing habits...', { habits, deletedIds })
    setSyncing(true)
    try {
      const res = await fetch('/api/user/group/habits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          habits: habits.map(h => ({ ...h, groupId: myGroup.id })),
          deletedHabitIds: deletedIds,
        }),
      })

      if (res.ok) {
        const updated = await res.json()
        console.log('Sync successful:', updated)
        setMyHabits(updated)
      } else {
        console.error('Sync failed:', res.status, res.statusText)
      }
    } catch (error) {
      console.error('Failed to sync habits:', error)
    } finally {
      setSyncing(false)
    }
  }

  const handleAddHabit = useCallback((name: string) => {
    console.log('handleAddHabit called', { name, myGroup, myHabits })
    if (!myGroup) {
      console.error('Cannot add habit: myGroup is null')
      return
    }

    const maxOrder = myHabits.reduce((max, h) => Math.max(max, h.order), -1)
    const newHabit: Habit = {
      id: `local-${Date.now()}`,
      groupId: myGroup.id,
      name,
      completions: {},
      order: maxOrder + 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    console.log('Adding new habit:', newHabit)
    handleMyHabitsChange([...myHabits, newHabit])
  }, [myHabits, myGroup, handleMyHabitsChange])

  const handleSaveGroupName = async (newName: string) => {
    if (!newName.trim() || !myGroup) return

    try {
      const res = await fetch('/api/user/group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      })

      if (res.ok) {
        const updated = await res.json()
        setMyGroup(updated)
        setIsEditingName(false)
      }
    } catch (error) {
      console.error('Failed to save group name:', error)
    }
  }

  const handleUnfollow = async (groupId: string) => {
    try {
      const group = followedGroups.find(g => g.id === groupId)
      if (!group) return

      const res = await fetch(`/api/share/${group.shareToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unfollow' }),
      })

      if (res.ok) {
        setFollowedGroups(prev => prev.filter(g => g.id !== groupId))
        await db.following.delete(groupId)
        // Also delete habits from IndexedDB
        const habits = await db.habits.where('groupId').equals(groupId).toArray()
        await Promise.all(habits.map(h => db.habits.delete(h.id)))
      }
    } catch (error) {
      console.error('Failed to unfollow:', error)
    }
  }

  if (!isLoaded || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    )
  }

  if (!userId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <div className="text-center space-y-4">
          <p className="text-zinc-600">Please sign in to continue</p>
        </div>
      </div>
    )
  }

  const shareUrl = myGroup ? `${window.location.origin}/share/${myGroup.shareToken}` : ''

  return (
    <div className="min-h-screen bg-zinc-50 pt-4 pl-2">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-7 mx-4 gap-2">
          <div className="flex items-center gap-2 flex-1">
            <UserButton afterSignOutUrl="/" />
            {isEditingName ? (
              <input
                type="text"
                defaultValue={myGroup?.name || 'My Habits'}
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter') handleSaveGroupName((e.target as HTMLInputElement).value)
                  else if (e.key === 'Escape') setIsEditingName(false)
                }}
                onBlur={e => handleSaveGroupName((e.target as HTMLInputElement).value)}
                className="text-xl font-bold bg-transparent border-b-2 border-zinc-300 focus:outline-none focus:border-zinc-900 flex-1"
              />
            ) : (
              <h1 className="text-xl font-bold">{myGroup?.name || 'My Habits'}</h1>
            )}
            <button
              onClick={() => setIsEditingName(true)}
              className="text-gray-400 hover:text-gray-600 p-1"
              title="Rename group"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
              </svg>
            </button>
          </div>
          <div className="flex items-center gap-1">
            <AddHabitDialog onAdd={handleAddHabit} existingGroups={[]} />
            <Button onClick={() => setShowShareDialog(true)} variant="outline" size="sm" className="gap-2 p-2">
              <Share2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* My Habits */}
        {myGroup && (
          <HabitGrid
            habits={myHabits}
            onHabitsChange={handleMyHabitsChange}
            onAddHabit={handleAddHabit}
            existingGroups={[]}
            groupId={myGroup.id}
            isOwner={true}
          />
        )}

        {/* Followed Groups */}
        {followedGroups.map(group => (
          <div key={group.id} className="mt-8">
            <div className="flex items-center justify-between mb-4 mx-4">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-zinc-700">{group.name}</h2>
                <span className="text-xs text-zinc-400">View only</span>
              </div>
              <Button
                onClick={() => handleUnfollow(group.id)}
                variant="ghost"
                size="sm"
                className="text-zinc-400 hover:text-red-600"
              >
                <UserMinus className="h-4 w-4" />
              </Button>
            </div>
            <HabitGrid
              habits={group.habits}
              onHabitsChange={() => {}}
              onAddHabit={() => {}}
              existingGroups={[]}
              groupId={group.id}
              isOwner={false}
            />
          </div>
        ))}
      </div>

      {/* Share Dialog */}
      {showShareDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-sm mx-4 shadow-lg">
            <h3 className="text-lg font-semibold mb-2">Share your habits</h3>
            <p className="text-gray-600 mb-4">
              Share this link with friends. They can view your habits and choose to follow you.
            </p>
            <div className="flex items-center gap-2 mb-4">
              <input
                type="text"
                readOnly
                value={shareUrl}
                className="flex-1 px-3 py-2 border rounded-md bg-gray-50 text-sm"
              />
              <Button
                onClick={() => {
                  navigator.clipboard.writeText(shareUrl)
                }}
                size="sm"
              >
                Copy
              </Button>
            </div>
            <Button onClick={() => setShowShareDialog(false)} variant="outline" className="w-full">
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
