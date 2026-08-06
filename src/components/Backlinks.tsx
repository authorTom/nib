import { useState } from 'react'
import { ChevronRight, Link2 } from 'lucide-react'
import type { Backlink } from '../lib/wikilinks'

interface BacklinksProps {
  backlinks: Backlink[]
  onOpenNote: (id: string) => void
}

/** "Linked from" strip under the editor — collapsed until there's something in it. */
export default function Backlinks({ backlinks, onOpenNote }: BacklinksProps) {
  const [open, setOpen] = useState(true)

  if (backlinks.length === 0) return null

  return (
    <section className={`backlinks${open ? ' open' : ''}`}>
      <button
        type="button"
        className="backlinks-head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <ChevronRight size={14} className="backlinks-chevron" />
        <Link2 size={14} />
        <span>
          Linked from {backlinks.length} note{backlinks.length === 1 ? '' : 's'}
        </span>
      </button>

      <div className="backlinks-body">
        <div className="backlinks-inner">
          {backlinks.map((link) => (
            <button
              key={link.id}
              type="button"
              className="backlink"
              onClick={() => onOpenNote(link.id)}
            >
              <span className="backlink-title">{link.title}</span>
              <span className="backlink-context">{link.context}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
