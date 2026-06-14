// The surco:// handler streams whatever absolute path the renderer asks for, which
// is exactly what an XSS'd (or otherwise compromised) renderer would abuse to read
// arbitrary files off disk — ~/.ssh/id_rsa, /etc/passwd — through an <audio> src or
// a fetch. This registry bounds it to paths the app itself has handed to or accepted
// from the renderer as real tracks: the file picker's results, expanded drops, files
// opened through the OS, and conversion outputs (an in-place export renames the
// source, so the track then plays the new path). Anything else the handler refuses.

export interface MediaAccess {
  allow(path: string): void
  allowAll(paths: string[]): void
  isAllowed(path: string): boolean
}

export function createMediaAccess(): MediaAccess {
  const allowed = new Set<string>()
  return {
    allow(path) {
      // Guard the empty string so a blank path never becomes a servable entry.
      if (path) allowed.add(path)
    },
    allowAll(paths) {
      for (const path of paths) if (path) allowed.add(path)
    },
    isAllowed(path) {
      return allowed.has(path)
    },
  }
}
