// The log lines that go into a bug report. A report opens a public GitHub issue, so
// what travels is chosen twice over: the errors with the entries just before each and
// their first stack frames (the log is mostly updater download chatter), and only the
// file name out of any path they quote — the directory tree identifies the person,
// never the bug.

// Absolute paths, POSIX and Windows, reduced to their last segment. File names here
// carry spaces, dashes and accents ("Sola Brothers - Open Eyes.mp3"), so the run stops
// only at a path separator, and at the quote/paren that usually closes the path in a
// log line.
const FOLDER_POSIX = String.raw`(?:[^/\s()"']|\([^()/]*\)|(?<=\S)["']|[ \t](?!-\S))*`
const FOLDER_WINDOWS = String.raw`(?:[^\\\s()"']|\([^()\\]*\)|(?<=\S)["']|[ \t](?!-\S))*`
const POSIX_PATH = new RegExp(
  String.raw`/(?:${FOLDER_POSIX}/)*([^/\s"')]+(?:[ \t][^/\s"')]+)*)`,
  'g',
)
const WINDOWS_PATH = new RegExp(
  String.raw`(?:[A-Za-z]:\\|\\\\)(?:${FOLDER_WINDOWS}\\)*([^\\\s"')]+(?:[ \t][^\\\s"')]+)*)`,
  'g',
)

export function stripPaths(line: string): string {
  return line.replace(WINDOWS_PATH, '$1').replace(POSIX_PATH, '$1')
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
