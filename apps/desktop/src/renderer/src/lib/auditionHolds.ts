// The auditions that stream a track through surco:// beside the mini-player (cues, trim).
// On Windows their open descriptor blocks a conversion's rename over that file just as the
// player's does, so the player's release stops them as well.
const holds = new Set<{ path: string; stop: () => void }>()

// Registers an audition of `path` and returns its removal.
export function holdForAudition(path: string, stop: () => void): () => void {
  const hold = { path, stop }
  holds.add(hold)
  return () => {
    holds.delete(hold)
  }
}

// Stops every audition of `path`; true when there was one.
export function stopAuditionsOf(path: string): boolean {
  const of = [...holds].filter((h) => h.path === path)
  for (const h of of) h.stop()
  return of.length > 0
}
