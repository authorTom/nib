// The screen shown until a library is connected.
//
// Which choices appear depends on what the deployment actually supports: the
// server library only when this build is served by the Deckle server with a volume
// mounted, and the on-disk picker only on Chromium. When neither the server nor
// the browser offers storage there is nothing to offer, and the gate says so.
//
// This is the one screen in Deckle that is not the desk. Everywhere else the
// chrome holds still so the writing can move; here there is no writing yet, and
// the screen's whole job is the promise it makes about where your notes will
// live. So it gets the system's strongest moves rather than opting out of them:
// the ink, display type, and a real vertical rhythm — the same brand, more sure
// of itself. It used to borrow `.empty-state`, a utility built to be ignored.

import { useState, type FormEvent } from 'react'
import { FolderOpen, Lock, Moon, Server, Sun } from 'lucide-react'
import { isLibrarySupported, supportsDiskPicker } from '../fs/library'
import type { ServerLibraryInfo } from '../fs/remote'
import type { LibraryStatus } from '../hooks/useNotes'
import InkFilter from './InkFilter'
import DeckleMark from './DeckleMark'

interface Props {
  status: LibraryStatus
  theme: string
  toggleTheme: () => void
  libraryName: string | null
  connect: () => void
  reconnect: () => void
  serverLibrary: ServerLibraryInfo | null
  connectServer: () => void
  loginServer: (password: string) => Promise<string | null>
}

