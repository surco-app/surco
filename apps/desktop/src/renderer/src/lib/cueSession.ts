import { useSyncExternalStore } from 'react'
import type { QueuedCues } from '../../../shared/types'
import type { CueDraft } from './cueDraft'

export type AutoMark =
  | { kind: 'proposed'; ms: number[] }
  | { kind: 'none' }
  | { kind: 'marked' }
  | { kind: 'unanalysed' }

const drafts = new Map<string, { draftKey: string; value: CueDraft }>()
let marks: ReadonlyMap<string, AutoMark> = new Map()
const playheads = new Map<string, number>()
const listeners = new Set<() => void>()
let unsaved: ReadonlySet<string> = new Set()

function notify(): void {
  for (const listener of listeners) listener()
}

function changed(): void {
  unsaved = new Set(drafts.keys())
  notify()
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

export function cueDraftKey(
  contentId: string,
  fingerprint: string,
  queued: QueuedCues | null | undefined,
): string {
  return `${contentId}|${fingerprint}|${JSON.stringify(queued)}`
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

export function autoMarks(): ReadonlyMap<string, AutoMark> {
  return marks
}

export function useAutoMarks(): ReadonlyMap<string, AutoMark> {
  return useSyncExternalStore(subscribeCueDrafts, autoMarks)
}

export function autoMarkOf(contentId: string): AutoMark | undefined {
  return marks.get(contentId)
}

export function keepAutoMark(contentId: string, mark: AutoMark): void {
  if (JSON.stringify(marks.get(contentId)) === JSON.stringify(mark)) return
  marks = new Map(marks).set(contentId, mark)
  notify()
}

export function forgetAutoMark(contentId: string): void {
  if (!marks.has(contentId)) return
  const next = new Map(marks)
  next.delete(contentId)
  marks = next
  notify()
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
  marks = new Map()
  changed()
}
