'use client'

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Habit } from '@/lib/db-local'
import { formatDate, formatDateKey, getMonthRange, getMonthName, isToday } from '@/lib/utils'
import HabitRow from './HabitRow'
import { Button } from '@/components/ui/button'
import { UserMinus } from 'lucide-react'

interface SectionedHabit extends Habit {
  groupName: string
  groupId: string
  isOwner: boolean
}

interface HabitGridProps {
  habits: SectionedHabit[]
  onAddHabit: (name: string) => void
  myGroupId: string | null
  onUnfollow: (groupId: string) => void
  onToggleCompletion?: (habitId: string, dateKey: string) => void
  onDelete?: (habitId: string) => void
  onRename?: (habitId: string, newName: string) => void
  onReorder?: (habitId: string, direction: 'up' | 'down') => void
}

export default function HabitGrid({
  habits,
  onAddHabit,
  myGroupId,
  onUnfollow,
  onToggleCompletion,
  onDelete,
  onRename,
  onReorder,
}: HabitGridProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Month selection state
  const today = new Date()
  const [selectedYear, setSelectedYear] = useState(today.getFullYear())
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth())

  // Delete confirmation state
  const [habitToDelete, setHabitToDelete] = useState<SectionedHabit | null>(null)

  // Track which group section is active (for showing unfollow button)
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)

  // Get dates for the selected month
  const dates = useMemo(() => getMonthRange(selectedYear, selectedMonth), [selectedYear, selectedMonth])

  // Sort habits: first by group (my group first, then followed groups), then by order within each group
  const sortedHabits = useMemo(() => {
    if (!habits || habits.length === 0) return []
    return [...habits].sort((a, b) => {
      // My group always comes first
      if (a.isOwner && !b.isOwner) return -1
      if (!a.isOwner && b.isOwner) return 1

      // Within the same group, sort by order
      if (a.groupId === b.groupId) {
        return a.order - b.order
      }

      // Different groups - sort by groupId for consistency
      return a.groupId.localeCompare(b.groupId)
    })
  }, [habits])

  // Build flat habit list with section markers
  const { flatHabits, sectionIndices } = useMemo(() => {
    const flat: SectionedHabit[] = []
    const indices: Set<number> = new Set()
    let currentGroupId: string | null = null

    sortedHabits.forEach((habit, index) => {
      // Mark section change (but not for the first/my group)
      if (currentGroupId !== null && currentGroupId !== habit.groupId) {
        indices.add(index)
      }
      currentGroupId = habit.groupId
      flat.push(habit)
    })

    return { flatHabits: flat, sectionIndices: indices }
  }, [sortedHabits])

  // Find the index of today in the dates array for scrolling
  const todayIndex = useMemo(() => {
    return dates.findIndex(date => isToday(date))
  }, [dates])

  // Scroll so today's column lands in the middle of the visible date area
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container || todayIndex < 0) return

    // headers[0] is the sticky month column; today's <th> is the one after it.
    // Measure real positions so we don't depend on guessed column widths.
    const headers = container.querySelectorAll('thead th')
    const stickyTh = headers[0]
    const todayTh = headers[todayIndex + 1]
    if (!stickyTh || !todayTh) return

    const cRect = container.getBoundingClientRect()
    const tRect = todayTh.getBoundingClientRect()
    const todayCenter = tRect.left + tRect.width / 2
    const stickyWidth = stickyTh.getBoundingClientRect().width
    // Center today within the scrollable region to the right of the sticky column
    const viewportCenter = cRect.left + stickyWidth + (cRect.width - stickyWidth) / 2

    container.scrollTo({
      left: container.scrollLeft + (todayCenter - viewportCenter),
      behavior: 'smooth',
    })
  }, [todayIndex])

  // Available months for the selector
  const availableMonths = useMemo(() => {
    const months: Array<{ year: number; month: number; label: string }> = []
    const current = new Date()

    for (let i = 12; i >= 0; i--) {
      const date = new Date(current.getFullYear(), current.getMonth() - i, 1)
      months.push({
        year: date.getFullYear(),
        month: date.getMonth(),
        label: getMonthName(date.getFullYear(), date.getMonth())
      })
    }

    for (let i = 0; i <= 6; i++) {
      const date = new Date(current.getFullYear(), current.getMonth() + i, 1)
      if (i === 0) continue
      months.push({
        year: date.getFullYear(),
        month: date.getMonth(),
        label: getMonthName(date.getFullYear(), date.getMonth())
      })
    }

    return months
  }, [])

  // Memoize callbacks to prevent unnecessary re-renders
  const handleToggleCompletion = useCallback((habitId: string, dateKey: string) => {
    if (!onToggleCompletion) return
    onToggleCompletion(habitId, dateKey)
  }, [onToggleCompletion])

  const handleDelete = useCallback((habitId: string) => {
    if (!onDelete) return
    const habit = habits.find(h => h.id === habitId)
    if (habit && habit.isOwner) {
      setHabitToDelete(habit)
    }
  }, [onDelete, habits])

  const confirmDelete = useCallback(() => {
    if (habitToDelete && onDelete) {
      onDelete(habitToDelete.id)
      setHabitToDelete(null)
    }
  }, [habitToDelete, onDelete])

  const cancelDelete = useCallback(() => {
    setHabitToDelete(null)
  }, [])

  const handleRename = useCallback((habitId: string, newName: string) => {
    if (!onRename) return
    onRename(habitId, newName)
  }, [onRename])

  const handleReorder = useCallback((habitId: string, direction: 'up' | 'down') => {
    if (!onReorder) return
    onReorder(habitId, direction)
  }, [onReorder])

  return (
    <div className="w-full" onClick={() => setActiveGroupId(null)}>
      {/* Scrollable container with the full table */}
      <div ref={scrollContainerRef} className="overflow-x-auto">
        <table className="w-full border-collapse">
          {/* Calendar header - sticky at top */}
          <thead className="sticky top-0 z-20 bg-white">
            <tr>
              <th className="text-left p-1 min-w-[120px] sticky left-0 bg-white z-30 shadow-[1px_0_4px_rgba(0,0,0,0.1)] text-xs font-medium">
                <select
                  value={`${selectedYear}-${selectedMonth}`}
                  onChange={(e) => {
                    const [year, month] = e.target.value.split('-').map(Number)
                    setSelectedYear(year)
                    setSelectedMonth(month)
                  }}
                  className="text-sm font-medium bg-transparent border-none focus:outline-none cursor-pointer w-full"
                >
                  {availableMonths.map(({ year, month, label }) => (
                    <option key={`${year}-${month}`} value={`${year}-${month}`}>
                      {label}
                    </option>
                  ))}
                </select>
              </th>
              {dates.map(date => (
                <th key={date.toISOString()} className="text-center p-1 min-w-[40px] bg-white z-20">
                  <div className="flex flex-col items-center">
                    <span className={`text-xs font-medium ${isToday(date) ? 'text-blue-600' : 'text-gray-500'}`}>
                      {formatDate(date, 'day')}
                    </span>
                    <span className={`text-xs ${isToday(date) ? 'font-bold text-blue-600' : 'text-gray-400'}`}>
                      {date.getDate()}
                    </span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {flatHabits.map((habit, index) => (
              <React.Fragment key={habit.id}>
                {/* Section header row */}
                {sectionIndices.has(index) && (
                  <tr className="h-12">
                    <td
                      className="p-0 min-w-[120px] sticky left-0 bg-zinc-50 z-10"
                      onClick={(e) => {
                        e.stopPropagation()
                        setActiveGroupId(activeGroupId === habit.groupId ? null : habit.groupId)
                      }}
                    >
                      <div className="flex items-center justify-between h-full px-4 cursor-pointer">
                        <span className="text-sm font-semibold text-zinc-600">{habit.groupName}</span>
                        {activeGroupId === habit.groupId && (
                          <Button
                            onClick={(e) => {
                              e.stopPropagation()
                              onUnfollow(habit.groupId)
                            }}
                            variant="ghost"
                            size="sm"
                            className="text-zinc-400 hover:text-red-600 h-6 px-2"
                          >
                            <UserMinus className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </td>
                    <td colSpan={dates.length} className="p-0 bg-zinc-50"></td>
                  </tr>
                )}
                {/* Habit row */}
                <HabitRow
                  habit={habit}
                  dates={dates}
                  onToggleCompletion={handleToggleCompletion}
                  onDelete={handleDelete}
                  onRename={handleRename}
                  onReorder={handleReorder}
                  isOwner={habit.isOwner}
                />
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Delete confirmation dialog */}
      {habitToDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-sm mx-4 shadow-lg">
            <h3 className="text-lg font-semibold mb-2">Delete habit?</h3>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete "<span className="font-medium">{habitToDelete.name}</span>"? This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={cancelDelete}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={confirmDelete}>
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
