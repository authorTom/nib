import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { parseDateStr, toDateStr, todayStr } from '../tasks/dates'

interface MiniCalendarProps {
  selected: string
  onSelect: (date: string) => void
  /** Dates (YYYY-MM-DD) that have at least one open task — shown as dots. */
  markedDates: Set<string>
}

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

export default function MiniCalendar({
  selected,
  onSelect,
  markedDates,
}: MiniCalendarProps) {
  const [anchor, setAnchor] = useState(() => {
    const d = parseDateStr(selected)
    d.setDate(1)
    return d
  })
  const today = todayStr()

  const year = anchor.getFullYear()
  const month = anchor.getMonth()
  // Monday-first offset for the 1st of the month.
  const lead = (new Date(year, month, 1).getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) =>
      toDateStr(new Date(year, month, i + 1)),
    ),
  ]

  const move = (delta: number) =>
    setAnchor((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1))

  return (
    <div className="minical">
      <div className="minical-head">
        <span>
          {anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </span>
        <span className="minical-nav">
          <button
            type="button"
            className="icon-btn"
            onClick={() => move(-1)}
            aria-label="Previous month"
          >
            <ChevronLeft size={15} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => move(1)}
            aria-label="Next month"
          >
            <ChevronRight size={15} />
          </button>
        </span>
      </div>
      <div className="minical-grid">
        {DOW.map((d, i) => (
          <span key={`dow${i}`} className="minical-dow">
            {d}
          </span>
        ))}
        {cells.map((date, i) =>
          date === null ? (
            <span key={i} />
          ) : (
            <button
              key={i}
              type="button"
              className={`minical-day${date === selected ? ' selected' : ''}${
                date === today ? ' today' : ''
              }`}
              onClick={() => onSelect(date)}
            >
              {Number(date.slice(8))}
              {markedDates.has(date) && <span className="minical-dot" />}
            </button>
          ),
        )}
      </div>
    </div>
  )
}
