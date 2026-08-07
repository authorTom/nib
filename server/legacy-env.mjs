// Backwards compatibility for configuration written before the rename.
//
// This app was called Nib, and stored its notes in what it called a vault, so
// its configuration was named NIB_SERVER_VAULT, NIB_VAULT_DIR and so on.
// Deployments keep that configuration in a .env file next to compose.yaml —
// a file that pulling a new image does not touch. If this process only read
// the DECKLE_* names, every existing install would come back up after an
// upgrade with its server library switched off and its notes seemingly gone.
//
// Worse, silently dropping NIB_PASSWORD would not lock people out; it would do
// the opposite. An unset password means "no password at all" here, so the
// server would come back up publicly readable and writable. A rename must not
// be able to do that.
//
// So each new name falls back to the name it replaced, and the server says at
// startup which legacy names it honoured. This table is the only place the old
// names should appear; delete it once no deployment runs a NIB_-era .env.

/** Old name -> new name. Both halves changed: NIB_ -> DECKLE_, VAULT -> LIBRARY. */
const RENAMED = {
  NIB_SERVER_VAULT: 'DECKLE_SERVER_LIBRARY',
  NIB_VAULT_DIR: 'DECKLE_LIBRARY_DIR',
  NIB_VAULT_NAME: 'DECKLE_LIBRARY_NAME',
  NIB_PASSWORD: 'DECKLE_PASSWORD',
  NIB_SESSION_SECRET: 'DECKLE_SESSION_SECRET',
  NIB_SESSION_TTL_DAYS: 'DECKLE_SESSION_TTL_DAYS',
  NIB_API_TOKENS: 'DECKLE_API_TOKENS',
  NIB_API_TOKEN: 'DECKLE_API_TOKEN',
  NIB_API_CORS_ORIGINS: 'DECKLE_API_CORS_ORIGINS',
  NIB_PUBLIC_DIR: 'DECKLE_PUBLIC_DIR',
}

/**
 * Copy any legacy NIB_* values onto the DECKLE_* names nothing has set yet.
 * A new name that is already set always wins, so someone mid-migration can
 * hold both spellings without the old one overriding the new.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ env: Record<string, string | undefined>, honoured: string[] }}
 *   `honoured` lists "OLD -> NEW" pairs actually used, for the startup log.
 */
export function resolveLegacyEnv(env) {
  const resolved = { ...env }
  const honoured = []

  for (const [old, renamed] of Object.entries(RENAMED)) {
    const legacyValue = env[old]
    if (legacyValue === undefined || legacyValue === '') continue
    // Treat an empty new value as unset: `DECKLE_PASSWORD=` in a .env is how
    // Compose passes through a variable that was never given a value.
    if (resolved[renamed] !== undefined && resolved[renamed] !== '') continue
    resolved[renamed] = legacyValue
    honoured.push(`${old} -> ${renamed}`)
  }

  return { env: resolved, honoured }
}
