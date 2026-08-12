// The log lines that go into a bug report. A report opens a public GitHub issue, so
// what travels is chosen twice over: only lines recording a failure (the log is mostly
// updater download chatter), and only the file name out of any path they quote — the
// directory tree identifies the person, never the bug.

// Absolute paths, POSIX and Windows, reduced to their last segment. File names here
// carry spaces, dashes and accents ("Sola Brothers - Open Eyes.mp3"), so the run stops
// only at a path separator, and at the quote/paren that usually closes the path in a
// log line.
const POSIX_PATH = /\/(?:[^/\s"')]*\/)*([^/\s"')]+(?:[ \t][^/\s"')]+)*)/g
const WINDOWS_PATH = /[A-Za-z]:\\(?:[^\\\s"')]*\\)*([^\\\s"')]+(?:[ \t][^\\\s"')]+)*)/g

export function stripPaths(line: string): string {
  return line.replace(WINDOWS_PATH, '$1').replace(POSIX_PATH, '$1')
}

// electron-log writes one line per entry, prefixed "[timestamp] [level]".
const ERROR_LINE = /^\[[^\]]+\]\s+\[error\]/

export function recentErrorLines(log: string, limit: number): string[] {
  return log
    .split('\n')
    .filter((line) => ERROR_LINE.test(line))
    .slice(-limit)
    .map((line) => stripPaths(line.trimEnd()))
}
