import type { ReadStream } from 'node:fs'

// Every surco:// read stream currently open, keyed by the path the renderer asked
// for — not by the file actually served. resolvePlayable can substitute a temp
// transcode (AIFF, art-stripped FLAC), and the renderer only ever knows the original
// path, so indexing by anything else would make a release request miss its stream.
const open = new Map<string, Set<ReadStream>>()

export function trackMediaStream(requestedPath: string, stream: ReadStream): void {
  const streams = open.get(requestedPath) ?? new Set<ReadStream>()
  streams.add(stream)
  open.set(requestedPath, streams)
  // A stream that ends on its own (track played out, seek superseded it) must leave
  // the registry, or a later release would await a 'close' that already fired.
  stream.on('close', () => untrackMediaStream(requestedPath, stream))
}

export function untrackMediaStream(requestedPath: string, stream: ReadStream): void {
  const streams = open.get(requestedPath)
  if (!streams) return
  streams.delete(stream)
  if (streams.size === 0) open.delete(requestedPath)
}

// Closes every stream holding the file and resolves only once the OS descriptors are
// gone. Awaiting 'close' rather than returning after destroy() is the whole contract:
// destroy() merely requests teardown, and on Windows the rename fails while the
// descriptor lives, which is what made the previous renderer-side fix a race the user
// saw as "it works on the third or fourth try".
export async function releaseMediaFile(requestedPath: string): Promise<void> {
  const streams = open.get(requestedPath)
  if (!streams || streams.size === 0) return
  await Promise.all(
    [...streams].map(
      (stream) =>
        new Promise<void>((resolve) => {
          stream.on('close', () => resolve())
          stream.destroy()
        }),
    ),
  )
  open.delete(requestedPath)
}
