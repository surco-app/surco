import { useSyncExternalStore } from 'react'
import type { CueDraft } from './cueDraft'

const drafts = new Map<string, { draftKey: string; value: CueDraft }>()
const playheads = new Map<string, number>()
const listeners = new Set<() => void>()
let unsaved: ReadonlySet<string> = new Set()

function changed(): void {
  unsaved = new Set(drafts.keys())
  for (const listener of listeners) listener()
}

export function subscribeCueDrafts(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function unsavedCueTracks(): ReadonlySet<string> {
  return unsaved
}

export function useUnsavedCueTracks(): ReadonlySet<string> {
  return useSyncExternalStore(subscribeCueDrafts, unsavedCueTracks)
}

export function keptDraft(contentId: string, draftKey: string): CueDraft | undefined {
  const kept = drafts.get(contentId)
  return kept?.draftKey === draftKey ? kept.value : undefined
}

export function keepDraft(contentId: string, draftKey: string, value: CueDraft): void {
  const fresh = !drafts.has(contentId)
  drafts.set(contentId, { draftKey, value })
  if (fresh) changed()
}

export function forgetDraft(contentId: string): void {
  if (drafts.delete(contentId)) changed()
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
  changed()
}
