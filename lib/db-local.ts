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

// Action types for sync
export type Action =
  | { type: 'create_habit'; id: string; name: string; order: number; timestamp: number }
  | { type: 'rename_habit'; id: string; name: string; timestamp: number }
  | { type: 'delete_habit'; id: string; timestamp: number }
  | { type: 'toggle_completion'; id: string; dateKey: string; completed: boolean; timestamp: number }
  | { type: 'reorder_habit'; id: string; order: number; timestamp: number }

// Sync queue stores pending actions
export interface SyncQueue {
  id?: number
  actions: Action[]
  lastSyncAt: number // Server timestamp we're synced up to
}

export class HabitDatabase extends Dexie {
  habitGroups!: Table<HabitGroup>
  habits!: Table<Habit>
  following!: Table<FollowedGroup>
  syncQueue!: Table<SyncQueue>

  constructor() {
    super('HabitTrackerDB')
    this.version(1).stores({
      habitGroups: 'id, userId, shareToken, updatedAt',
      habits: 'id, groupId, order, updatedAt',
      following: 'id, userId, groupId, groupUserId, shareToken',
      syncQueue: '++id, type, groupId, timestamp'
    }).upgrade(tx => {
      // Clear old syncQueue data during upgrade
      tx.table('syncQueue').clear()
    })
    this.version(2).stores({
      habitGroups: 'id, userId, shareToken, updatedAt',
      habits: 'id, groupId, order, updatedAt',
      following: 'id, userId, groupId, groupUserId, shareToken',
      syncQueue: '++id, lastSyncAt'
    })
  }
}

export const db = new HabitDatabase()

// ============================================================================
// Action Queue Management
// ============================================================================

// Get the sync queue (there should only be one record)
export async function getSyncQueue(): Promise<SyncQueue> {
  try {
    const queue = await db.syncQueue.toCollection().first()
    // Ensure we always have a valid queue object with arrays
    if (queue && Array.isArray(queue.actions)) {
      return queue
    }
    return { actions: [], lastSyncAt: 0 }
  } catch (error) {
    console.error('Error getting sync queue:', error)
    return { actions: [], lastSyncAt: 0 }
  }
}

// Add actions to the queue
export async function addActionToQueue(action: Action): Promise<void> {
  const queue = await getSyncQueue()
  queue.actions.push(action)
  queue.actions.sort((a, b) => a.timestamp - b.timestamp) // Keep sorted
  if (queue.id) {
    await db.syncQueue.update(queue.id, { actions: queue.actions, lastSyncAt: queue.lastSyncAt })
  } else {
    await db.syncQueue.add(queue)
  }
}

// Add multiple actions to the queue
export async function addActionsToQueue(actions: Action[]): Promise<void> {
  if (actions.length === 0) return

  const queue = await getSyncQueue()
  queue.actions.push(...actions)
  queue.actions.sort((a, b) => a.timestamp - b.timestamp)
  if (queue.id) {
    await db.syncQueue.update(queue.id, { actions: queue.actions, lastSyncAt: queue.lastSyncAt })
  } else {
    await db.syncQueue.add(queue)
  }
}

// Stable signature for an action, used to dedupe the queue after a sync
function actionSignature(a: Action): string {
  if ('dateKey' in a) {
    return JSON.stringify({ type: a.type, id: a.id, dateKey: a.dateKey, timestamp: a.timestamp })
  }
  return JSON.stringify({ type: a.type, id: a.id, timestamp: a.timestamp })
}

// Remove actions from the queue (after successful sync)
export async function removeActionsFromQueue(actionsToRemove: Action[]): Promise<void> {
  const queue = await getSyncQueue()
  const toRemove = new Set(actionsToRemove.map(actionSignature))
  queue.actions = queue.actions.filter(a => !toRemove.has(actionSignature(a)))

  if (queue.id) {
    await db.syncQueue.update(queue.id, { actions: queue.actions, lastSyncAt: queue.lastSyncAt })
  } else {
    await db.syncQueue.add(queue)
  }
}

// Clear the entire queue (for testing/logout)
export async function clearSyncQueue(): Promise<void> {
  await db.syncQueue.clear()
}

// Get pending action count
export async function getPendingActionCount(): Promise<number> {
  const queue = await getSyncQueue()
  return queue.actions.length
}

// Update the lastSync timestamp
export async function updateLastSyncAt(timestamp: number): Promise<void> {
  const queue = await getSyncQueue()
  queue.lastSyncAt = timestamp
  if (queue.id) {
    await db.syncQueue.update(queue.id, { lastSyncAt: timestamp })
  } else {
    await db.syncQueue.add(queue)
  }
}

// ============================================================================
// Action Reducer - Apply actions to habits
// ============================================================================

// Apply a single action to a habits array
function applyActionToHabits(habits: Habit[], action: Action): Habit[] {
  switch (action.type) {
    case 'create_habit':
      // Check if habit already exists (from server sync)
      if (habits.find(h => h.id === action.id)) {
        return habits.map(h =>
          h.id === action.id
            ? { ...h, name: action.name, order: action.order, updatedAt: new Date(action.timestamp) }
            : h
        )
      }
      return [
        ...habits,
        {
          id: action.id,
          groupId: '', // Will be filled in by caller
          name: action.name,
          completions: {},
          order: action.order,
          createdAt: new Date(action.timestamp),
          updatedAt: new Date(action.timestamp),
        },
      ]

    case 'rename_habit':
      return habits.map(h =>
        h.id === action.id
          ? { ...h, name: action.name, updatedAt: new Date(action.timestamp) }
          : h
      )

    case 'delete_habit':
      return habits.filter(h => h.id !== action.id)

    case 'toggle_completion':
      return habits.map(h =>
        h.id === action.id
          ? {
              ...h,
              completions: {
                ...h.completions,
                [action.dateKey]: {
                  completed: action.completed,
                  timestamp: action.timestamp,
                },
              },
              updatedAt: new Date(action.timestamp),
            }
          : h
      )

    case 'reorder_habit':
      const habitToMove = habits.find(h => h.id === action.id)
      if (!habitToMove) return habits

      // Remove the habit from its current position
      const otherHabits = habits.filter(h => h.id !== action.id)
      // Insert at the new position
      const result = [...otherHabits]
      result.splice(action.order, 0, { ...habitToMove, order: action.order, updatedAt: new Date(action.timestamp) })

      // Update order values for all habits
      return result.map((h, i) => ({ ...h, order: i }))

    default:
      return habits
  }
}

// Apply multiple actions to habits
export function applyActionsToHabits(habits: Habit[], actions: Action[]): Habit[] {
  if (!habits) habits = []
  if (!actions) actions = []
  let result = habits
  for (const action of actions) {
    result = applyActionToHabits(result, action)
  }
  return result
}

// ============================================================================
// Base State Management
// ============================================================================

// Save or update habit group locally
export async function saveHabitGroup(group: HabitGroup) {
  await db.habitGroups.put(group)
}

// Save or update habit locally
export async function saveHabit(habit: Habit) {
  await db.habits.put(habit)
}

// Save or update multiple habits locally
export async function saveHabits(habits: Habit[]) {
  await db.habits.bulkPut(habits)
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

// ============================================================================
// Helper: Get display state (base + pending actions)
// ============================================================================

// Get the current display state for a group (base habits + pending actions)
export async function getDisplayState(groupId: string): Promise<Habit[]> {
  const baseHabits = await getHabitsForGroup(groupId)
  const queue = await getSyncQueue()
  return applyActionsToHabits(baseHabits, queue.actions)
}
