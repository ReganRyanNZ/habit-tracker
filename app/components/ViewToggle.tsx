'use client'

import { Button } from '@/components/ui/button'
import { CalendarDays, Calendar } from 'lucide-react'

type ViewMode = 'week' | 'month'

interface ViewToggleProps {
  view: ViewMode
  onViewChange: (view: ViewMode) => void
}

export default function ViewToggle({ view, onViewChange }: ViewToggleProps) {
  return (
    <div className="flex gap-1 p-1 bg-gray-100 rounded-lg">
      <Button
        variant={view === 'week' ? 'default' : 'ghost'}
        size="sm"
        onClick={() => onViewChange('week')}
        className="gap-2"
      >
        <CalendarDays className="h-4 w-4" />
        Days
      </Button>
      <Button
        variant={view === 'month' ? 'default' : 'ghost'}
        size="sm"
        onClick={() => onViewChange('month')}
        className="gap-2"
      >
        <Calendar className="h-4 w-4" />
        Month
      </Button>
    </div>
  )
}
