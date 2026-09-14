import { describe, expect, it, vi } from 'vitest'
import { buildArtworkScript, missingArtwork } from './appleMusicArtwork'

// Which imported tracks need their cover fetched from Apple Music. Measured on the real
// library: 53% of the tracks carry no embedded picture — almost all of them WAVs — while
// Music holds the artwork for the very same track. Those are the ones that imported with
// an empty cover slot.

describe('missingArtwork', () => {
  it('asks for the tracks whose file carries no picture', async () => {
    const hasEmbedded = vi.fn(async (p: string) => p.endsWith('.mp3'))

    const need = await missingArtwork(
      [
        { path: '/m/one.wav', persistentId: 'PID1' },
        { path: '/m/two.mp3', persistentId: 'PID2' },
      ],
      { hasEmbedded },
    )

    expect(need).toEqual([{ path: '/m/one.wav', persistentId: 'PID1' }])
  })

  // Half the library already carries its own art, and extracting it again would be work
  // for nothing — the file's own picture is full resolution and already what gets shown.
  it('asks for nothing when every file already carries its own', async () => {
    const hasEmbedded = vi.fn(async () => true)

    expect(
      await missingArtwork([{ path: '/m/one.mp3', persistentId: 'PID1' }], { hasEmbedded }),
    ).toEqual([])
  })

  // A track Surco did not import from a playlist has no library entry to ask, so there is
  // nowhere to fetch the art from even though the file has none.
  it('skips a track with no library copy', async () => {
    const hasEmbedded = vi.fn(async () => false)

    expect(await missingArtwork([{ path: '/m/one.wav' }], { hasEmbedded })).toEqual([])
  })

  // A file that cannot be probed is left alone rather than queued: fetching art for it
  // would risk stamping a picture onto a track whose own state is unknown.
  it('skips a file it cannot probe', async () => {
    const hasEmbedded = vi.fn(async () => {
      throw new Error('unreadable')
    })

    expect(
      await missingArtwork([{ path: '/m/one.wav', persistentId: 'PID1' }], { hasEmbedded }),
    ).toEqual([])
  })
})

describe('buildArtworkScript', () => {
  it('writes the picture of each track to its own file, addressed by persistent ID', () => {
    const script = buildArtworkScript([{ persistentId: 'PID1', outPath: '/tmp/a/PID1.bin' }])

    expect(script).toContain('"PID1"')
    expect(script).toContain('"/tmp/a/PID1.bin"')
  })

  // A track whose artwork vanished between the listing and the fetch must not take the
  // whole batch down with it: the rest still get their covers.
  it('keeps going when one track has no artwork', () => {
    const script = buildArtworkScript([
      { persistentId: 'PID1', outPath: '/tmp/a/PID1.bin' },
      { persistentId: 'PID2', outPath: '/tmp/a/PID2.bin' },
    ])

    expect(script).toContain('count of artworks')
    // One try per track, not one around the loop.
    expect(script.match(/on error/g)?.length).toBe(2)
  })

  // A quote in a path would close the AppleScript string and turn the rest of the path
  // into code — the same class of bug as the dollar sign in a Traktor file name.
  it('escapes quotes in a path instead of breaking out of the string', () => {
    const script = buildArtworkScript([
      { persistentId: 'PID1', outPath: '/tmp/a/say "hi"/PID1.bin' },
    ])

    expect(script).toContain('\\"hi\\"')
  })
})
