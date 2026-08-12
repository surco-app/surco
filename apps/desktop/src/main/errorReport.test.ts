import { describe, expect, it } from 'vitest'
import { recentErrorLines, stripPaths } from './errorReport'

describe('stripPaths', () => {
  // A report becomes a public GitHub issue, and log lines quote the absolute path of
  // whatever track failed. The file name is the whole diagnostic value ("was it a
  // .wav?", "does the name carry odd characters?"); the directory tree above it says
  // nothing about the bug and everything about the person running the app.
  it('reduces absolute paths to the file name', () => {
    expect(
      stripPaths('playback: element rejected /Users/ana/Desktop/Sola - Open Eyes.mp3 (x)'),
    ).toBe('playback: element rejected Sola - Open Eyes.mp3 (x)')
  })

  it('strips Windows paths too', () => {
    expect(stripPaths('failed C:\\Users\\ana\\Music\\track 01.flac open')).toBe(
      'failed track 01.flac open',
    )
  })

  it('keeps lines that carry no path untouched', () => {
    expect(stripPaths('uncaughtException Error: boom')).toBe('uncaughtException Error: boom')
  })

  // The bundled ffmpeg/ffprobe binaries appear in every conversion failure by their
  // install path. Which binary ran is worth keeping; where it lives is not.
  it('reduces binary paths in command failures', () => {
    expect(
      stripPaths('Command failed: /Applications/Surco.app/Contents/Resources/ffmpeg -i in.mp3'),
    ).toBe('Command failed: ffmpeg -i in.mp3')
  })
})

describe('recentErrorLines', () => {
  const log = [
    '[2026-08-10 20:28:00.000] [info]  download range: bytes=0-100',
    '[2026-08-10 20:28:59.825] [error] [renderer] playback: rejected /Users/ana/x.mp3',
    '[2026-08-10 20:29:00.000] [debug] cache hit',
    '[2026-08-10 22:26:38.267] [error] audio:waveform failed Error: Command failed',
  ].join('\n')

  // The log is mostly updater download chatter — 71 KB of it against four real error
  // lines in a typical file. Shipping the tail wastes the URL budget on noise, so the
  // report carries only the lines that record a failure.
  it('keeps only error lines, newest last, with paths stripped', () => {
    expect(recentErrorLines(log, 10)).toEqual([
      '[2026-08-10 20:28:59.825] [error] [renderer] playback: rejected x.mp3',
      '[2026-08-10 22:26:38.267] [error] audio:waveform failed Error: Command failed',
    ])
  })

  // The issue body travels in a query string, so the budget is finite. When a session
  // failed repeatedly the last errors are the ones describing the crash being reported.
  it('keeps the most recent lines when over the limit', () => {
    expect(recentErrorLines(log, 1)).toEqual([
      '[2026-08-10 22:26:38.267] [error] audio:waveform failed Error: Command failed',
    ])
  })

  it('returns nothing for a log with no errors', () => {
    expect(recentErrorLines('[2026-08-10 20:28:00.000] [info]  all good', 10)).toEqual([])
  })

  it('survives an empty or unreadable log', () => {
    expect(recentErrorLines('', 10)).toEqual([])
  })
})
