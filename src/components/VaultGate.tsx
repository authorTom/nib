// The screen shown until a vault is connected.
//
// Which choices appear depends on what the deployment actually supports: the
// server vault only when this build is served by the Nib server with a volume
// mounted, and the on-disk picker only on Chromium. When neither the server nor
// the browser offers storage there is nothing to offer, and the gate says so.

import { useState, type FormEvent } from 'react'
import { FolderOpen, Lock, Moon, Server, Sun } from 'lucide-react'
import { isVaultSupported, supportsDiskPicker } from '../fs/vault'
import type { ServerVaultInfo } from '../fs/remote'
import type { VaultStatus } from '../hooks/useNotes'

interface Props {
  status: VaultStatus
  theme: string
  toggleTheme: () => void
  vaultName: string | null
  connect: () => void
  reconnect: () => void
  serverVault: ServerVaultInfo | null
  connectServer: () => void
  loginServer: (password: string) => Promise<string | null>
}

export default function VaultGate({
  status,
  theme,
  toggleTheme,
  vaultName,
  connect,
  reconnect,
  serverVault,
  connectServer,
  loginServer,
}: Props) {
  const disk = supportsDiskPicker()

  return (
    <div className="app">
      <div className="main">
        <button
          type="button"
          className="icon-btn gate-theme"
          onClick={toggleTheme}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
        </button>
        <div className="empty-state">
          <img className="brand-mark" src="/nib.svg" alt="" width={44} height={44} />
          <div className="brand">Nib</div>
          {status === 'loading' && <p>Loading…</p>}

          {status === 'unsupported' && (
            <>
              <h2>Browser not supported</h2>
              <p>
                This app needs a browser with file-storage support. Please update
                to a recent version of Safari, Firefox, Chrome, or Edge.
              </p>
            </>
          )}

          {status === 'no-vault' && serverVault && (
            <ChooseBackend
              disk={disk}
              // A browser with neither the picker nor OPFS can still use the
              // server vault, so offer that alone rather than a dead button.
              localSupported={isVaultSupported()}
              serverVault={serverVault}
              connect={connect}
              connectServer={connectServer}
            />
          )}

          {status === 'no-vault' && !serverVault && (
            <>
              <FolderOpen size={40} />
              <h2>{disk ? 'Choose a notes folder' : 'Create your vault'}</h2>
              <p>
                {disk ? (
                  <>
                    Pick a folder to use as your vault. Your notes are saved there
                    as plain Markdown (.md) files — open them in Obsidian, sync
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
              <button type="button" className="btn-primary" onClick={connect}>
                <FolderOpen size={18} />
                {disk ? 'Open folder' : 'Get started'}
              </button>
            </>
          )}

          {status === 'needs-login' && (
            <LoginForm
              name={serverVault?.name ?? 'the server vault'}
              loginServer={loginServer}
              connect={connect}
              showLocalOption={disk || !serverVault}
              disk={disk}
            />
          )}

          {status === 'needs-permission' && (
            <>
              <FolderOpen size={40} />
              <h2>Reconnect your vault</h2>
              <p>
                Grant access to <strong>{vaultName ?? 'your folder'}</strong> to
                continue.
              </p>
              <button type="button" className="btn-primary" onClick={reconnect}>
                Reconnect
              </button>
              <button type="button" className="btn-secondary" onClick={connect}>
                Choose a different folder
              </button>
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
  serverVault,
  connect,
  connectServer,
}: {
  disk: boolean
  localSupported: boolean
  serverVault: ServerVaultInfo
  connect: () => void
  connectServer: () => void
}) {
  if (!localSupported) {
    return (
      <>
        <Server size={40} />
        <h2>Open {serverVault.name}</h2>
        <p>
          Your notes are stored on the server running Nib, so they&rsquo;re
          available on every device and nothing is kept on this one.
        </p>
        <button type="button" className="btn-primary" onClick={connectServer}>
          <Server size={18} />
          Open notes
        </button>
      </>
    )
  }

  return (
    <>
      <h2>Where should your notes live?</h2>
      <p>You can change this later — nothing is copied between the two.</p>
      <div className="vault-options">
        <button type="button" className="vault-option" onClick={connectServer}>
          <Server size={22} />
          <span className="vault-option-title">On this server</span>
          <span className="vault-option-desc">
            Notes are stored as Markdown files on the machine running Nib, so you
            can reach them from any device and any browser. Nothing is kept
            locally.
            {serverVault.authRequired ? ' Protected by a password.' : ''}
          </span>
        </button>
        <button type="button" className="vault-option" onClick={connect}>
          <FolderOpen size={22} />
          <span className="vault-option-title">
            {disk ? 'In a folder on this computer' : 'Privately in this browser'}
          </span>
          <span className="vault-option-desc">
            {disk
              ? 'Pick a folder and Nib writes ordinary .md files into it — open them in Obsidian, sync them, or back them up yourself.'
              : 'Notes are saved privately inside this browser on this device, and are not uploaded anywhere.'}
          </span>
        </button>
      </div>
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
    // On success the vault opens and this screen unmounts.
  }

  return (
    <>
      <Lock size={40} />
      <h2>Unlock {name}</h2>
      <p>Enter the vault password to open your notes.</p>
      <form className="vault-login" onSubmit={(e) => void onSubmit(e)}>
        <input
          type="password"
          className="vault-login-input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          aria-label="Vault password"
          autoComplete="current-password"
          autoFocus
        />
        <button type="submit" className="btn-primary" disabled={busy || !password}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
      </form>
      {error && (
        <p className="vault-login-error" role="alert">
          {error}
        </p>
      )}
      {showLocalOption && (
        <button type="button" className="btn-secondary" onClick={connect}>
          {disk ? 'Use a local folder instead' : 'Use this browser instead'}
        </button>
      )}
    </>
  )
}
