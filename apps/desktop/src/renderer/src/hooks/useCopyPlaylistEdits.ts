import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  PlaylistLibrary,
  RekordboxEditResult,
  RekordboxPlaylistEdit,
  RekordboxPlaylistTarget,
  SourcePlaylistEntry,
} from '../../../shared/types'
import { linkAfter, linkIdsOf, type Membership } from '../lib/rekordboxPlaylists'
import { offerShortcutUndo } from '../lib/shortcutUndo'
import { SOURCE_PROGRAMS } from '../lib/sourcePrograms'
import { useToast } from '../lib/toastContext'
import { useRekordboxEdits } from './useRekordboxEdits'

export interface CopyPlaylistEdits {
  toggle: (paths: string[], target: RekordboxPlaylistTarget, on: boolean) => Promise<void>
  queued: ReadonlyMap<string, boolean>
  canRemove: boolean
}

export const queuedKey = (path: string, playlistId: string): string => `${path}\n${playlistId}`

type Said = { text: string; tone: 'neutral' | 'danger' } | null

function rowsLeft(entries: readonly SourcePlaylistEntry[], linkIds: readonly string[]): string[] {
  const gone = new Set(linkIds)
  return entries.flatMap((e) => (e.linkId !== undefined && !gone.has(e.linkId) ? [e.linkId] : []))
}

interface Place {
  path: string
  slot: number | null
}

// Where each removed copy sat, kept as the index among the rows that stay of the row that
// followed it, not as that row's handle: Traktor names a row by its position, which shifts once
// the copies leave. Each copy keeps its own place, so copies removed together from different
// spots of the set do not come back side by side. Sorted as they sat, so copies that shared a
// place go back in their order. A copy that sat twice keeps the place of its last row.
function placesOf(entries: readonly SourcePlaylistEntry[], paths: readonly string[]): Place[] {
  const linkIds = linkIdsOf(entries, paths)
  const left = rowsLeft(entries, linkIds)
  return paths
    .flatMap((path) => {
      const own = linkIdsOf(entries, [path])
      if (own.length === 0) return []
      const others = new Set(linkIds.filter((id) => !own.includes(id)))
      const after = linkAfter(
        entries.filter((e) => e.linkId === undefined || !others.has(e.linkId)),
        own,
      )
      const at = entries.findIndex((e) => e.linkId === own[own.length - 1])
      return [{ path, at, slot: after === null ? null : left.indexOf(after) }]
    })
    .sort((a, b) => a.at - b.at)
    .map(({ path, slot }) => ({ path, slot }))
}