export default function LibraryGate({
  status,
  theme,
  toggleTheme,
  libraryName,
  connect,
  reconnect,
  serverLibrary,
  connectServer,
  loginServer,
}: Props) {
  const disk = supportsDiskPicker()
  const choosing = status === 'no-library' && serverLibrary !== null

  return (
    <div className="app">
      <div className="main gate">
        <InkFilter />
        {/* The same drop of ink that lands on a new note, reused for the
            moment the workspace itself is made. Not a fifth gesture: the
            vocabulary is closed, and this is one of the four. */}
        <div className="ink-bloom gate-bloom" aria-hidden="true">
          <span />
        </div>

        <button
          type="button"
          className="icon-btn gate-theme"
          onClick={toggleTheme}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
        </button>

        <div className={`gate-inner${choosing ? ' wide' : ''}`}>
          <div className="gate-masthead">
            <DeckleMark />
            <span className="gate-wordmark">Deckle</span>
          </div>

          {status === 'loading' && <p className="gate-lede">Loading…</p>}

          {status === 'unsupported' && (
            <>
              <h1 className="gate-title">Browser not supported</h1>
              <p className="gate-lede">
                This app needs a browser with file-storage support. Please update
                to a recent version of Safari, Firefox, Chrome, or Edge.
              </p>
            </>
          )}

          {status === 'no-library' && serverLibrary && (
            <ChooseBackend
              disk={disk}
              // A browser with neither the picker nor OPFS can still use the
              // server library, so offer that alone rather than a dead button.
              localSupported={isLibrarySupported()}
              serverLibrary={serverLibrary}
              connect={connect}
              connectServer={connectServer}
            />
          )}

          {status === 'no-library' && !serverLibrary && (
            <>
              <h1 className="gate-title">
                {disk ? 'Choose a notes folder' : 'Create your library'}
              </h1>
              <p className="gate-lede">
                {disk ? (
                  <>
                    Pick a folder to use as your library. Your notes are saved there
                    as plain Markdown (.md) files — open them in any editor, sync
                    them, or back them up however you like.
                  </>
                ) : (
                  <>
                    Your notes are saved privately inside this browser as Markdown
                    (.md) files. They stay on this device and aren&rsquo;t uploaded
                    anywhere.
                  </>
                )}
              </p>
              <div className="gate-actions">
                <button type="button" className="btn-primary" onClick={connect}>
                  <FolderOpen size={18} />
                  {disk ? 'Open folder' : 'Get started'}
                </button>
              </div>
            </>
          )}

          {status === 'needs-login' && (
            <LoginForm
              name={serverLibrary?.name ?? 'the server library'}
              loginServer={loginServer}
              connect={connect}
              showLocalOption={disk || !serverLibrary}
              disk={disk}
            />
          )}

          {status === 'needs-permission' && (
            <>
              <h1 className="gate-title">Reconnect your library</h1>
              <p className="gate-lede">
                Grant access to <strong>{libraryName ?? 'your folder'}</strong> to
                continue.
              </p>
              <div className="gate-actions">
                <button type="button" className="btn-primary" onClick={reconnect}>
                  Reconnect
                </button>
                <button type="button" className="btn-secondary" onClick={connect}>
                  Choose a different folder
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ChooseBackend({
  disk,
  localSupported,
  serverLibrary,
  connect,
  connectServer,
}: {
  disk: boolean
  localSupported: boolean
  serverLibrary: ServerLibraryInfo
  connect: () => void
  connectServer: () => void
}) {
  if (!localSupported) {
    return (
      <>
        <h1 className="gate-title">Open {serverLibrary.name}</h1>
        <p className="gate-lede">
          Your notes are stored on the server running Deckle, so they&rsquo;re
          available on every device and nothing is kept on this one.
        </p>
        <div className="gate-actions">
          <button type="button" className="btn-primary" onClick={connectServer}>
            <Server size={18} />
            Open notes
          </button>
        </div>
      </>
    )
  }

  return (
    <>
      <h1 className="gate-title">Where should your notes live?</h1>
      <div className="library-options">
        <button type="button" className="library-option" onClick={connectServer}>
          <span className="library-option-icon">
            <Server size={20} />
          </span>
          <span className="library-option-title">On this server</span>
          <span className="library-option-desc">
            Notes are stored as Markdown files on the machine running Deckle, so you
            can reach them from any device and any browser. Nothing is kept
            locally.
            {serverLibrary.authRequired ? ' Protected by a password.' : ''}
          </span>
        </button>
        <button type="button" className="library-option" onClick={connect}>
          <span className="library-option-icon">
            <FolderOpen size={20} />
          </span>
          <span className="library-option-title">
            {disk ? 'In a folder on this computer' : 'Privately in this browser'}
          </span>
          <span className="library-option-desc">
            {disk
              ? 'Pick a folder and Deckle writes ordinary .md files into it — open them in any editor, sync them, or back them up yourself.'
              : 'Notes are saved privately inside this browser on this device, and are not uploaded anywhere.'}
          </span>
        </button>
      </div>
      <p className="gate-footnote">
        You can change this later — nothing is copied between the two.
      </p>
    </>
  )
}

function LoginForm({
  name,
  loginServer,
  connect,
  showLocalOption,
  disk,
}: {
  name: string
  loginServer: (password: string) => Promise<string | null>
  connect: () => void
  showLocalOption: boolean
  disk: boolean
}) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !password) return
    setBusy(true)
    setError(null)
    const message = await loginServer(password)
    setBusy(false)
    if (message) {
      setError(message)
      setPassword('')
    }
    // On success the library opens and this screen unmounts.
  }

  return (
    <>
      <h1 className="gate-title">
        <Lock size={22} aria-hidden="true" />
        Unlock {name}
      </h1>
      <p className="gate-lede">Enter the library password to open your notes.</p>
      <form className="library-login" onSubmit={(e) => void onSubmit(e)}>
        <input
          type="password"
          className="library-login-input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          aria-label="Library password"
          autoComplete="current-password"
          autoFocus
        />
        <button type="submit" className="btn-primary" disabled={busy || !password}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
      </form>
      {error && (
        <p className="library-login-error" role="alert">
          {error}
        </p>
      )}
      {showLocalOption && (
        <div className="gate-actions">
          <button type="button" className="btn-secondary" onClick={connect}>
            {disk ? 'Use a local folder instead' : 'Use this browser instead'}
          </button>
        </div>
      )}
    </>
  )
}
