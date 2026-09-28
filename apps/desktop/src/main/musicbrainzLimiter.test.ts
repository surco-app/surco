import { afterEach, describe, expect, it, vi } from 'vitest'
import { musicbrainzLimiter } from './musicbrainzLimiter'

afterEach(() => {
  vi.useRealTimers()
})

describe('musicbrainzLimiter', () => {
  // Going over one request per second gets the user's IP blocked by MusicBrainz, so even
  // the first two requests of a fresh session must not go out back to back.
  it('lets a second request out only a full second after the first', async () => {
    vi.useFakeTimers()
    vi.advanceTimersByTime(5000)
    await musicbrainzLimiter.acquire('high')
    let second = false
    void musicbrainzLimiter.acquire('high').then(() => {
      second = true
    })
    await vi.advanceTimersByTimeAsync(990)
    expect(second).toBe(false)
    await vi.advanceTimersByTimeAsync(20)
    expect(second).toBe(true)
  })
})
