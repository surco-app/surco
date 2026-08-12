import { rename as fsRename } from 'node:fs/promises'

// Windows refuses to rename over a destination another process holds open, and the
// holder is usually not the user's doing: an antivirus scanning the file Surco just
// wrote, the search indexer, a player with the track loaded. The block lasts as long
// as that scan, so the codes below mean "try again in a moment", not "this will never
// work". POSIX renames over an open file happily, so this never triggers there.
const IN_USE_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])

export function isFileInUseError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code
  return typeof code === 'string' && IN_USE_CODES.has(code)
}

// Doubling waits rather than a busy loop: the holder is doing work (a virus scan on a
// 40 MB FLAC) and needs time to finish, so five immediate attempts would just fail
// five times. ~3.1s total across all attempts, which covers a scan without leaving a
// bulk conversion visibly stuck on one track.
const BACKOFF_MS = [100, 200, 400, 800, 1600]

interface RenameDeps {
  rename?: (from: string, to: string) => Promise<void>
  sleep?: (ms: number) => Promise<void>
}

// Electron's IPC serializes a rejection down to its message alone — `code` and any
// custom property are dropped on the way to the renderer (verified against the real
// bridge, not assumed). So the "another program holds this file" signal has to ride
// inside the message text itself, as a stable marker the renderer matches to pick a
// translated string. Kept in sync with the renderer's ipcError.ts.
export const FILE_IN_USE_MARKER = 'SURCO_FILE_IN_USE'

// Renames, retrying while the destination is held by another process. The temp file
// is already complete and correct by the time this runs — for a conversion its audio,
// tags and cues are all written — so a transient lock must not be what throws that
// work away. When the destination never frees, the error carries `fileInUse` so the
// caller can explain the real cause instead of showing a raw EPERM.
export async function renameWithRetry(
  from: string,
  to: string,
  { rename = fsRename, sleep = defaultSleep }: RenameDeps = {},
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(from, to)
    } catch (err) {
      if (!isFileInUseError(err)) throw err
      if (attempt >= BACKOFF_MS.length - 1) {
        const held = err as NodeJS.ErrnoException
        held.message = `${FILE_IN_USE_MARKER}: ${held.message}`
        throw held
      }
      await sleep(BACKOFF_MS[attempt])
    }
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
