// What Deckle is, and which Deckle this is.
//
// The version was already in the keyboard sheet, which is a fine place for
// someone who lives on the keyboard and a hopeless one for everybody else: you
// have to know the shortcut exists to find the number you need in order to file
// the bug. "About" is where people already look, so the number lives here and
// the keyboard sheet keeps its copy for whoever is already there.
//
// Kept deliberately thin. An about box that lists dependencies and build hashes
// is a changelog nobody asked for; this answers three questions — what is this,
// which version, and where are my notes — and stops.

import { useEffect } from 'react'
import { ExternalLink, X } from 'lucide-react'
import DeckleMark from './DeckleMark'
import { useEnterExit } from '../hooks/useEnterExit'
import { OVERLAY_EXIT_MS } from '../lib/motion'

/** Which of the three backends is holding the notes. */
export type StorageKind = 'server' | 'disk' | 'browser'

const WHERE: Record<StorageKind, string> = {
  server: 'In a volume on this server',
  disk: 'A folder on this computer',
  browser: 'Private storage in this browser',
}

const REPO = 'https://github.com/authorTom/deckle'

interface AboutModalProps {
  open: boolean
  onClose: () => void
  libraryName: string | null
  storage: StorageKind
}

export default function AboutModal({
  open,
  onClose,
  libraryName,
  storage,
}: AboutModalProps) {
  const anim = useEnterExit(open, OVERLAY_EXIT_MS)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!anim.render) return null

  return (
    <div
      className={`modal-overlay${anim.entered ? ' entered' : ''}`}
      onMouseDown={onClose}
    >
      <div
        className={`modal about-modal${anim.entered ? ' entered' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="About Deckle"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span className="modal-title">About</span>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            title="Close"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body about-body">
          <div className="about-masthead">
            <DeckleMark size={34} className="about-mark" />
            <div className="about-names">
              <span className="about-wordmark">Deckle</span>
              {/* Selectable on purpose: this number's job is to be pasted into
                  a bug report. */}
              <span className="about-version">Version {__APP_VERSION__}</span>
            </div>
          </div>

          <p className="about-lede">
            Markdown notes, tasks and bookmarks that stay as ordinary files you
            can open, sync and back up with anything else.
          </p>

          <dl className="about-facts">
            <div className="about-fact">
              <dt>Library</dt>
              <dd>{libraryName ?? 'Notes'}</dd>
            </div>
            <div className="about-fact">
              <dt>Notes are kept</dt>
              <dd>{WHERE[storage]}</dd>
            </div>
          </dl>

          <div className="about-links">
            <a
              href={`${REPO}/blob/main/CHANGELOG.md`}
              target="_blank"
              rel="noreferrer"
              className="about-link"
            >
              What's new <ExternalLink size={13} />
            </a>
            <a href={REPO} target="_blank" rel="noreferrer" className="about-link">
              Source <ExternalLink size={13} />
            </a>
          </div>
        </div>

        <div className="modal-footer about-footer">
          <span className="about-licence">MIT licensed. Your notes are yours.</span>
        </div>
      </div>
    </div>
  )
}
