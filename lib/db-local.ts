import Dexie, { Table } from 'dexie'

export interface HabitGroup {
  id: string
  userId: string
  name: string
  shareToken: string
  createdAt: Date
  updatedAt: Date
}

export interface Habit {
  id: string
  groupId: string
  name: string
  completions: Record<string, { completed: boolean; timestamp: number }>
  order: number
  createdAt: Date
  updatedAt: Date
}

export interface FollowedGroup {
  id: string
  userId: string
  groupId: string
  groupUserId: string
  groupName: string
  shareToken: string
  followedAt: Date
  habits: Habit[]
}

export interface SyncQueueItem {
  id?: number
  type: 'UPDATE_HABITS' | 'FULL_SYNC'
  groupId?: string
  habitData?: any
  timestamp: number
  retryCount?: number
  lastRetry?: number
}

export class HabitDatabase extends Dexie {
  habitGroups!: Table<HabitGroup>
  habits!: Table<Habit>
  following!: Table<FollowedGroup>
  syncQueue!: Table<SyncQueueItem>

  constructor() {
    super('HabitTrackerDB')
    this.version(1).stores({
      habitGroups: 'id, userId, shareToken, updatedAt',
      habits: 'id, groupId, order, updatedAt',
      following: 'id, userId, groupId, groupUserId, shareToken',
      syncQueue: '++id, type, groupId, timestamp'
    })
  }
}

export const db = new HabitDatabase()

// Queue a full sync for a group
export async function queueFullSync(groupId: string, deletedHabitIds: string[] = []) {
  const habits = await db.habits.where('groupId').equals(groupId).toArray()
  await db.syncQueue.add({
    type: 'FULL_SYNC',
    groupId,
    habitData: { habits, deletedHabitIds },
    timestamp: Date.now(),
    retryCount: 0,
  })
}

// Get pending items ready for retry
export async function getItemsReadyForRetry(): Promise<SyncQueueItem[]> {
  const allItems = await db.syncQueue.toArray()
  const now = Date.now()

  return allItems.filter(item => {
    const retryCount = item.retryCount || 0
    const lastRetry = item.lastRetry || item.timestamp
    const backoffMs = Math.min(60000, Math.pow(2, retryCount) * 1000)
    return (now - lastRetry) >= backoffMs
  })
}

// Clear synced items
export async function clearSyncedItems(itemIds: number[]) {
  await db.syncQueue.where('id').anyOf(itemIds).delete()
}

// Mark retry as failed
export async function markRetryFailed(itemIds: number[]) {
  const items = await db.syncQueue.where('id').anyOf(itemIds).toArray()
  await Promise.all(items.map(item =>
    db.syncQueue.update(item.id!, {
      retryCount: (item.retryCount || 0) + 1,
      lastRetry: Date.now(),
    })
  ))
}

// Get pending sync count
export async function getPendingSyncCount(): Promise<number> {
  return await db.syncQueue.count()
}

// Save or update habit group locally
export async function saveHabitGroup(group: HabitGroup) {
  await db.habitGroups.put(group)
}

// Save or update habit locally
export async function saveHabit(habit: Habit) {
  await db.habits.put(habit)
}

// Save or update followed group locally
export async function saveFollowedGroup(group: FollowedGroup) {
  await db.following.put(group)
}

// Get habits for a group
export async function getHabitsForGroup(groupId: string): Promise<Habit[]> {
  return await db.habits.where('groupId').equals(groupId).toArray()
}

// Delete habit locally
export async function deleteHabit(habitId: string) {
  await db.habits.delete(habitId)
}

// Get user's habit group
export async function getUserHabitGroup(): Promise<HabitGroup | undefined> {
  return await db.habitGroups.toCollection().first()
}

// Get all followed groups
export async function getFollowedGroups(): Promise<FollowedGroup[]> {
  return await db.following.toArray()
}

// Delete a followed group
export async function deleteFollowedGroup(id: string) {
  await db.following.delete(id)
  // Also delete all habits for this group
  const habits = await db.habits.where('groupId').equals(id).toArray()
  await Promise.all(habits.map(h => db.habits.delete(h.id)))
}

// Clear all data (for testing/logout)
export async function clearAllData() {
  await db.habitGroups.clear()
  await db.habits.clear()
  await db.following.clear()
  await db.syncQueue.clear()
}
