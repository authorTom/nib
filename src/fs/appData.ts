// The hidden folder holding Deckle's own data (tasks, bookmarks) inside the
// user's library.
//
// It was called ".nib" before the app was renamed, and it lives in the user's
// own folder — a folder an app upgrade has no business rewriting behind their
// back. So the new name is what we write, the old name is still read when the
// new one holds nothing yet, and both are treated as ours everywhere it
// matters (exports especially, where dropping the folder loses the planner).
//
// Nothing deletes the legacy folder. Once a library has been saved by this
// version its tasks and bookmarks live under `.deckle`, and the leftover
// `.nib` is a stale copy the user can remove whenever they like.

/** Folder holding Deckle's own metadata inside the library. */
export const DATA_DIR = '.deckle'

/** What that folder was called before the rename. Read-only, never written. */
export const LEGACY_DATA_DIR = '.nib'

/** True for either spelling of the metadata folder. */
export function isDataDir(name: string): boolean {
  return name === DATA_DIR || name === LEGACY_DATA_DIR
}

/**
 * Read and parse a JSON file from the metadata folder, preferring the current
 * name and falling back to the pre-rename one. Returns null when neither has
 * a readable copy, so callers can start from an empty store.
 */
export async function readDataJson(
  dir: FileSystemDirectoryHandle,
  file: string,
): Promise<unknown | null> {
  for (const folderName of [DATA_DIR, LEGACY_DATA_DIR]) {
    try {
      const folder = await dir.getDirectoryHandle(folderName)
      const handle = await folder.getFileHandle(file)
      return JSON.parse(await (await handle.getFile()).text())
    } catch {
      // Absent, unparseable, or unreadable — try the legacy name, then give up.
    }
  }
  return null
}

/**
 * A folder inside the metadata folder — `.deckle/memory`, and whatever comes
 * next. Reading a missing one throws, which callers read as "nothing stored
 * yet"; pass `create` only when about to write.
 */
export async function dataSubdir(
  dir: FileSystemDirectoryHandle,
  name: string,
  create = false,
): Promise<FileSystemDirectoryHandle> {
  const folder = await dir.getDirectoryHandle(DATA_DIR, { create })
  return await folder.getDirectoryHandle(name, { create })
}

/** Write a JSON file into the metadata folder, creating the folder if needed. */
export async function writeDataJson(
  dir: FileSystemDirectoryHandle,
  file: string,
  value: unknown,
): Promise<void> {
  const folder = await dir.getDirectoryHandle(DATA_DIR, { create: true })
  const handle = await folder.getFileHandle(file, { create: true })
  const writable = await handle.createWritable()
  await writable.write(JSON.stringify(value, null, 2))
  await writable.close()
}
