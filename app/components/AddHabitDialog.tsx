'use client'

import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Plus, ChevronDown } from 'lucide-react'

interface AddHabitDialogProps {
  onAdd: (name: string, group: string) => void
  existingGroups: string[]
}

export default function AddHabitDialog({ onAdd, existingGroups }: AddHabitDialogProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [group, setGroup] = useState(existingGroups[0] || 'My Habits')
  const [showDropdown, setShowDropdown] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (name.trim()) {
      onAdd(name.trim(), group.trim() || 'My Habits')
      setName('')
      setGroup(existingGroups[0] || 'My Habits')
      setOpen(false)
      setShowDropdown(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2 p-2">
          <Plus className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent
        onPointerDownOutside={(e) => {
          // Prevent closing when clicking outside - user must use Cancel button
          e.preventDefault()
        }}
        onEscapeKeyDown={(e) => {
          // Prevent closing on escape - user must use Cancel button
          e.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>Add New Habit</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="habit-name">Habit Name</Label>
              <input
                id="habit-name"
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full px-3 py-2 border rounded-md"
                placeholder="e.g., Exercise, Read, Meditate"
                autoComplete="off"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="habit-group">Habit Group (select existing or type a new one)</Label>
              <div className="relative">
                <input
                  id="habit-group"
                  type="text"
                  value={group}
                  onChange={(e) => {
                    setGroup(e.target.value)
                  }}
                  onFocus={() => setShowDropdown(true)}
                  className="w-full px-3 py-2 pr-10 border rounded-md"
                  placeholder="Select existing or type new group..."
                  autoComplete="off"
                  onBlur={() => {
                    // Delay closing to allow clicking on dropdown items
                    setTimeout(() => setShowDropdown(false), 200)
                  }}
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-100 rounded"
                  onClick={(e) => {
                    e.preventDefault()
                    setShowDropdown(!showDropdown)
                  }}
                >
                  <ChevronDown className="h-4 w-4 text-gray-500" />
                </button>
                {showDropdown && existingGroups.length > 0 && (
                  <div className="absolute z-[100] top-full left-0 right-0 mt-1 bg-white border rounded-md shadow-lg max-h-60 overflow-auto">
                    {existingGroups.map(g => (
                      <div
                        key={g}
                        className="px-3 py-2 hover:bg-gray-100 cursor-pointer"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          setGroup(g)
                          setShowDropdown(false)
                        }}
                      >
                        {g}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Add Habit</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
