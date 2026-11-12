import { describe, expect, it } from 'vitest'
import { recentContextLines, stripPaths } from './errorReport'

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

  it('keeps the words between two paths on one line', () => {
    expect(stripPaths('Command failed: /A/ffmpeg -i /B/in.mp3 -o /C/out.flac')).toBe(
      'Command failed: ffmpeg -i in.mp3 -o out.flac',
    )
  })

  it('reduces a OneDrive folder named after an employer so it never reaches a public issue', () => {
    expect(stripPaths('read C:\\Users\\Ana\\OneDrive - Contoso Ltd\\Música\\x.wav')).toBe(
      'read x.wav',
    )
  })

  it('reduces an external volume whose name has a dash', () => {
    expect(stripPaths('read /Volumes/Ana - SSD/Music/x.wav')).toBe('read x.wav')
  })

  it('reduces an Artist - Album folder down to the file name', () => {
    expect(stripPaths('read /Users/ana/Music/Sola - Open Eyes/01 x.mp3')).toBe('read 01 x.mp3')
  })

  it('keeps the flags of a command line between two paths', () => {
    expect(stripPaths('Command failed: /A/ffmpeg -i /B/in.mp3 -f lavfi')).toBe(
      'Command failed: ffmpeg -i in.mp3 -f lavfi',
    )
  })

  it('reduces a folder whose name has parentheses', () => {
    expect(stripPaths('read /Users/ana/Música (2024)/x.wav')).toBe('read x.wav')
  })

  it('reduces a folder whose name has an apostrophe', () => {
    expect(stripPaths("read /Users/ana/Ana's Music/x.wav")).toBe('read x.wav')
  })

  it('reduces UNC paths on a network share', () => {
    expect(stripPaths('read \\\\NAS\\Users\\Ana\\Music\\x.wav')).toBe('read x.wav')
  })

  it('reduces a folder with a dash glued to the next word', () => {
    expect(stripPaths('read /Users/ana/Sola -Open Eyes/x.wav')).toBe('read x.wav')
    expect(stripPaths('read C:\\Users\\Ana\\Work -Contoso\\x.wav')).toBe('read x.wav')
  })

  it('reduces a folder with double quotes in its name', () => {
    expect(stripPaths('read /Users/ana/Ana "DJ" Mix/x.wav')).toBe('read x.wav')
  })

  it('reduces a folder with nested or unbalanced parentheses', () => {
    expect(stripPaths('read /Users/ana/Mix (Remix (Edit))/x.wav')).toBe('read x.wav')
    expect(stripPaths('read /Users/ana/Música (2024/x.wav')).toBe('read x.wav')
  })

  it('reduces a folder with a non-breaking space in its name', () => {
    expect(stripPaths('read /Users/ana/Música\u00a0Ana/x.wav')).toBe('read x.wav')
  })

  it('stays linear on a very long line', () => {
    const line = `/${'a/ '.repeat(17000)}`
    const started = performance.now()
    stripPaths(line)
    expect(performance.now() - started).toBeLessThan(200)
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

describe('recentContextLines', () => {
  const stamp = (n: number, level: string, text: string) =>
    `[2026-11-12 10:00:${String(n).padStart(2, '0')}.000] [${level}] ${text}`
  const options = { errors: 40, before: 40, frames: 8 }

  it('carries what happened before an error, not only the error', () => {
    const log = [
      stamp(1, 'info', 'open session'),
      stamp(2, 'info', 'convert 3 tracks'),
      stamp(3, 'info', 'ffmpeg started'),
      stamp(4, 'error', 'audio:convert failed'),
    ].join('\n')
    expect(recentContextLines(log, options)).toEqual(log.split('\n'))
  })

  it('does not repeat lines shared by two close errors', () => {
    const log = [
      stamp(1, 'error', 'first'),
      stamp(2, 'info', 'a'),
      stamp(3, 'info', 'b'),
      stamp(4, 'error', 'second'),
    ].join('\n')
    expect(recentContextLines(log, { ...options, before: 5 })).toEqual(log.split('\n'))
  })

  it('separates windows that do not touch with an ellipsis line', () => {
    const log = [
      stamp(1, 'error', 'first'),
      stamp(2, 'info', 'a'),
      stamp(3, 'info', 'b'),
      stamp(4, 'info', 'c'),
      stamp(5, 'error', 'second'),
    ].join('\n')
    expect(recentContextLines(log, { errors: 40, before: 0, frames: 8 })).toEqual([
      stamp(1, 'error', 'first'),
      '…',
      stamp(5, 'error', 'second'),
    ])
  })

  it('keeps the first stack frames so a minified renderer stack can be mapped back', () => {
    const frames = Array.from(
      { length: 20 },
      (_, i) =>
        `    at f${i} (file:///Applications/Surco.app/out/renderer/assets/index-abc.js:1:${i})`,
    )
    const log = [stamp(1, 'error', 'renderer crashed'), ...frames].join('\n')
    const lines = recentContextLines(log, options)
    expect(lines).toHaveLength(9)
    expect(lines.slice(1)).toEqual(
      Array.from({ length: 8 }, (_, i) => `    at f${i} (file:index-abc.js:1:${i})`),
    )
  })

  it('reduces Windows and macOS paths with spaces in context lines to the file name', () => {
    const log = [
      stamp(1, 'info', 'read C:\\Users\\Ana\\Música\\DJ Sets\\Pray (Mix).wav'),
      stamp(2, 'info', 'read /Users/ana/Music/DJ Sets/Pray (Mix).wav'),
      stamp(3, 'error', 'boom'),
    ].join('\n')
    const lines = recentContextLines(log, options)
    expect(lines[0]).toBe(stamp(1, 'info', 'read Pray (Mix).wav'))
    expect(lines[1]).toBe(stamp(2, 'info', 'read Pray (Mix).wav'))
  })

  it('keeps the tool output that explains a failed command', () => {
    const log = [
      stamp(1, 'error', 'audio:properties failed /Users/ana/Music/Entasia.wav'),
      '/Users/ana/Music/Entasia.wav: Invalid data found when processing input',
      '',
      '    at run (file:///Applications/Surco.app/out/main/index.js:5007:41)',
    ].join('\n')
    expect(recentContextLines(log, options)).toEqual([
      stamp(1, 'error', 'audio:properties failed Entasia.wav'),
      'Entasia.wav: Invalid data found when processing input',
      '    at run (file:index.js:5007:41)',
    ])
  })

  it('bounds the output on a pathological log', () => {
    const entry = (n: number) => [
      stamp(n % 60, 'error', `boom ${n}`),
      ...Array.from({ length: 200 }, (_, i) => `    at g${i} (/a/b/c.js:1:${i})`),
    ]
    const log = Array.from({ length: 5000 }, (_, n) => entry(n))
      .flat()
      .join('\n')
    expect(recentContextLines(log, options).length).toBeLessThanOrEqual(40 * (40 + 1 + 8))
  })

  it('returns nothing for a log with no errors', () => {
    expect(recentContextLines(stamp(1, 'info', 'all good'), options)).toEqual([])
  })

  it('survives an empty or unreadable log', () => {
    expect(recentContextLines('', options)).toEqual([])
  })
})
