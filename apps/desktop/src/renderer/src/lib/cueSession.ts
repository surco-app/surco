import { useEffect, useRef, useSyncExternalStore } from 'react'
import { SAME_POSITION_MS, type WantedCue } from '../../../shared/cueRules'
import type { QueuedCues, SaveCuesRequest, TrackCueRow } from '../../../shared/types'
import { type CueDraft, type DraftCue, wantedOfDraft } from './cueDraft'

export type AutoMark =
  | { kind: 'proposed'; ms: number[] }
  | { kind: 'none' }
  | { kind: 'marked' }
  | { kind: 'unanalysed' }

export interface CueSaveTarget {
  path: string
  label: string
  fingerprint: string
  provisional?: true
}

const drafts = new Map<
  string,
  { draftKey: string; value: CueDraft; target: CueSaveTarget; base: QueuedCues | null }
>()
let marks: ReadonlyMap<string, AutoMark> = new Map()
const playheads = new Map<string, number>()
let focus: { contentId: string; ms: number } | null = null
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

// `base` is the queued save the draft was built on, when it was built on one.
export function keepDraft(
  contentId: string,
  draftKey: string,
  value: CueDraft,
  target: CueSaveTarget,
  base: QueuedCues | null = null,
): void {
  const fresh = !drafts.has(contentId)
  drafts.set(contentId, { draftKey, value, target, base })
  if (fresh) changed()
}

export function keptOnSurcoGrid(contentId: string): boolean {
  return drafts.get(contentId)?.target.provisional === true
}

// The id the library gave each cue of a queued save once it wrote it, or null when what the
// library holds is not exactly that save.
function writtenIds(wanted: WantedCue[], rows: TrackCueRow[]): string[] | null {
  if (wanted.length !== rows.length) return null
  const left = [...rows]
  const ids: string[] = []
  for (const w of wanted) {
    const same = (r: TrackCueRow): boolean =>
      r.kind === w.kind && r.color === w.color && Math.abs(r.ms - w.ms) <= SAME_POSITION_MS
    const byId = left.findIndex((r) => r.id === w.id && same(r))
    const at = byId === -1 ? left.findIndex(same) : byId
    if (at === -1) return null
    ids.push(left[at].id)
    left.splice(at, 1)
  }
  return ids
}

function rebased(draft: CueDraft, wanted: WantedCue[], ids: string[]): CueDraft {
  const idOf = (c: DraftCue): string | undefined => {
    const at =
      c.id === undefined
        ? wanted.findIndex((w, i) => w.id === undefined && c.key === `n${i}`)
        : wanted.findIndex((w) => w.id === c.id)
    return at === -1 ? c.id : ids[at]
  }
  const cuesOf = (cues: DraftCue[]): DraftCue[] =>
    cues.map((c) => {
      const id = idOf(c)
      return id === undefined ? c : { ...c, id }
    })
  return {
    ...draft,
    cues: cuesOf(draft.cues),
    past: draft.past.map((s) => ({ ...s, cues: cuesOf(s.cues) })),
    future: draft.future.map((s) => ({ ...s, cues: cuesOf(s.cues) })),
  }
}

// The kept draft for what the library and the queue hold now. A draft built on a queued save
// still stands once the queue writes exactly that save: the DJ kept editing on top of it
// while the program was open. It moves onto the cues the library wrote, so saving it updates
// them instead of adding them a second time.
export function keptDraftOn(
  contentId: string,
  read: { fingerprint: string; cues: TrackCueRow[] },
  queued: QueuedCues | null | undefined,
): CueDraft | undefined {
  const draftKey = cueDraftKey(contentId, read.fingerprint, queued)
  const kept = drafts.get(contentId)
  if (!kept || kept.draftKey === draftKey) return kept?.value
  if (!kept.base || queued !== null) return undefined
  const ids = writtenIds(kept.base.wanted, read.cues)
  if (!ids) return undefined
  const value = rebased(kept.value, kept.base.wanted, ids)
  const target = { ...kept.target, fingerprint: read.fingerprint }
  drafts.set(contentId, { draftKey, value, target, base: null })
  return value
}

export function draftsToSave(): SaveCuesRequest[] {
  return [...drafts].map(([contentId, { value, target }]) => ({
    contentId,
    ...target,
    wanted: wantedOfDraft(value.cues),
  }))
}

export function keptDrafts(): {
  contentId: string
  path: string
  label: string
  draft: CueDraft
}[] {
  return [...drafts].map(([contentId, { value, target }]) => ({
    contentId,
    path: target.path,
    label: target.label,
    draft: value,
  }))
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

export function focusCue(spot: { contentId: string; ms: number }): void {
  focus = spot
  notify()
}

function cueFocus(): { contentId: string; ms: number } | null {
  return focus
}

export function useCueFocus(): { contentId: string; ms: number } | null {
  return useSyncExternalStore(subscribeCueDrafts, cueFocus)
}

export function settleCueFocus(): void {
  focus = null
  notify()
}

export function resetCueSession(): void {
  drafts.clear()
  playheads.clear()
  focus = null
  marks = new Map()
  changed()
}

export function useCueSessionFor(collection: string | undefined): void {
  const seen = useRef(collection)
  useEffect(() => {
    if (seen.current === collection) return
    if (seen.current !== undefined) resetCueSession()
    seen.current = collection
  }, [collection])
}
