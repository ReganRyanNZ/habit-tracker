'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useAuth, UserButton } from '@clerk/nextjs'
import { Button } from '@/components/ui/button'
import { Plus, Share2, Loader2 } from 'lucide-react'
import {
  db,
  getUserHabitGroup,
  getFollowedGroups,
  addActionToQueue,
  removeActionsFromQueue,
  updateLastSyncAt,
  getSyncQueue,
  applyActionsToHabits,
  saveHabits,
  saveHabitGroup,
  saveFollowedGroup,
  type Action
} from '@/lib/db-local'
import type { Habit } from '@/lib/db-local'
import HabitGrid from '@/app/components/HabitGrid'
import AddHabitDialog from '@/app/components/AddHabitDialog'

interface HabitGroup {
  id: string
  userId: string
  name: string
  shareToken: string
  createdAt: Date
  updatedAt: Date
}

interface FollowedGroup {
  id: string
  name: string
  shareToken: string
  userId: string
  habits: Habit[]
}

interface SectionedHabit extends Habit {
  groupName: string
  groupId: string
  isOwner: boolean
}

export default function HomePage() {
  const { userId, isLoaded } = useAuth()
  const [loading, setLoading] = useState(true)
  const [hasGroup, setHasGroup] = useState(false) // Track if user has a confirmed group
  const [baseHabits, setBaseHabits] = useState<Habit[]>([]) // Base state from server/cache
  const [pendingActions, setPendingActions] = useState<Action[]>([]) // Local actions
  const [followedGroups, setFollowedGroups] = useState<FollowedGroup[]>([])
  const [myGroup, setMyGroup] = useState<HabitGroup | null>(null)
  const [isEditingName, setIsEditingName] = useState(false)
  const [showShareDialog, setShowShareDialog] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [isOnline, setIsOnline] = useState(true)

  // Track syncing state to prevent concurrent syncs
  const syncingRef = useRef(false)

  // Computed display state: base habits + pending actions
  const displayHabits = useMemo(() => {
    return applyActionsToHabits(baseHabits || [], pendingActions || [])
  }, [baseHabits, pendingActions])

  // Combine all habits with section information
  const allHabits = useMemo(() => {
    const sections: SectionedHabit[] = []

    // Add my habits
    if (myGroup) {
      displayHabits.forEach(habit => {
        sections.push({
          ...habit,
          groupName: myGroup.name,
          groupId: myGroup.id,
          isOwner: true,
        })
      })
    }

    // Add followed groups' habits
    followedGroups.forEach(group => {
      const habits = group.habits || []
      habits.forEach(habit => {
        sections.push({
          ...habit,
          groupName: group.name,
          groupId: group.id,
          isOwner: false,
        })
      })
    })

    return sections
  }, [displayHabits, myGroup, followedGroups])

  // Track online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    // Set initial state
    setIsOnline(navigator.onLine)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  // Define all async functions first (before useEffects that use them)

  const loadFollowedGroups = useCallback(async () => {
    try {
      const res = await fetch('/api/user/following')
      if (res.ok) {
        const groups = await res.json()
        setFollowedGroups(groups)

        // Save to IndexedDB
        for (const group of groups) {
          await saveFollowedGroup({
            ...group,
            followedAt: new Date(group.followedAt),
          })
        }
      }
    } catch (error) {
      console.error('Failed to load followed groups:', error)
    }
  }, [saveFollowedGroup])

  const syncWithServer = useCallback(async (): Promise<HabitGroup | null> => {
    if (!userId || syncingRef.current) return null

    try {
      syncingRef.current = true
      setSyncing(true)

      // Get pending actions
      const queue = await getSyncQueue()

      // Send to server
      const res = await fetch('/api/user/group/habits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actions: queue.actions,
          lastSyncAt: queue.lastSyncAt,
        }),
      })

      if (res.ok) {
        const data = await res.json()

        // Update base state with server response
        setBaseHabits(data.habits)
        await saveHabits(data.habits)

        // Update group info
        if (data.group) {
          setMyGroup(data.group)
          setHasGroup(true)
          await saveHabitGroup(data.group)
          return data.group
        }

        // Remove synced actions from queue
        if (queue.actions.length > 0) {
          await removeActionsFromQueue(queue.actions)
          setPendingActions([]) // Clear pending actions
        }

        // Update last sync timestamp
        if (data.serverTimestamp) {
          await updateLastSyncAt(data.serverTimestamp)
        }
      }
      return null
    } catch (error) {
      console.error('Failed to sync with server:', error)
      return null
    } finally {
      syncingRef.current = false
      setSyncing(false)
    }
  }, [userId])

  const loadData = useCallback(async () => {
    if (!userId) return

    try {
      setLoading(true)

      // 1. Load local data first (fast)
      const localGroup = await getUserHabitGroup()
      const localHabits = localGroup ? await db.habits.where('groupId').equals(localGroup.id).toArray() : []
      const queue = await getSyncQueue()

      // 2. Set local state with queue applied (no flicker!)
      setBaseHabits(localHabits)
      setPendingActions(queue.actions)
      setMyGroup(localGroup || null)
      setHasGroup(!!localGroup)

      // 3. Then fetch from server (this creates the group for new users)
      await syncWithServer()

      // 4. Load followed groups
      await loadFollowedGroups()
    } catch (error) {
      console.error('Failed to load data:', error)
      // Still show the data we have (even if incomplete)
    } finally {
      setLoading(false)
    }
  }, [userId, syncWithServer, loadFollowedGroups])

  // Load data on mount
  useEffect(() => {
    if (!isLoaded) return

    // Redirect to sign-in if not authenticated
    if (!userId) {
      window.location.href = '/sign-in'
      return
    }

    loadData()
  }, [isLoaded, userId, loadData])

  // Poll for updates to followed groups every 30s, and sync when coming back online
  useEffect(() => {
    if (!userId) return

    const interval = setInterval(() => {
      loadFollowedGroups()
    }, 30000)

    // Sync when coming back online
    const handleOnline = () => {
      console.log('Back online, syncing...')
      syncWithServer()
    }

    window.addEventListener('online', handleOnline)

    return () => {
      clearInterval(interval)
      window.removeEventListener('online', handleOnline)
      syncingRef.current = false // Reset sync flag on unmount
    }
  }, [userId, syncWithServer, loadFollowedGroups])

  // Create an action and add to queue
  const createAction = useCallback(async (action: Action) => {
    // Add to queue
    await addActionToQueue(action)

    // Update local state immediately (optimistic update)
    setPendingActions(prev => {
      const updated = [...prev, action].sort((a, b) => a.timestamp - b.timestamp)
      return updated
    })

    // Sync to server in background
    syncWithServer()
  }, [syncWithServer])

  const handleAddHabit = useCallback(async (name: string) => {
    // If no group exists, create one first
    if (!hasGroup || !myGroup) {
      const group = await syncWithServer()
      if (!group) {
        console.error('Failed to create habit group')
        return
      }
    }

    const maxOrder = displayHabits.reduce((max, h) => Math.max(max, h.order), -1)

    createAction({
      type: 'create_habit',
      id: `local-${Date.now()}`,
      name,
      order: maxOrder + 1,
      timestamp: Date.now(),
    })
  }, [hasGroup, myGroup, displayHabits, createAction, syncWithServer])

  const handleToggleCompletion = useCallback((habitId: string, dateKey: string) => {
    const habit = displayHabits.find(h => h.id === habitId)
    if (!habit) return

    const currentCompletion = habit.completions[dateKey]

    createAction({
      type: 'toggle_completion',
      id: habitId,
      dateKey,
      completed: currentCompletion?.completed ? false : true,
      timestamp: Date.now(),
    })
  }, [displayHabits, createAction])

  const handleDeleteHabit = useCallback((habitId: string) => {
    const habit = displayHabits.find(h => h.id === habitId)
    if (!habit) return

    createAction({
      type: 'delete_habit',
      id: habitId,
      timestamp: Date.now(),
    })
  }, [displayHabits, createAction])

  const handleRenameHabit = useCallback((habitId: string, newName: string) => {
    const habit = displayHabits.find(h => h.id === habitId)
    if (!habit) return

    createAction({
      type: 'rename_habit',
      id: habitId,
      name: newName,
      timestamp: Date.now(),
    })
  }, [displayHabits, createAction])

  const handleReorderHabit = useCallback((habitId: string, direction: 'up' | 'down') => {
    const habit = displayHabits.find(h => h.id === habitId)
    if (!habit) return

    const habitIndex = displayHabits.findIndex(h => h.id === habitId)
    if (habitIndex === -1) return

    const targetIndex = direction === 'up' ? habitIndex - 1 : habitIndex + 1
    if (targetIndex < 0 || targetIndex >= displayHabits.length) return

    createAction({
      type: 'reorder_habit',
      id: habitId,
      order: targetIndex,
      timestamp: Date.now(),
    })
  }, [displayHabits, createAction])

  const handleSaveGroupName = async (newName: string) => {
    if (!newName.trim() || !myGroup) return

    try {
      createAction({
        type: 'rename_group',
        name: newName.trim(),
        timestamp: Date.now(),
      })

      // Also update via API for immediate feedback
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
            <UserButton />
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
            <AddHabitDialog onAdd={handleAddHabit} />
            <Button onClick={() => setShowShareDialog(true)} variant="outline" size="sm" className="gap-2 p-2">
              <Share2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Status indicators */}
        <div className="mx-4 mb-2 flex items-center gap-3 text-xs">
          {!isOnline && (
            <div className="text-amber-600 flex items-center gap-1">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 1l22 22"/>
                <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/>
                <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.54"/>
                <path d="M10.71 5.05A16 16 0 0 1 22.58 9"/>
                <path d="M1.42 9a16 16 0 0 1 10.58-3.95"/>
                <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
                <path d="M12 20h.01"/>
              </svg>
              Offline - Changes will sync when online
            </div>
          )}
        </div>

        {/* Unified Habit Grid */}
        <HabitGrid
          habits={allHabits}
          onHabitsChange={() => {}} // No-op, we use action callbacks
          onAddHabit={handleAddHabit}
          myGroupId={myGroup?.id || null}
          onUnfollow={handleUnfollow}
          onToggleCompletion={handleToggleCompletion}
          onDelete={handleDeleteHabit}
          onRename={handleRenameHabit}
          onReorder={handleReorderHabit}
        />
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
