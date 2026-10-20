import type { CueDraft } from './cueDraft'

const drafts = new Map<string, { draftKey: string; value: CueDraft }>()
const playheads = new Map<string, number>()

export function keptDraft(contentId: string, draftKey: string): CueDraft | undefined {
  const kept = drafts.get(contentId)
  return kept?.draftKey === draftKey ? kept.value : undefined
}

export function keepDraft(contentId: string, draftKey: string, value: CueDraft): void {
  drafts.set(contentId, { draftKey, value })
}

export function forgetDraft(contentId: string): void {
  drafts.delete(contentId)
}

export function keptPlayhead(contentId: string): number {
  return playheads.get(contentId) ?? 0
}

export function keepPlayhead(contentId: string, ms: number): void {
  playheads.set(contentId, ms)
}

export function resetCueSession(): void {
  drafts.clear()
  playheads.clear()
}