// Ticks and unticks the playlists of a library copy in the program itself, through the same
// write path as the sidebar tree, so the copy is filed at once instead of at the next
// conversion. The notice is decided here rather than by useRekordboxEdits: an applied edit
// carries an Undo bound to the paths and playlist it touched, not to whatever track is open
// when the DJ presses it.
export function useCopyPlaylistEdits(
  library: PlaylistLibrary,
  membership: Membership | undefined,
): CopyPlaylistEdits {
  const { t: tr } = useTranslation()
  const { reportUndo, reportNotice, reportError } = useToast()
  const said = useRef<Said>(null)
  const notify = useCallback((text: string, tone: 'neutral' | 'danger') => {
    said.current = { text, tone }
  }, [])
  const beforeWrite = useCallback(() => window.api.dj.askToApply([library]), [library])
  const edit = useRekordboxEdits(notify, library, beforeWrite)
  const sourceEdit = SOURCE_PROGRAMS[library].edit
  const can = (kind: RekordboxPlaylistEdit['kind']): boolean =>
    !sourceEdit?.kinds || sourceEdit.kinds.has(kind)
  const canRemove = can('remove')
  const canMove = can('move')
  const [queued, setQueued] = useState<ReadonlyMap<string, boolean>>(new Map())
  const queuedRef = useRef(queued)
  queuedRef.current = queued

  // An edit queued while the program is open is not in the membership read from disk until
  // the program closes; the field keeps showing it until the read agrees.
  useEffect(() => {
    if (!membership) return
    setQueued((prev) => {
      const left = [...prev].filter(([key, on]) => {
        const cut = key.lastIndexOf('\n')
        const ids = membership[key.slice(0, cut)] ?? []
        return ids.includes(key.slice(cut + 1)) !== on
      })
      return left.length === prev.size ? prev : new Map(left)
    })
  }, [membership])

  const send = useCallback(
    async (
      change: RekordboxPlaylistEdit,
      name: string,
    ): Promise<{ result: RekordboxEditResult; said: Said }> => {
      said.current = null
      const result = await edit(change, name)
      return { result, said: said.current }
    },
    [edit],
  )

  const sayRefusal = useCallback(
    (message: Said) => {
      if (!message) return
      if (message.tone === 'danger') reportError(message.text)
      else reportNotice(message.text)
    },
    [reportError, reportNotice],
  )

  // An Undo answers only when it fails: it does not offer an Undo of its own.
  const sendQuietly = useCallback(
    async (change: RekordboxPlaylistEdit, name: string): Promise<RekordboxEditResult> => {
      const { result, said: message } = await send(change, name)
      if (!result.applied) sayRefusal(message)
      return result
    },
    [send, sayRefusal],
  )

  const offerUndo = useCallback(
    (text: string, undo: () => Promise<void>) => {
      const run = () => {
        withdraw()
        undo().catch((error) => {
          window.api.logError(String(error))
          reportError(tr(`${sourceEdit?.messagePrefix ?? 'sources.edit.'}refused.unreadable`))
        })
      }
      const dismiss = reportUndo(text, run, () => withdraw())
      const withdraw = offerShortcutUndo(() => {
        dismiss()
        run()
      })
    },
    [reportUndo, reportError, sourceEdit, tr],
  )

  // Only the rows the add made go: a path the program skipped because it was already there
  // keeps the row the DJ filed before.
  const takeOut = useCallback(
    async (paths: string[], playlistId: string, name: string, before: ReadonlySet<string>) => {
      const entries = await window.api.dj.playlist(library, playlistId)
      const linkIds = linkIdsOf(entries, paths).filter((id) => !before.has(id))
      if (linkIds.length > 0) await sendQuietly({ kind: 'remove', playlistId, linkIds }, name)
    },
    [library, sendQuietly],
  )

  // The order of a playlist is the DJ's set, so each copy goes back in front of the row that
  // followed it, not at the end. Programs skip a track already present on add, so a copy that
  // sat twice in the playlist comes back as one row. The playlist is read again before each
  // move because in Traktor the previous move renumbered the rows.
  const putBack = useCallback(
    async (places: Place[], playlistId: string, name: string) => {
      const paths = places.map((place) => place.path)
      const tracks = paths.map((p) => ({ paths: [p] }))
      const result = await sendQuietly({ kind: 'add', playlistId, tracks }, name)
      if (!result.applied || !canMove) return
      for (const { path, slot } of places) {
        if (slot === null) continue
        const entries = await window.api.dj.playlist(library, playlistId)
        const linkIds = linkIdsOf(entries, [path])
        const before = rowsLeft(entries, linkIdsOf(entries, paths))[slot]
        if (linkIds.length === 0 || before === undefined) continue
        const moved = await sendQuietly(
          { kind: 'move', playlistId, linkIds, beforeLinkId: before },
          name,
        )
        if (!moved.applied) return
      }
    },
    [library, sendQuietly, canMove],
  )

  const toggle = useCallback(
    async (paths: string[], target: RekordboxPlaylistTarget, on: boolean) => {
      const tracks = paths.map((p) => ({ paths: [p] }))
      let change: RekordboxPlaylistEdit
      let places: Place[] = []
      let removed = 0
      let before: ReadonlySet<string> = new Set()
      if (on) {
        if (target.id && canRemove)
          before = new Set(linkIdsOf(await window.api.dj.playlist(library, target.id), paths))
        change = target.id
          ? { kind: 'add', playlistId: target.id, tracks }
          : { kind: 'create', parentId: 'root', name: target.name, folder: false, tracks }
      } else {
        if (!target.id || !canRemove) return
        const playlistId = target.id
        const entries = await window.api.dj.playlist(library, playlistId)
        const linkIds = linkIdsOf(entries, paths)
        // An add queued while the program is open has no row on disk to take out, and the
        // queue cannot take one change back: the tick goes, and the DJ hears the add still
        // lands when the program closes.
        const waiting = paths.filter(
          (p) =>
            queuedRef.current.get(queuedKey(p, playlistId)) === true &&
            linkIdsOf(entries, [p]).length === 0,
        )
        if (waiting.length > 0) {
          setQueued((prev) => {
            const map = new Map(prev)
            for (const p of waiting) map.delete(queuedKey(p, playlistId))
            return map
          })
          reportNotice(
            tr('editor.playlists.copyQueuedStays', {
              count: waiting.length,
              name: target.name,
              app: tr(`sources.${library}`),
            }),
          )
        }
        if (linkIds.length === 0) return
        places = placesOf(entries, paths)
        // A copy filed twice is still one track to the DJ, so the notice counts tracks.
        removed = places.length
        change = { kind: 'remove', playlistId: target.id, linkIds }
      }
      const { result, said: message } = await send(change, target.name)
      if (!result.applied) {
        sayRefusal(message)
        const playlistId = target.id
        if ('queued' in result && playlistId)
          setQueued((prev) => {
            const map = new Map(prev)
            for (const p of paths) map.set(queuedKey(p, playlistId), on)
            return map
          })
        return
      }
      const text =
        change.kind === 'remove'
          ? tr('editor.playlists.copyRemoved', { count: removed, name: target.name })
          : (message?.text ??
            tr(`${sourceEdit?.messagePrefix ?? 'sources.edit.'}added`, {
              count: paths.length,
              name: target.name,
            }))
      const { name } = target
      if (change.kind === 'create') {
        const createdId = result.createdId
        if (createdId)
          offerUndo(text, async () => {
            await sendQuietly({ kind: 'delete', playlistId: createdId }, name)
          })
        else reportNotice(text)
      } else if (change.kind === 'add') {
        const { playlistId } = change
        if (!canRemove || result.report?.added === 0) reportNotice(text)
        else offerUndo(text, () => takeOut(paths, playlistId, name, before))
      } else if (change.kind === 'remove') {
        const { playlistId } = change
        offerUndo(text, () => putBack(places, playlistId, name))
      }
    },
    [
      library,
      canRemove,
      send,
      sayRefusal,
      offerUndo,
      sendQuietly,
      takeOut,
      putBack,
      reportNotice,
      sourceEdit,
      tr,
    ],
  )

  return { toggle, queued, canRemove }
}
