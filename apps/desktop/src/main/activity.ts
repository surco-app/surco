import type { ActivityEvent, ActivityKind } from '../shared/types'

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
  // `opts.detail` is a fixed technical line known up front (e.g. the request URL);
  // `opts.summary` computes the done detail from the resolved value (e.g. result
  // count), which only exists once the task finishes.
  track<T>(
    kind: ActivityKind,
    label: string,
    task: () => Promise<T>,
    opts?: TrackOpts<T>,
  ): Promise<T>
}

interface TrackOpts<T> {
  detail?: string
  summary?: (value: T) => string
  // Fold this step under a shared row in the panel (e.g. a track's analyze probes).
  // `group` is the collapse key; `groupLabel` titles the folded row. Stamped onto
  // every emitted event so the renderer can group start and done alike.
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
    async track(kind, label, task, opts) {
      const id = `act-${nextId++}`
      const detail = opts?.detail
      const group = opts?.group
      const groupLabel = opts?.groupLabel
      const url = opts?.url
      // performance.now() is the one clock available in this environment; it's a
      // monotonic relative timer, exactly what an elapsed-ms measure wants.
      const startedAt = performance.now()
      emit({ id, kind, phase: 'start', label, detail, group, groupLabel, url })
      try {
        const value = await task()
        const doneDetail = opts?.summary ? opts.summary(value) : detail
        emit({
          id,
          kind,
          phase: 'done',
          label,
          detail: doneDetail,
          ms: Math.round(performance.now() - startedAt),
          group,
          groupLabel,
          url,
        })
        return value
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        emit({
          id,
          kind,
          phase: 'error',
          label,
          detail: detail ? `${detail}\n${message}` : message,
          ms: Math.round(performance.now() - startedAt),
          group,
          groupLabel,
          url,
        })
        throw err
      }
    },
  }
}

// The process-wide instance every instrumented call site reports through. The
// window wires its sink to this at startup (see index.ts).
export const activity = createActivity()
