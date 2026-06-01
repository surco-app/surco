import { describe, it, expect } from 'vitest'
import { parseFileName } from './filename'

describe('parseFileName', () => {
  it('splits artist and title on the first " - " so remix titles stay intact', () => {
    // matters because "Keep Calm (Beeper's Mix)" must not be cut, and the
    // artist drives an accurate Discogs query
    const r = parseFileName("/music/Acer vs. The Beeper - Keep Calm (Beeper's Mix).wav")
    expect(r.artist).toBe('Acer vs. The Beeper')
    expect(r.title).toBe("Keep Calm (Beeper's Mix)")
    expect(r.query).toBe("Acer vs. The Beeper Keep Calm (Beeper's Mix)")
  })

  it('keeps a hyphenated title whole when it contains a later " - "', () => {
    const r = parseFileName('/m/Artist - The Beat - Won\'t Stop.flac')
    expect(r.artist).toBe('Artist')
    expect(r.title).toBe("The Beat - Won't Stop")
  })

  it('falls back to the whole name as title when there is no separator', () => {
    // without an artist we still need a usable query and a sane title field
    const r = parseFileName('/m/Untitled Loop.wav')
    expect(r.artist).toBe('')
    expect(r.title).toBe('Untitled Loop')
    expect(r.query).toBe('Untitled Loop')
  })

  it('strips the extension and directory from the file name', () => {
    const r = parseFileName('/a/b/Chumi Dj - Open Your Eyes.wav')
    expect(r.fileName).toBe('Chumi Dj - Open Your Eyes')
  })
})
