import type { CueDraft } from './cueDraft'

let draft: { key: string; value: CueDraft } | null = null
let playhead: { contentId: string; ms: number } | null = null

export function keptDraft(key: string): CueDraft | undefined {
  return draft?.key === key ? draft.value : undefined
}

export function keepDraft(key: string, value: CueDraft): void {
  draft = { key, value }
}

export function forgetDraft(): void {
  draft = null
}

export function keptPlayhead(contentId: string): number {
  return playhead?.contentId === contentId ? playhead.ms : 0
}

export function keepPlayhead(contentId: string, ms: number): void {
  playhead = { contentId, ms }
}

export function resetCueSession(): void {
  draft = null
  playhead = null
}
