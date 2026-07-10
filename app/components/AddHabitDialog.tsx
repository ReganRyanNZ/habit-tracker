'use client'

import { useState } from 'react'
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
import { Plus } from 'lucide-react'

interface AddHabitDialogProps {
  onAdd: (name: string) => void
}

export default function AddHabitDialog({ onAdd }: AddHabitDialogProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (name.trim()) {
      onAdd(name.trim())
      setName('')
      setOpen(false)
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
          e.preventDefault()
        }}
        onEscapeKeyDown={(e) => {
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
