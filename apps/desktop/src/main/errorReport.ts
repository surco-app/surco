// The log lines that go into a bug report. A report opens a public GitHub issue, so
// what travels is chosen twice over: the errors with the entries just before each and
// their first stack frames (the log is mostly updater download chatter), and only the
// file name out of any path they quote — the directory tree identifies the person,
// never the bug.

const ROOT_PREFIX = /[\s(["'=:,;]/
const LETTER = /[A-Za-z]/
const SEPARATOR = /[/\\]/

function isRootAt(line: string, i: number): number {
  const before = i === 0 ? '' : line[i - 1]
  const atBoundary = i === 0 || ROOT_PREFIX.test(before)
  const c = line[i]
  if (c === '/' && atBoundary && i + 1 < line.length && !/\s/.test(line[i + 1])) return 1
  if (c === '\\' && line[i + 1] === '\\' && atBoundary) return 2
  if (
    LETTER.test(c) &&
    (i === 0 || !/[A-Za-z0-9]/.test(before)) &&
    line[i + 1] === ':' &&
    SEPARATOR.test(line[i + 2] ?? '')
  )
    return 3
  return 0
}

export function stripPaths(line: string): string {
  const roots: number[] = []
  for (let i = 0; i < line.length; ) {
    const width = isRootAt(line, i)
    if (width) {
      roots.push(i)
      i += width
    } else {
      i++
    }
  }
  let out = ''
  let copied = 0
  roots.forEach((root, index) => {
    const end = index + 1 < roots.length ? roots[index + 1] : line.length
    let lastSeparator = -1
    for (let i = root; i < end; i++) if (SEPARATOR.test(line[i])) lastSeparator = i
    out += line.slice(copied, root)
    copied = lastSeparator + 1
  })
  return out + line.slice(copied)
}

// electron-log writes one line per entry, prefixed "[timestamp] [level]".
const ERROR_LINE = /^\[[^\]]+\]\s+\[error\]/
const ENTRY_START = /^\[[^\]]+\]\s+\[\w+\]/
const STACK_FRAME = /^\s+at /

interface ContextOptions {
  errors: number
  before: number
  frames: number
}

interface LogEntry {
  isError: boolean
  header: string
  detail: string[]
  frames: string[]
}

function parseEntries(log: string, maxFrames: number): LogEntry[] {
  const entries: LogEntry[] = []
  let current: LogEntry | null = null
  for (const line of log.split('\n')) {
    if (ENTRY_START.test(line)) {
      current = { isError: ERROR_LINE.test(line), header: line, detail: [], frames: [] }
      entries.push(current)
    } else if (current?.isError && line.trim()) {
      if (!STACK_FRAME.test(line)) current.detail.push(line)
      else if (current.frames.length < maxFrames) current.frames.push(line)
    }
  }
  return entries
}

export function recentContextLines(log: string, opts: ContextOptions): string[] {
  const entries = parseEntries(log, opts.frames)
  const errorIndexes: number[] = []
  entries.forEach((entry, index) => {
    if (entry.isError) errorIndexes.push(index)
  })
  const selected = new Set<number>()
  for (const index of errorIndexes.slice(-opts.errors)) {
    for (let i = Math.max(0, index - opts.before); i <= index; i++) selected.add(i)
  }
  const lines: string[] = []
  let previous = -1
  for (const index of [...selected].sort((a, b) => a - b)) {
    if (previous >= 0 && index !== previous + 1) lines.push('…')
    const entry = entries[index]
    lines.push(
      ...[entry.header, ...entry.detail, ...entry.frames].map((l) => stripPaths(l.trimEnd())),
    )
    previous = index
  }
  return lines
}
