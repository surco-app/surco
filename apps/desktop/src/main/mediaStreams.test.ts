import { describe, expect, it, vi } from 'vitest'
import { releaseMediaFile, trackMediaStream, untrackMediaStream } from './mediaStreams'

// Node closes the descriptor and emits 'close' on a later tick, never inside the
// destroy() call. The double has to match that: a synchronous close would let an
// implementation that resolves right after destroy() pass, and "asked to close" vs
// "is closed" is the entire distinction this module exists to make.
const fakeStream = (): {
  destroy: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  closed: () => boolean
} => {
  const handlers = new Set<() => void>()
  let closed = false
  return {
    destroy: vi.fn(() => {
      setTimeout(() => {
        closed = true
        for (const fn of handlers) fn()
      }, 0)
    }),
    on: vi.fn((event: string, fn: () => void) => {
      if (event === 'close') handlers.add(fn)
    }),
    closed: () => closed,
  }
}

describe('releaseMediaFile', () => {
  // The whole point of the registry. Windows refuses to rename over a file this
  // stream holds open, and the renderer tearing down its <audio> element only asks
  // Chromium to cancel — main is where the descriptor actually lives, so main is the
  // only place that can confirm it is gone.
  it('destroys the stream serving the file and resolves once it is closed', async () => {
    const stream = fakeStream()
    trackMediaStream('/music/a.wav', stream as never)
    await releaseMediaFile('/music/a.wav')
    expect(stream.destroy).toHaveBeenCalled()
    // The point of awaiting: resolving when destroy() was merely *requested* is what
    // leaves the rename racing a descriptor that is still open on Windows.
    expect(stream.closed()).toBe(true)
  })

  // Scrubbing opens one stream per seek, and any of them can be the one still holding
  // the file: releasing only the newest would leave older descriptors open and the
  // rename would fail exactly as before.
  it('releases every stream open on the same file', async () => {
    const first = fakeStream()
    const second = fakeStream()
    trackMediaStream('/music/a.wav', first as never)
    trackMediaStream('/music/a.wav', second as never)
    await releaseMediaFile('/music/a.wav')
    expect(first.closed()).toBe(true)
    expect(second.closed()).toBe(true)
  })

  // Silencing an unrelated track the DJ is auditioning would be pure interruption —
  // and worse, it would make the player look broken during any bulk conversion.
  it('leaves streams on other files untouched', async () => {
    const other = fakeStream()
    trackMediaStream('/music/other.wav', other as never)
    await releaseMediaFile('/music/a.wav')
    expect(other.destroy).not.toHaveBeenCalled()
  })

  // The caller awaits this before renaming, so it must never hang: a file nobody is
  // streaming is the normal case for every track in a bulk run.
  it('resolves immediately when no stream holds the file', async () => {
    await expect(releaseMediaFile('/music/nothing.wav')).resolves.toBeUndefined()
  })

  // A stream that already ended must not be waited on — its 'close' fired long before
  // anyone asked for a release, so awaiting a fresh event would wait forever.
  it('does not wait on a stream that already closed itself', async () => {
    const stream = fakeStream()
    trackMediaStream('/music/a.wav', stream as never)
    untrackMediaStream('/music/a.wav', stream as never)
    await expect(releaseMediaFile('/music/a.wav')).resolves.toBeUndefined()
    expect(stream.destroy).not.toHaveBeenCalled()
  })
})
