// Date helpers for tasks. Dates are local "YYYY-MM-DD" strings throughout —
// they compare correctly with plain string comparison and avoid timezone
// surprises that Date/ISO round-trips introduce.

import type { Recurrence } from './types'

export function toDateStr(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function todayStr(): string {
  return toDateStr(new Date())
}

/** Parse "YYYY-MM-DD" as local midnight. */
export function parseDateStr(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDaysStr(date: string, days: number): string {
  const d = parseDateStr(date)
  d.setDate(d.getDate() + days)
  return toDateStr(d)
}

/** Add months keeping the day-of-month, clamped to the target month's end. */
function addMonthsStr(date: string, months: number): string {
  const d = parseDateStr(date)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + months)
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, last))
  return toDateStr(d)
}

/**
 * The next due date after completing a recurring task. Advances from the
 * task's due date, repeating until the result is in the future — so an
 * overdue "every day" task completed today lands on tomorrow, not on a
 * backlog of missed days.
 */
export function nextOccurrence(due: string, rec: Recurrence): string {
  const today = todayStr()
  const n = Math.max(1, rec.interval)
  let next = due
  do {
    switch (rec.freq) {
      case 'daily':
        next = addDaysStr(next, n)
        break
      case 'weekly':
        next = addDaysStr(next, 7 * n)
        break
      case 'monthly':
        next = addMonthsStr(next, n)
        break
      case 'yearly':
        next = addMonthsStr(next, 12 * n)
        break
    }
  } while (next <= today)
  return next
}

/** Agenda heading: "Today", "Tomorrow", "Fri 11 Jul" (+ year if not this year). */
export function dayHeading(date: string): string {
  const today = todayStr()
  if (date === today) return 'Today'
  if (date === addDaysStr(today, 1)) return 'Tomorrow'
  const d = parseDateStr(date)
  const label = d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
  return d.getFullYear() === new Date().getFullYear()
    ? label
    : `${label} ${d.getFullYear()}`
}

/** Compact due chip: "Today", "Tomorrow", "11 Jul", or the full heading when overdue. */
export function dueChipLabel(date: string): string {
  const today = todayStr()
  if (date === today) return 'Today'
  if (date === addDaysStr(today, 1)) return 'Tomorrow'
  if (date < today) return dayHeading(date)
  return parseDateStr(date).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })
}
