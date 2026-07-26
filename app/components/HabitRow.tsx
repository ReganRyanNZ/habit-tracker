'use client'

import { Habit, dotState } from '@/lib/db-local'
import { formatDateKey } from '@/lib/utils'
import { Trash2, Pencil, GripVertical } from 'lucide-react'
import { useState } from 'react'

interface HabitRowProps {
  habit: Habit
  dates: Date[]
  onToggleCompletion: (habitId: string, dateKey: string) => void
  onDelete: (habitId: string) => void
  onRename: (habitId: string, newName: string) => void
  onReorder?: (habitId: string, direction: 'up' | 'down') => void
  isOwner: boolean
  compact?: boolean
}

export default function HabitRow({ habit, dates, onToggleCompletion, onDelete, onRename, onReorder, isOwner, compact = false }: HabitRowProps) {
  const [showMenu, setShowMenu] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(habit.name)

  const handleCellClick = () => {
    if (!isOwner) return
    if (isEditing) return
    setShowMenu(!showMenu)
  }

  const handleSaveEdit = () => {
    if (editName.trim() && editName !== habit.name) {
      onRename(habit.id, editName.trim())
    }
    setIsEditing(false)
    setEditName(habit.name)
    setShowMenu(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveEdit()
    } else if (e.key === 'Escape') {
      setIsEditing(false)
      setEditName(habit.name)
      setShowMenu(false)
    }
  }

  const handleMenuClick = (action: 'edit' | 'delete', e: React.MouseEvent) => {
    e.stopPropagation()

    if (action === 'delete') {
      onDelete(habit.id)
      setShowMenu(false)
    } else if (action === 'edit') {
      setShowMenu(false)
      setIsEditing(true)
    }
  }

  const handleReorder = (direction: 'up' | 'down', e: React.MouseEvent) => {
    e.stopPropagation()
    onReorder?.(habit.id, direction)
  }

  return (
    <tr className="border-t hover:bg-gray-50">
      <td
        className={`${compact ? 'p-px' : 'p-1'} pl-2 align-middle sticky left-0 bg-white z-10 shadow-[1px_0_4px_rgba(0,0,0,0.1)] ${isOwner ? 'cursor-pointer' : ''}`}
        onClick={handleCellClick}
      >
        <div className="flex items-center gap-1">
          {isEditing ? (
            <input
              type="text"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              onBlur={handleSaveEdit}
              onKeyDown={handleKeyDown}
              className={`flex-1 px-2 py-1 ${compact ? 'text-xs' : 'text-sm'} border rounded`}
              autoFocus
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <>
              <span className={`${compact ? 'text-xs' : 'text-sm'} flex-1 truncate`}>{habit.name}</span>
              {isOwner && showMenu && (
                <>
                  <button
                    onClick={(e) => handleMenuClick('edit', e)}
                    className="p-1 text-blue-500 hover:bg-blue-50 rounded"
                    title="Edit"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    onClick={(e) => handleMenuClick('delete', e)}
                    className="p-1 text-red-500 hover:bg-red-50 rounded"
                    title="Delete"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                  {onReorder && (
                    <>
                      <button
                        onClick={(e) => handleReorder('up', e)}
                        className="p-1 text-gray-500 hover:bg-gray-100 rounded"
                        title="Move up"
                      >
                        ▲
                      </button>
                      <button
                        onClick={(e) => handleReorder('down', e)}
                        className="p-1 text-gray-500 hover:bg-gray-100 rounded"
                        title="Move down"
                      >
                        ▼
                      </button>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </td>
      {dates.map((date, index) => {
        const dateKey = formatDateKey(date)
        const state = dotState(habit.completions[dateKey])

        const colorClass =
          state === 'green' ? 'bg-green-500'
          : state === 'grey' ? 'bg-gray-200'
          : 'opacity-0' // clear -> blends into the background
        // Hover feedback only on real hover-capable devices (desktop). On touch,
        // :hover would "stick" after a tap and mask the state change.
        const hoverClass = isOwner
          ? state === 'green' ? '[@media(hover:hover)]:hover:bg-green-600'
            : state === 'grey' ? '[@media(hover:hover)]:hover:bg-gray-300'
            : '' // clear stays invisible; the owner clicks where the dot was to cycle
          : ''
        const fadeClass = !isOwner && state === 'grey' ? 'opacity-60' : ''

        return (
          <td key={date.toISOString()} className={`text-center align-middle ${compact ? 'p-px' : 'p-1'}`}>
            <button
              onClick={() => onToggleCompletion(habit.id, dateKey)}
              disabled={!isOwner}
              className={`block ${compact ? 'w-5 h-5' : 'w-7 h-7'} rounded-full mx-auto my-1 transition-all [-webkit-tap-highlight-color:transparent] ${colorClass} ${hoverClass} ${fadeClass} ${!isOwner ? 'cursor-not-allowed' : ''}`}
              aria-label={`Toggle ${habit.name} for ${dateKey}`}
            />
          </td>
        )
      })}
    </tr>
  )
}
