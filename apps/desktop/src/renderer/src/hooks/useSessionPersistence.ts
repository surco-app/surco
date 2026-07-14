import type { TFunction } from 'i18next'
import { useEffect, useRef } from 'react'
import type { SessionData, SessionEdit } from '../../../shared/types'
import type { AppStore } from '../lib/appStore'
import { sessionEdits } from '../lib/sessionEdits'
import { dismissToast, pushToast } from '../lib/toastQueue'
import type { TrackItem } from '../types'
import { useStableCallback } from './useStableCallback'

interface Params {
  tracks: TrackItem[]
  // Read at call time inside the debounced write, so the snapshot reflects the list as it
  // SETTLES rather than as it looked when the burst began.
  tracksRef: { readonly current: TrackItem[] }
  // The same pipeline a drop goes through, so a restored session gets identical media
  // access and metadata reads.
  addPaths: (paths: string[], restore?: Record<string, SessionEdit>) => Promise<void>
  store: AppStore
  tr: TFunction
}

// The last session: offered back at launch, and written out as it changes.
//
// A self-contained subsystem — it returns nothing and App reads nothing from it — that was
// living as three refs, two constants, three callbacks and four effects strewn through App's
// body. Two rules carry the whole thing and are easy to break by accident, so they are
// spelled out where they live:
//   · The launch-time empty list is never saved (the null sentinel), or it would wipe the
//     stored session before the reopen offer could restore it.
//   · A half-loaded import is never snapshotted, or a restore would overwrite the very edits
//     it is restoring.
export function useSessionPersistence({ tracks, tracksRef, addPaths, store, tr }: Params): void {
  // The launch-time "reopen last session" offer. Asked once, and only while the list is
  // still empty — restoring the old list on top of a fresh import would mix two sessions,
  // so the offer withdraws itself the moment rows exist (the effect below). Accepting
  // routes through the same expand pipeline as a drop, so media access and metadata
  // reads behave exactly like a fresh import. The ✕ and (for a paths-only session)
  // the countdown expiring are both an answer: they clear the stored session so the
  // next launch doesn't re-ask about the very list the user already waved off.
  const LAST_SESSION_PROMPT_TIMEOUT_MS = 6_000
  const lastSessionToastId = useRef<string | null>(null)
  const reopenLastSession = useStableCallback(async (session: SessionData) => {
    // Retire the prompt right here, not via the rows-exist effect below: the ref must
    // clear immediately (a second click mid-import would double-load), and once it is
    // null that effect can no longer find the toast — it would stay up forever.
    if (lastSessionToastId.current) dismissToast(store, lastSessionToastId.current)
    lastSessionToastId.current = null
    // The staged edits ride along so each track's read overlays what the user had
    // retagged but not yet applied when the last session ended.
    await addPaths(await window.api.expandPaths(session.paths), session.edits)
  })
  // Stable identity so the ask-once effect below never re-runs (tr changes identity when
  // the settings load applies the language, which would cancel the in-flight ask), while
  // the closure still reads the current translations when the answer lands.
  const declineLastSession = useStableCallback(() => {
    lastSessionToastId.current = null
    void window.api.saveLastSession([], {})
  })
  const offerLastSession = useStableCallback((session: SessionData) => {
    if (session.paths.length === 0 || tracksRef.current.length > 0) return
    // Two stakes, two behaviours: a paths-only session loses nothing when the offer
    // ages out, so it keeps the countdown. Staged edits exist nowhere but in this
    // saved session — expiring would destroy them, so the offer stays up until the
    // user actually answers (Load, or the ✕ as a deliberate no).
    const hasEdits = Object.keys(session.edits).length > 0
    lastSessionToastId.current = pushToast(store, {
      key: 'last-session',
      tone: 'neutral',
      testid: 'last-session',
      message: tr('lastSession.prompt', { count: session.paths.length }),
      action: { label: tr('lastSession.load'), onAction: () => void reopenLastSession(session) },
      onDismiss: declineLastSession,
      ...(hasEdits
        ? {}
        : { duration: LAST_SESSION_PROMPT_TIMEOUT_MS, onExpire: declineLastSession }),
    })
  })
  useEffect(() => {
    let cancelled = false
    void window.api.getLastSession().then((session) => {
      if (!cancelled) offerLastSession(session)
    })
    return () => {
      cancelled = true
    }
  }, [offerLastSession])
  useEffect(() => {
    if (tracks.length === 0 || !lastSessionToastId.current) return
    dismissToast(store, lastSessionToastId.current)
    lastSessionToastId.current = null
  }, [tracks, store])

  // What the next launch offers to reopen: the current list's source paths plus each
  // track's staged edits, rewritten as they change so a crash or forced quit loses (at
  // most) the last second of retagging. The signature guard skips no-op renders
  // (progress ticks mint new track objects constantly without touching the payload),
  // the debounce coalesces a burst of keystrokes into one atomic write, and the
  // launch-time empty list is never saved (null sentinel), or it would wipe the stored
  // session before the reopen offer could restore it.
  const SESSION_SAVE_DEBOUNCE_MS = 1_000
  const savedSessionSig = useRef<string | null>(null)
  const sessionSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: tracksRef is read inside the debounced timer, on purpose — the write must snapshot the list as it SETTLES, not as it looked when the burst began. `tracks` stays the trigger; declaring the ref as a dependency would re-run the effect on every mutation, which is the per-render work this indirection exists to shed.
  useEffect(() => {
    // Rows whose metadata read is still in flight would snapshot half-loaded state —
    // and during a session restore that would overwrite the very edits being restored
    // — so the save waits for the import to settle.
    if (tracks.some((t) => t.loadingMeta)) return
    if (savedSessionSig.current === null && tracks.length === 0) return
    // Everything expensive happens on the debounced side, not here. The signature used to
    // be built (a full serialize of every path and every staged edit) in the effect body to
    // decide whether to schedule a write — so it ran on EVERY tracks identity change: each
    // keystroke in the editor, each progress tick of a conversion. On a large edited crate
    // that is a multi-hundred-KB stringify per keystroke, on the main thread, paid by a
    // guard whose whole purpose was to avoid work. Rescheduling the timer is cheap; the
    // serialize now happens once per settled burst, where the dedupe still catches the
    // no-op renders before any IPC goes out.
    if (sessionSaveTimer.current) clearTimeout(sessionSaveTimer.current)
    sessionSaveTimer.current = setTimeout(() => {
      sessionSaveTimer.current = null
      const settled = tracksRef.current
      if (settled.some((t) => t.loadingMeta)) return
      const paths = settled.map((t) => t.inputPath)
      const edits = sessionEdits(settled)
      const sig = JSON.stringify({ paths, edits })
      if (sig === savedSessionSig.current) return
      savedSessionSig.current = sig
      void window.api.saveLastSession(paths, edits)
    }, SESSION_SAVE_DEBOUNCE_MS)
  }, [tracks])
  useEffect(
    () => () => {
      if (sessionSaveTimer.current) clearTimeout(sessionSaveTimer.current)
    },
    [],
  )
}
