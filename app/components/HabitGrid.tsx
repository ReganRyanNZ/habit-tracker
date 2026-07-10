'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Habit } from '@/lib/db-local'
import { formatDate, formatDateKey, getMonthRange, getMonthName, isToday } from '@/lib/utils'
import HabitRow from './HabitRow'
import { Button } from '@/components/ui/button'

interface HabitGridProps {
  habits: Habit[]
  onHabitsChange: (habits: Habit[]) => void
  onAddHabit: (name: string, group: string) => void
  groupId: string
  isOwner: boolean
}

export default function HabitGrid({ habits, onHabitsChange, onAddHabit, groupId, isOwner }: HabitGridProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Month selection state
  const today = new Date()
  const [selectedYear, setSelectedYear] = useState(today.getFullYear())
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth())

  // Delete confirmation state
  const [habitToDelete, setHabitToDelete] = useState<Habit | null>(null)

  // Get dates for the selected month
  const dates = useMemo(() => getMonthRange(selectedYear, selectedMonth), [selectedYear, selectedMonth])

  // Sort habits by order
  const sortedHabits = useMemo(() => {
    return [...habits].sort((a, b) => a.order - b.order)
  }, [habits])

  // Find the index of today in the dates array for scrolling
  const todayIndex = useMemo(() => {
    return dates.findIndex(date => isToday(date))
  }, [dates])

  // Scroll to position today on the right side of the screen
  useEffect(() => {
    if (scrollContainerRef.current && todayIndex >= 0) {
      const container = scrollContainerRef.current
      const columnWidth = 44
      const containerWidth = container.clientWidth
      const targetPosition = (todayIndex * columnWidth) - containerWidth + columnWidth

      container.scrollTo({
        left: Math.max(0, targetPosition),
        behavior: 'smooth'
      })
    }
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
    if (!isOwner) return

    const updatedHabits = habits.map(habit => {
      if (habit.id === habitId) {
        const completions = { ...habit.completions }
        completions[dateKey] = !completions[dateKey]
        return { ...habit, completions, updatedAt: new Date() }
      }
      return habit
    })
    onHabitsChange(updatedHabits)
  }, [habits, onHabitsChange, isOwner])

  const handleDeleteHabit = useCallback((habitId: string) => {
    if (!isOwner) return

    const habit = habits.find(h => h.id === habitId)
    if (habit) {
      setHabitToDelete(habit)
    }
  }, [habits, isOwner])

  const confirmDelete = useCallback(() => {
    if (habitToDelete && isOwner) {
      onHabitsChange(habits.filter(h => h.id !== habitToDelete.id))
      setHabitToDelete(null)
    }
  }, [habitToDelete, habits, onHabitsChange, isOwner])

  const cancelDelete = useCallback(() => {
    setHabitToDelete(null)
  }, [])

  const handleRenameHabit = useCallback((habitId: string, newName: string) => {
    if (!isOwner) return

    const updatedHabits = habits.map(habit =>
      habit.id === habitId ? { ...habit, name: newName, updatedAt: new Date() } : habit
    )
    onHabitsChange(updatedHabits)
  }, [habits, onHabitsChange, isOwner])

  const handleReorderHabit = useCallback((habitId: string, direction: 'up' | 'down') => {
    if (!isOwner) return

    const habitIndex = habits.findIndex(h => h.id === habitId)
    if (habitIndex === -1) return

    const newHabits = [...habits]
    const targetIndex = direction === 'up' ? habitIndex - 1 : habitIndex + 1

    if (targetIndex < 0 || targetIndex >= habits.length) return

    [newHabits[habitIndex], newHabits[targetIndex]] = [newHabits[targetIndex], newHabits[habitIndex]]

    newHabits.forEach((habit, index) => {
      habit.order = index
    })

    onHabitsChange(newHabits)
  }, [habits, onHabitsChange, isOwner])

  return (
    <div className="w-full">
      <div ref={scrollContainerRef} className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="text-left p-1 min-w-[120px] sticky left-0 bg-white z-10 shadow-[1px_0_4px_rgba(0,0,0,0.1)] text-xs font-medium">
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
                <th key={date.toISOString()} className="text-center p-1 min-w-[40px]">
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
            {sortedHabits.map(habit => (
              <HabitRow
                key={habit.id}
                habit={habit}
                dates={dates}
                onToggleCompletion={handleToggleCompletion}
                onDelete={handleDeleteHabit}
                onRename={handleRenameHabit}
                onReorder={handleReorderHabit}
                isOwner={isOwner}
              />
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
