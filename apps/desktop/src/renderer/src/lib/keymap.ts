export function moveIndex(length: number, current: number, delta: number): number {
  if (length === 0) return -1
  if (current === -1) return 0
  return Math.min(length - 1, Math.max(0, current + delta))
}

interface KeyLike {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
}

// Whether the focused element owns the keystroke, so the global shortcuts keep
// their hands off it. Beyond text fields this includes <select> (its own arrow
// and space keys drive the options — e.g. the album-match dropdown) and any
// contenteditable surface.
export function isTypingTarget(
  el: { tagName: string; isContentEditable?: boolean } | null,
): boolean {
  if (!el) return false
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable === true
  )
}

export function keyToCommandId(e: KeyLike, typing: boolean): string | null {
  const mod = e.metaKey || e.ctrlKey
  if (mod && e.key === 'Enter') return e.shiftKey ? 'process-all' : 'process-current'
  if (mod && e.key.toLowerCase() === 'o') return 'add'
  if (mod && e.key === ',') return 'settings'
  if (mod && e.key === 'Backspace') return typing ? null : 'remove'
  if (typing) return null
  if (e.key === ' ') return 'play'
  if (e.key === 'ArrowDown' || e.key === 'j') return 'next'
  if (e.key === 'ArrowUp' || e.key === 'k') return 'prev'
  if (e.key === '/') return 'search'
  return null
}
