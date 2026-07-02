import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Generate a random 8-character slug
export function generateSlug(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

// Get date range for view (days or month)
// For days view: shows today as the right-most column, going backwards
// For month view: shows all days in the current month
export function getDateRange(view: 'week' | 'month', sheetCreatedAt?: Date): Date[] {
  const today = new Date()
  const dates: Date[] = []

  if (view === 'week') {
    // Days view: show last 30 days with today on the right
    for (let i = 29; i >= 0; i--) {
      const date = new Date(today)
      date.setDate(today.getDate() - i)
      dates.push(date)
    }
  } else {
    // Month view: show all days in current month
    const year = today.getFullYear()
    const month = today.getMonth()
    const daysInMonth = new Date(year, month + 1, 0).getDate()

    for (let day = 1; day <= daysInMonth; day++) {
      dates.push(new Date(year, month, day))
    }
  }

  return dates
}

// Get date range for a specific month (year 0-indexed month)
export function getMonthRange(year: number, month: number): Date[] {
  const dates: Date[] = []
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  for (let day = 1; day <= daysInMonth; day++) {
    dates.push(new Date(year, month, day))
  }

  return dates
}

// Get month name (e.g., "January 2026")
export function getMonthName(year: number, month: number): string {
  return new Date(year, month).toLocaleDateString('en-US', { year: 'numeric', month: 'long' })
}

// Format date for display (e.g., "Mon", "Jun 29")
export function formatDate(date: Date, format: 'short' | 'day' | 'full' = 'short'): string {
  const options: Intl.DateTimeFormatOptions = {
    month: format === 'day' ? undefined : 'short',
    day: format === 'day' ? undefined : 'numeric',
    weekday: format === 'day' ? 'short' : undefined,
  }
  return date.toLocaleDateString('en-US', options)
}

// Format date as YYYY-MM-DD for storage (local time)
export function formatDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// Check if two dates are the same day
export function isSameDay(date1: Date, date2: Date): boolean {
  return formatDateKey(date1) === formatDateKey(date2)
}

// Check if date is today
export function isToday(date: Date): boolean {
  return isSameDay(date, new Date())
}
