import { createHash } from 'node:crypto'
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { MEDIA_SCHEME } from '../shared/media'

// Embedded cover thumbnails, kept on disk and handed to the renderer as a short
// surco://cover/<sha1>.jpg URL. Each imported track used to hold its thumbnail as a base64
// data URL in the renderer's state (~30 KB each, ~70 KB for the larger ones) for as long
// as it stayed in the list, and clone it across IPC on the way. Named by content, so an
// album's tracks share one file, and equal art still gives equal strings: the editor
// tells "the file's own cover" apart by comparing them.
const HOST = 'cover'
const ID = /^[0-9a-f]{40}\.jpg$/

// Pruned back to this at launch. ~17,000 thumbnails at the usual size.
const MAX_BYTES = 512 * 1024 * 1024

function dir(): string {
  return join(app.getPath('userData'), 'cover-thumbs')
}

// The launch prune in flight. Storing waits for it, so a thumbnail written while it runs
// (a restored session's first reads) can never be deleted after its URL was handed out.
let pruning: Promise<void> = Promise.resolve()

export async function coverThumbUrlFor(dataUrl: string): Promise<string> {
  if (!dataUrl.startsWith('data:')) return dataUrl
  return coverThumbUrlForBytes(Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'))
}

export async function coverThumbUrlForBytes(bytes: Buffer): Promise<string> {
  const id = `${createHash('sha1').update(bytes).digest('hex')}.jpg`
  const path = join(dir(), id)
  await pruning
  // Rewritten when present too: it refreshes the mtime the launch prune keeps by.
  await mkdir(dir(), { recursive: true })
  await writeFile(path, bytes)
  return `${MEDIA_SCHEME}://${HOST}/${id}`
}

// The file a thumbnail URL names, or null for anything that is not one: the protocol
// serves whatever this returns, so it must never resolve outside the store.
export function coverThumbPathOf(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${MEDIA_SCHEME}:` || parsed.host !== HOST) return null
  const id = parsed.pathname.replace(/^\//, '')
  return ID.test(id) ? join(dir(), id) : null
}

// Run at launch, before any track holds a URL, so it can never break an image on screen;
// a pruned track's next metadata read stores its thumbnail again. Best-effort.
export function pruneCoverThumbs(maxBytes = MAX_BYTES): Promise<void> {
  pruning = prune(maxBytes)
  return pruning
}

async function prune(maxBytes: number): Promise<void> {
  try {
    const entries = await Promise.all(
      (await readdir(dir())).map(async (name) => {
        const full = join(dir(), name)
        const s = await stat(full)
        return { full, mtimeMs: s.mtimeMs, size: s.size }
      }),
    )
    entries.sort((a, b) => b.mtimeMs - a.mtimeMs)
    let total = 0
    for (const e of entries) {
      total += e.size
      if (total > maxBytes) await unlink(e.full).catch(() => {})
    }
  } catch {
    // no store yet
  }
}
