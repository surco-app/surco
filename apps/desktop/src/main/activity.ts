import type { ActivityEvent, ActivityKind, ActivityParams } from '../shared/types'

// The activity log's main-process hub. Background work (Discogs/Bandcamp calls,
// cover downloads, conversions) reports through a single `track()` wrapper so the
// renderer's floating panel can show what Surco is doing under the hood — each
// step as a human-readable line, with the raw technical detail on demand.
//
// It's deliberately a tiny in-process emitter, not Electron-aware: the window
// wiring (index.ts) subscribes a webContents.send sink, and the same wrapper
// works under test with a plain array sink. Keeping it framework-free is what
// makes the start/done/error contract unit-testable without spinning up Electron.

type Listener = (event: ActivityEvent) => void

export interface Activity {
  // Subscribe to the event stream; returns an unsubscribe, mirroring the preload
  // on*() pattern so the window can detach the sink when it closes.
  subscribe(listener: Listener): () => void
  emit(event: ActivityEvent): void
  // Wrap a unit of background work: emits `start` before it runs and `done`
  // (with elapsed ms) or `error` (with the raw message) after, then returns the
  // task's value or rethrows untouched, so a call site behaves exactly as before.
  // `labelKey` is an i18n key the panel translates (with `opts.labelParams`); the
  // main process never produces finished UI text. `opts.detail` is a fixed *raw*
  // line known up front (a request URL); `opts.summary` computes the done detail
  // from the resolved value — returning a key+params (translated) or a raw string
  // (a release title) — which only exists once the task finishes.
  track<T>(
    kind: ActivityKind,
    labelKey: string,
    task: () => Promise<T>,
    opts?: TrackOpts<T>,
  ): Promise<T>
}

// What a summary contributes to the done event's detail: either a translatable
// key (+params) or a raw string for untranslatable data (a title). Mutually
// exclusive in practice; the emitter prefers the key when both are somehow set.
interface SummaryDetail {
  detail?: string
  detailKey?: string
  detailParams?: ActivityParams
}

interface TrackOpts<T> {
  labelParams?: ActivityParams
  detail?: string
  detailKey?: string
  detailParams?: ActivityParams
  summary?: (value: T) => SummaryDetail
  // Fold this step under a shared row in the panel (e.g. a track's analyze probes).
  // `group` is the collapse key; `groupLabel` titles the folded row (a raw file
  // name). Stamped onto every emitted event so the renderer can group start and done.
  group?: string
  groupLabel?: string
  // A web page this step points at (a release page), surfaced as an open-in-browser
  // affordance on the row.
  url?: string
}

export function createActivity(): Activity {
  const listeners = new Set<Listener>()
  // A monotonic counter, not a timestamp/random: those are unavailable here and a
  // counter is enough to keep concurrent steps on distinct rows within one run.
  let nextId = 0

  const emit = (event: ActivityEvent): void => {
    for (const listener of listeners) listener(event)
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    emit,
    async track(kind, labelKey, task, opts) {
      const id = `act-${nextId++}`
      const { labelParams, detail, detailKey, detailParams, group, groupLabel, url } = opts ?? {}
      // performance.now() is the one clock available in this environment; it's a
      // monotonic relative timer, exactly what an elapsed-ms measure wants.
      const startedAt = performance.now()
      const base = { id, kind, labelKey, labelParams, group, groupLabel, url }
      emit({ ...base, phase: 'start', detail, detailKey, detailParams })
      try {
        const value = await task()
        // A summary's key/params win over the up-front detail; absent a summary the
        // fixed detail (a URL) carries through to done unchanged.
        const summary = opts?.summary?.(value)
        emit({
          ...base,
          phase: 'done',
          detail: summary?.detail ?? detail,
          detailKey: summary?.detailKey ?? detailKey,
          detailParams: summary?.detailParams ?? detailParams,
          ms: Math.round(performance.now() - startedAt),
        })
        return value
      } catch (err) {
        // An abort is the user's own doing (browsing away cancels a track's analyses),
        // not a failure — close the row cleanly instead of flooding the feed with a red
        // "failed" entry per skipped track. The rejection still propagates below so the
        // caller never treats the cancelled work as having produced a result.
        if (err instanceof Error && err.name === 'AbortError') {
          emit({ ...base, phase: 'done', detail, ms: Math.round(performance.now() - startedAt) })
          throw err
        }
        const message = err instanceof Error ? err.message : String(err)
        emit({
          ...base,
          phase: 'error',
          // The raw error appends to any fixed raw detail (a URL); it is never keyed.
          detail: detail ? `${detail}\n${message}` : message,
          ms: Math.round(performance.now() - startedAt),
        })
        throw err
      }
    },
  }
}

// The process-wide instance every instrumented call site reports through. The
// window wires its sink to this at startup (see index.ts).
export const activity = createActivity()
