'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import HabitGrid from '@/app/components/HabitGrid'
import { Habit, db, getPendingSyncItems, clearSyncedItems, queueFullSync, getItemsReadyForRetry, markRetryFailed, getPendingSyncCount } from '@/lib/db-local'
import { Button } from '@/components/ui/button'
import { Share2, Loader2, Plus } from 'lucide-react'
import AddHabitDialog from '@/app/components/AddHabitDialog'

// User's sheets stored in localStorage
const STORAGE_KEY = 'habitSheets'

interface UserSheet {
  slug: string
  name: string
  id: string
}

function getUserSheets(): UserSheet[] {
  if (typeof window === 'undefined') return []
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function saveUserSheets(sheets: UserSheet[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sheets))
  } catch (e) {
    console.error('Failed to save user sheets:', e)
  }
}

function addUserSheet(sheet: UserSheet) {
  const sheets = getUserSheets()
  // Don't add if it already exists
  if (!sheets.find(s => s.slug === sheet.slug)) {
    sheets.unshift(sheet) // Add to beginning
    saveUserSheets(sheets)
  }
}

function removeUserSheet(slug: string) {
  const sheets = getUserSheets().filter(s => s.slug !== slug)
  saveUserSheets(sheets)
}

export default function SheetPage() {
  const params = useParams()
  const router = useRouter()
  const slug = params.slug as string

  const [habits, setHabits] = useState<Habit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [sheetId, setSheetId] = useState<string | null>(null)
  const [sheetName, setSheetName] = useState('My Habits')
  const [isEditingName, setIsEditingName] = useState(false)
  const [deletedHabitIds, setDeletedHabitIds] = useState<Set<string>>(new Set())
  const [pendingSync, setPendingSync] = useState(false)
  const [sheetUpdatedAt, setSheetUpdatedAt] = useState<Date | null>(null)
  const [userSheets, setUserSheets] = useState<UserSheet[]>([])
  const [isCreatingSheet, setIsCreatingSheet] = useState(false)

  // Ref to track if component is mounted for async operations
  const isMounted = useRef(true)

  // Refs to store functions for circular dependency resolution
  const processSyncQueueRef = useRef<(() => Promise<void>) | null>(null)
  const syncHabitsWithDeletionsRef = useRef<(deletedIds: string[]) => Promise<void>>(() => Promise.resolve())

  // Ref to store current habits for use in fetchServerUpdates without re-creating the function
  const habitsRef = useRef<Habit[]>([])
  useEffect(() => {
    habitsRef.current = habits
  }, [habits])

  // Cleanup on unmount and load user sheets
  useEffect(() => {
    isMounted.current = true
    // Load user's sheets on mount
    setUserSheets(getUserSheets())
    return () => { isMounted.current = false }
  }, [])

  // Load habits from API and IndexedDB
  useEffect(() => {
    // Save this as the user's home sheet
    localStorage.setItem('habitSheetSlug', slug)
    loadHabits()
  }, [slug])

  // Set up online/offline detection and process pending sync
  useEffect(() => {
    const handleOnline = () => {
      processSyncQueueRef.current?.()
    }

    window.addEventListener('online', handleOnline)
    if (navigator.onLine) {
      processSyncQueueRef.current?.()
    }

    return () => window.removeEventListener('online', handleOnline)
  }, [])

  // Process sync queue periodically for retries (every 10s)
  useEffect(() => {
    if (!sheetId) return

    const interval = setInterval(() => {
      if (navigator.onLine && !syncing) {
        processSyncQueueRef.current?.()
      }
    }, 10000)

    return () => clearInterval(interval)
  }, [sheetId, syncing])

  // Debug: Check if any deleted habits are still in the habits array
  useEffect(() => {
    if (deletedHabitIds.size > 0) {
      const deletedHabitsInArray = habits.filter(h => deletedHabitIds.has(h.id))
      if (deletedHabitsInArray.length > 0) {
        console.warn('⚠️ Deleted habits found in habits array:', deletedHabitsInArray.map(h => ({ id: h.id, name: h.name })))
      }
    }
  }, [habits, deletedHabitIds])

  // Cleanup on unmount
  useEffect(() => {
    isMounted.current = true
    return () => { isMounted.current = false }
  }, [])

  const loadHabits = useCallback(async () => {
    try {
      // Try to load from IndexedDB first for instant display
      const localSheet = await db.habitSheets.where('slug').equals(slug).first()
      let localHabits: Habit[] = []
      if (localSheet) {
        localHabits = await db.habits.where('sheetId').equals(localSheet.id).toArray()
        if (localHabits.length > 0) {
          console.log('Loaded from IndexedDB:', localHabits.length, 'habits')
          setHabits(localHabits)
          setSheetId(localSheet.id)
        }
      }

      // Fetch from API to get authoritative data
      const response = await fetch(`/api/sheet/${slug}`)
      if (!response.ok) {
        if (response.status === 404) {
          setError('Habit sheet not found')
          router.push('/')
          return
        }
        // If API fails but we have IndexedDB data, use it
        if (localHabits.length > 0) {
          console.log('Using IndexedDB data as fallback')
          setLoading(false)
          return
        }
        return
      }

      const data = await response.json()
      setSheetId(data.id)
      setSheetName(data.name || 'My Habits')
      setSheetUpdatedAt(new Date(data.updatedAt))
      setHabits(data.habits)

      // Add this sheet to user's list
      addUserSheet({
        slug: data.slug,
        name: data.name || 'My Habits',
        id: data.id
      })
      setUserSheets(getUserSheets())

      // Clear ALL habits for this sheet from IndexedDB first to prevent duplicates
      const existingHabits = await db.habits.where('sheetId').equals(data.id).toArray()
      for (const habit of existingHabits) {
        await db.habits.delete(habit.id)
      }

      // Then save the fresh server data to IndexedDB
      await db.habitSheets.put({
        id: data.id,
        slug: data.slug,
        createdAt: new Date(data.createdAt),
        updatedAt: new Date(data.updatedAt),
      })

      for (const habit of data.habits) {
        await db.habits.put(habit)
      }

      setLoading(false)

      // Process any pending sync items from previous session
      if (navigator.onLine) {
        processSyncQueueRef.current?.()
      }
    } catch (err) {
      console.error('Failed to load habits:', err)
      if (habits.length === 0) {
        setError('Failed to load habits')
      }
      setLoading(false)
    }
  }, [slug, router])

  const processSyncQueue = useCallback(async () => {
    if (!sheetId || syncing || !navigator.onLine) return

    // Get items ready for retry
    const pending = await getItemsReadyForRetry()
    if (pending.length === 0) return

    console.log('Processing sync queue:', pending.length, 'items')
    setSyncing(true)
    setPendingSync(true)

    try {
      // Group items by type and batch them
      const fullSyncItems = pending.filter(item => item.type === 'FULL_SYNC')

      // Merge ALL deletedIds from all pending FULL_SYNC items
      // This ensures we don't miss deletions when multiple items are queued
      const allDeletedIds = new Set<string>()
      for (const item of fullSyncItems) {
        const itemDeletedIds = item.habitData?.deletedHabitIds || []
        itemDeletedIds.forEach((id: string) => allDeletedIds.add(id))
      }

      // For now, process one full sync at a time (most recent)
      // This consolidates all changes into one API call
      if (fullSyncItems.length > 0) {
        const mostRecent = fullSyncItems.sort((a, b) => b.timestamp - a.timestamp)[0]
        // Use merged deletedIds from all pending items
        await syncHabitsWithDeletionsRef.current(Array.from(allDeletedIds))

        // Clear all FULL_SYNC items since we just did a complete sync
        const fullSyncIds = fullSyncItems.map(item => item.id as number)
        await clearSyncedItems(fullSyncIds)
      } else {
        // Process other types (individual updates) if we had them
        const itemIds = pending.map(item => item.id as number)
        await clearSyncedItems(itemIds)
      }

      setPendingSync(false)
    } catch (err) {
      console.error('Sync queue processing failed:', err)
      // Mark items as failed for retry with backoff
      const itemIds = pending.map(item => item.id as number)
      await markRetryFailed(itemIds)
    } finally {
      setSyncing(false)

      // Check for more items to process
      const remaining = await getPendingSyncCount()
      if (remaining > 0 && navigator.onLine && isMounted.current) {
        setTimeout(() => {
          // Use ref to get latest function
          processSyncQueueRef.current?.()
        }, 1000)
      }
    }
  }, [sheetId, syncing])

  // Update ref whenever processSyncQueue changes
  useEffect(() => {
    processSyncQueueRef.current = processSyncQueue
  }, [processSyncQueue])

  const syncPendingChanges = useCallback(async () => {
    // This is now handled by processSyncQueue
    await processSyncQueueRef.current?.()
  }, [])

  const handleHabitsChange = useCallback((updatedHabits: Habit[]) => {
    // Track deleted habits - compare OLD habits against NEW habits
    const newIds = new Set(updatedHabits.map(h => h.id))
    const deletedIds = habits
      .filter(h => !newIds.has(h.id))
      .map(h => h.id)
      .filter(id => !id.startsWith('local-'))

    if (deletedIds.length > 0) {
      console.log('🗑️ Detected deletions:', deletedIds)
      console.log('Current deletedHabitIds state:', Array.from(deletedHabitIds))
    }

    // Update timestamps for all modified habits before saving
    const now = new Date()
    const habitsWithTimestamps = updatedHabits.map(h => ({ ...h, updatedAt: now }))

    setHabits(habitsWithTimestamps)

    // Update IndexedDB immediately
    habitsWithTimestamps.forEach(habit => {
      db.habits.put(habit).then(() => {
        console.log('IndexedDB updated for habit:', habit.name)
      })
    })
    // Delete from IndexedDB
    deletedIds.forEach(id => {
      db.habits.delete(id).then(() => {
        console.log('IndexedDB deleted for habit:', id)
      })
    })

    // Track deleted IDs for sync - combine old and new deletions
    const allDeletedIds = Array.from(new Set([...deletedHabitIds, ...deletedIds]))

    if (deletedIds.length > 0) {
      setDeletedHabitIds(prev => new Set([...prev, ...deletedIds]))
    }

    // Queue sync immediately with ALL deleted IDs (old + new)
    if (sheetId) {
      queueFullSync(sheetId, allDeletedIds).then(() => {
        // Trigger sync processing if online
        if (navigator.onLine && !syncing && isMounted.current) {
          // Small delay to batch rapid changes
          setTimeout(() => processSyncQueueRef.current?.(), 100)
        }
      })
    }
  }, [habits, deletedHabitIds, sheetId, syncing])

  const syncHabitsWithDeletions = useCallback(async (deletedIds: string[]) => {
    if (!sheetId || syncing) {
      console.log('Sync skipped - no sheetId or already syncing', { sheetId, syncing })
      if (sheetId && syncing) {
        // Already syncing, mark that there are pending changes
        setPendingSync(true)
      }
      return
    }

    console.log('Starting sync...')
    setSyncing(true)
    try {
      console.log('Deleted IDs to sync:', deletedIds)

      // Get the most recent habits from IndexedDB to ensure we sync all changes
      // IMPORTANT: Use sheetId (the actual ID) not slug (the URL param)
      const currentHabits = await db.habits.where('sheetId').equals(sheetId).toArray()
      console.log('Found', currentHabits.length, 'habits in IndexedDB for sheetId:', sheetId)
      const habitsToSync = currentHabits.filter(h => !deletedIds.includes(h.id))

      // Also add any deleted IDs from state that might not be in the passed list
      // This ensures we don't miss any deletions
      const allDeletedIds = Array.from(new Set([...deletedIds, ...deletedHabitIds]))
      console.log('Total deleted IDs to sync:', allDeletedIds)

      console.log('Sending request with', habitsToSync.length, 'habits and', deletedIds.length, 'deletions')
      // Log a sample habit to see completions
      if (habitsToSync.length > 0) {
        const sampleHabit = habitsToSync[0]
        console.log('Sample habit to sync:', {
          id: sampleHabit.id,
          name: sampleHabit.name,
          completions: sampleHabit.completions,
          completionCount: Object.keys(sampleHabit.completions || {}).length
        })
      }

      const response = await fetch(`/api/sheet/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          habits: habitsToSync.map(h => ({ ...h, sheetId })),
          deletedHabitIds: allDeletedIds,
        }),
      })

      console.log('Response status:', response.status)

      if (response.ok) {
        const data = await response.json()
        console.log('✅ Sync successful, server returned', data.habits?.length, 'habits')
        console.log('📤 Server habit IDs:', data.habits?.map((h: any) => h.id))
        setSheetUpdatedAt(new Date(data.updatedAt))

        // Filter out any habits that are in our deletion list
        // This prevents deleted habits from coming back due to timing issues
        // Use both allDeletedIds (from this sync) and deletedHabitIds (from state)
        const deletedIdsSet = new Set([...allDeletedIds, ...deletedHabitIds])
        const filteredHabits = data.habits.filter((h: any) => !deletedIdsSet.has(h.id))

        if (filteredHabits.length !== data.habits.length) {
          console.log('🔍 Filtered out', data.habits.length - filteredHabits.length, 'habits that were marked for deletion')
          console.log('🗑️ Deleted IDs:', Array.from(deletedIdsSet))
        }

        // Update local state with merged server result
        // This ensures we have the latest version of each habit
        setHabits(filteredHabits)

        // Update IndexedDB with server data
        for (const habit of data.habits) {
          await db.habits.put(habit)
        }
        // Clean up any remaining local- habits
        const allLocalHabits = await db.habits.where('sheetId').equals(sheetId).toArray()
        for (const habit of allLocalHabits) {
          if (habit.id.startsWith('local-')) {
            await db.habits.delete(habit.id)
          }
        }

        // Clear ALL synced deleted IDs from state after successful sync
        if (allDeletedIds.length > 0) {
          console.log('Synced deletions:', allDeletedIds)
          setDeletedHabitIds(prev => {
            const newSet = new Set(prev)
            allDeletedIds.forEach(id => newSet.delete(id))
            return newSet
          })
        }
        setPendingSync(false)
      } else {
        console.error('Sync failed with status:', response.status)
        const errorText = await response.text()
        console.error('Error response:', errorText)
        throw new Error(`Sync failed: ${response.status}`)
      }
    } catch (err) {
      console.error('Sync failed:', err)
      if (isMounted.current) {
        setError('Sync failed. Changes saved locally.')
      }
    } finally {
      if (isMounted.current) {
        setSyncing(false)
      }
      console.log('Sync complete')
    }
  }, [sheetId, slug, syncing, deletedHabitIds])

  // Update ref whenever syncHabitsWithDeletions changes
  useEffect(() => {
    syncHabitsWithDeletionsRef.current = syncHabitsWithDeletions
  }, [syncHabitsWithDeletions])

  const handleShare = useCallback(() => {
    if (navigator.share) {
      navigator.share({
        title: 'Habits',
        text: 'Track habits with me!',
        url: window.location.href,
      })
    } else {
      navigator.clipboard.writeText(window.location.href)
        .then(() => console.log('Link copied to clipboard'))
        .catch(() => console.error('Failed to copy link'))
    }
  }, [])

  const createSheet = useCallback(async () => {
    setIsCreatingSheet(true)
    try {
      const response = await fetch('/api/sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Habits' }),
      })

      if (response.ok) {
        const data = await response.json()
        // Navigate to the new sheet
        router.push(`/${data.slug}`)
      }
    } catch (err) {
      console.error('Failed to create sheet:', err)
    } finally {
      setIsCreatingSheet(false)
    }
  }, [router])

  const handleAddHabit = useCallback((name: string, group: string) => {
    const maxOrder = habits.reduce((max, h) => Math.max(max, h.order), -1)
    const newHabit: Habit = {
      id: `local-${Date.now()}`,
      sheetId: sheetId || '',
      name,
      group,
      completions: {},
      order: maxOrder + 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    setHabits([...habits, newHabit])
  }, [habits, sheetId])

  const existingGroups = useMemo(() => {
    return Object.keys(habits.reduce<Record<string, Habit[]>>((acc, habit) => {
      if (!acc[habit.group]) {
        acc[habit.group] = []
      }
      acc[habit.group].push(habit)
      return acc
    }, {}))
  }, [habits])

  const handleSheetChange = useCallback((newSlug: string) => {
    if (newSlug === 'new') {
      createSheet()
    } else if (newSlug !== slug) {
      router.push(`/${newSlug}`)
    }
  }, [slug, router, createSheet])

  const saveSheetName = useCallback(async (newName: string) => {
    if (!newName.trim()) return

    try {
      const response = await fetch(`/api/sheet/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      })

      if (response.ok && isMounted.current) {
        const updatedName = newName.trim()
        setSheetName(updatedName)
        // Update the name in userSheets
        const updatedSheets = getUserSheets().map(s =>
          s.slug === slug ? { ...s, name: updatedName } : s
        )
        setUserSheets(updatedSheets)
        saveUserSheets(updatedSheets)
      }
    } catch (err) {
      console.error('Failed to save name:', err)
    }
  }, [slug])

  // Fetch server updates (for real-time sync between clients)
  const fetchServerUpdates = useCallback(async () => {
    if (!sheetId || !sheetUpdatedAt || syncing || !navigator.onLine) return

    try {
      const response = await fetch(`/api/sheet/${slug}`)
      if (!response.ok) return

      const data = await response.json()
      const serverUpdatedAt = new Date(data.updatedAt)

      // Only update if server has newer data
      if (serverUpdatedAt > sheetUpdatedAt) {
        console.log('📥 Server has newer data, updating...')

        // Use ref to get current habits
        const currentHabits = habitsRef.current

        // Merge server habits with local state
        // Keep local-only habits (newly created, not yet synced)
        const serverHabitsMap = new Map(data.habits.map((h: Habit) => [h.id, h]))
        const localHabitsMap = new Map(currentHabits.map(h => [h.id, h]))

        // Start with server habits
        const mergedHabits = [...data.habits]

        // Add any local-only habits (newly created, not yet synced to server)
        for (const [id, habit] of localHabitsMap) {
          if (id.startsWith('local-') && !serverHabitsMap.has(id)) {
            mergedHabits.push(habit)
          }
        }

        setSheetUpdatedAt(serverUpdatedAt)
        setHabits(mergedHabits)
        setSheetName(data.name || 'My Habits')

        // Update IndexedDB
        for (const habit of data.habits) {
          await db.habits.put(habit)
        }

        console.log('✅ Updated with server changes, now have', mergedHabits.length, 'habits')
      }
    } catch (err) {
      console.error('Failed to fetch server updates:', err)
    }
  }, [sheetId, slug, sheetUpdatedAt, syncing])

  // Poll for server updates every 2 seconds (for real-time sync between clients)
  useEffect(() => {
    if (!sheetId) return

    const interval = setInterval(() => {
      if (navigator.onLine && !syncing) {
        fetchServerUpdates()
      }
    }, 2000)

    return () => clearInterval(interval)
  }, [sheetId, syncing, fetchServerUpdates])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-red-600">{error}</p>
          <Button onClick={() => router.push('/')}>Go Home</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-50 pt-4 pl-2">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-7 mx-4 gap-2">
          {isEditingName ? (
            <div className="flex items-center gap-2 flex-1">
              <input
                type="text"
                defaultValue={sheetName}
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    saveSheetName((e.target as HTMLInputElement).value)
                    setIsEditingName(false)
                  } else if (e.key === 'Escape') {
                    setIsEditingName(false)
                  }
                }}
                onBlur={e => {
                  saveSheetName((e.target as HTMLInputElement).value)
                  setIsEditingName(false)
                }}
                className="text-xl font-bold bg-transparent border-b-2 border-zinc-300 focus:outline-none focus:border-zinc-900 flex-1"
              />
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <select
                value={slug}
                onChange={(e) => handleSheetChange(e.target.value)}
                disabled={loading || isCreatingSheet}
                className="text-xl font-bold bg-transparent border-none focus:outline-none cursor-pointer truncate max-w-[300px]"
              >
                {userSheets.map(sheet => (
                  <option key={sheet.slug} value={sheet.slug}>
                    {sheet.name}
                  </option>
                ))}
                <option value="new" className="font-medium">+ New Habits Sheet</option>
              </select>
              <button
                onClick={() => setIsEditingName(true)}
                className="text-gray-400 hover:text-gray-600 p-1"
                title="Rename sheet"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
                </svg>
              </button>
            </div>
          )}
          <div className="flex items-center gap-1">
            <AddHabitDialog onAdd={handleAddHabit} existingGroups={existingGroups} />
            <Button onClick={handleShare} variant="outline" size="sm" className="gap-2 p-2">
              <Share2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Only render HabitGrid once we have a sheetId */}
        {sheetId && (
          <HabitGrid
            habits={habits.filter(h => !deletedHabitIds.has(h.id))}
            onHabitsChange={handleHabitsChange}
            onAddHabit={handleAddHabit}
            existingGroups={existingGroups}
            sheetId={sheetId}
          />
        )}
      </div>
    </div>
  )
}
