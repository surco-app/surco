import { existsSync } from 'node:fs'
import { rename as fsRename } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { uniqueOutputPath } from './inplace'

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
// 40 MB FLAC) and needs time to finish, so immediate retries would just fail as fast
// as they were made. One attempt per wait plus a final one after the last, ~3.1s total
// across all attempts, which covers a scan without leaving a bulk conversion visibly
// stuck on one track.
const BACKOFF_MS = [100, 200, 400, 800, 1600]

// What one blocked rename looked like. `waitMs` is null on the attempt that gave up,
// since there is no further wait after it.
export interface RenameBlocked {
  attempt: number
  code: string
  waitMs: number | null
  path: string
}

interface RenameDeps {
  rename?: (from: string, to: string) => Promise<void>
  sleep?: (ms: number) => Promise<void>
  onRetry?: (info: RenameBlocked) => void
  // Where to land `from` when the destination never frees. Only callers whose temp
  // holds finished user work pass this: a conversion's temp has its audio, tags and
  // cues already written, so deleting it costs the user the whole job. The library
  // writers (Traktor .nml, Engine .db) leave it out — their temps are disposable
  // rewrites, and a rescued copy beside the collection would just be litter.
  rescue?: (to: string) => string
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
  { rename = fsRename, sleep = defaultSleep, onRetry, rescue }: RenameDeps = {},
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(from, to)
    } catch (err) {
      if (!isFileInUseError(err)) throw err
      const code = (err as NodeJS.ErrnoException).code as string
      // One attempt per wait, plus the final one after the last wait has elapsed —
      // cutting at length - 1 skipped the longest wait entirely and gave up in 1.5s
      // instead of the ~3.1s below.
      const lastAttempt = attempt >= BACKOFF_MS.length
      onRetry?.({
        attempt: attempt + 1,
        code,
        waitMs: lastAttempt ? null : BACKOFF_MS[attempt],
        path: to,
      })
      if (lastAttempt) {
        const held = err as NodeJS.ErrnoException
        // Best effort on a volume already refusing writes: if the rescue cannot land
        // either, the caller still gets the original file-in-use error, since that is
        // what the renderer matches to pick its translated message. Whether it landed
        // rides on the error as `rescuedTo`, because the caller deletes the temp on
        // failure: told nothing, it would delete a finished conversion the rescue never
        // actually moved — the very loss this exists to prevent.
        if (rescue) {
          const target = rescue(to)
          const moved = await rename(from, target).then(
            () => true,
            () => false,
          )
          if (moved) Object.assign(held, { rescuedTo: target })
        }
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

// Where a conversion lands when the rename never succeeds. Deleting the temp — what
// convertAudio did before — threw away a file whose audio, tags and cues were all
// already written, because the cheapest step of the whole job failed. Keeping the temp
// as-is would be no better: it is hidden (leading dot) under a random suffix nobody can
// recognise, so the work would survive only in a place the user never looks. This puts
// it beside the intended output under an obvious sibling name.
//
// The suffix is deliberately not a word: main would have to be handed the UI locale to
// translate it, and a Spanish "(recuperado)" landing in an English user's folder (or the
// reverse) reads as corruption rather than a rescue. "~" is the convention every OS
// already uses for a recovered or backup sibling, and it sorts next to the original.
const RESCUE_SUFFIX = '~'

export function rescuePath(output: string, exists: (p: string) => boolean = existsSync): string {
  const ext = extname(output)
  const base = basename(output, ext)
  return uniqueOutputPath(join(dirname(output), `${base}${RESCUE_SUFFIX}${ext}`), exists)
}
