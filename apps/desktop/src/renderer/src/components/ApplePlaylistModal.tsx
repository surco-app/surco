import { ChevronRight, ListMusic, Search } from 'lucide-react'
import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppleMusicPlaylist } from '../../../shared/types'
import { ModalShell } from './ModalShell'

interface Props {
  // Receives the playlist's identity and its name: the import re-finds the crate by
  // persistent ID (the user can rename it in Music while this dialog is open), and the
  // name travels only so the status bar can say which one arrived.
  // Awaited: reading a big playlist takes seconds (14.5s for 982 tracks, measured), and
  // the dialog stays up saying so rather than closing into a silent window.
  onPick: (persistentId: string, name: string) => void | Promise<void>
  onClose: () => void
}

// Picks one of the user's own Apple Music playlists as a source of tracks. macOS only —
// App does not mount it elsewhere, the same way the Apple Music destination is absent
// off macOS rather than shown disabled: there is nothing to configure that would make it
// work, so a permanently dead control would only be a door that never opens.
export function ApplePlaylistModal({ onPick, onClose }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [lists, setLists] = useState<AppleMusicPlaylist[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [reading, setReading] = useState(false)

  useEffect(() => {
    let live = true
    window.api
      .loadAppleMusicPlaylists()
      .then((rows) => {
        if (live) setLists(rows)
      })
      .catch(() => {
        // Music can refuse to answer (not running, automation permission denied). Saying
        // so beats a box that stays empty forever and reads as "you have no playlists".
        if (live) setFailed(true)
      })
    return () => {
      live = false
    }
  }, [])

  const shown = useMemo(() => {
    if (!lists) return []
    const q = query.trim().toLowerCase()
    return q ? lists.filter((p) => p.name.toLowerCase().includes(q)) : lists
  }, [lists, query])

  // Grouped by the folder each playlist lives in. Reported with a screenshot of four rows
  // all named "95": on the real library 7 of 22 names repeat, and the folder is the only
  // thing telling them apart. Root playlists come first so none of them reads as belonging
  // to whichever folder happens to be at the top.
  const groups = useMemo(() => {
    const root: AppleMusicPlaylist[] = []
    const byFolder = new Map<string, AppleMusicPlaylist[]>()
    for (const p of shown) {
      if (!p.folder) {
        root.push(p)
        continue
      }
      const bucket = byFolder.get(p.folder)
      if (bucket) bucket.push(p)
      else byFolder.set(p.folder, [p])
    }
    return { root, folders: [...byFolder.entries()] }
  }, [shown])

  // Folded folders, by name. Empty means every folder is open: folding is for putting away
  // what you are not using, never a gate you must open to find something. A search looks
  // through every playlist regardless, so a folded folder can still produce a hit.
  const [folded, setFolded] = useState<Set<string>>(new Set())
  const searching = query.trim() !== ''
  function toggleFolder(name: string): void {
    setFolded((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const chosen = lists?.find((p) => p.persistentId === picked)
  // An empty playlist stays visible — hiding it would read as Surco losing it — but
  // importing one adds nothing, which the user would read as a failure.
  const canImport = !!chosen && chosen.count > 0

  // One row, drawn the same whether it sits at the root or inside a folder.
  function playlistRow(p: AppleMusicPlaylist): React.JSX.Element {
    return (
      <button
        type="button"
        data-testid="apple-playlist-row"
        onClick={() => setPicked(p.persistentId)}
        aria-pressed={picked === p.persistentId}
        className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm ${
          picked === p.persistentId
            ? 'bg-[var(--color-row-selected)] text-[var(--color-on-row-selected)]'
            : 'text-fg hover:bg-panel-2'
        }`}
      >
        <ListMusic className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{p.name}</span>
        <span className="shrink-0 text-xs tabular-nums opacity-70">{p.count}</span>
      </button>
    )
  }

  async function submit(): Promise<void> {
    if (!chosen || !canImport || reading) return
    setReading(true)
    try {
      await onPick(chosen.persistentId, chosen.name)
    } finally {
      setReading(false)
    }
  }

  return (
    <ModalShell
      onClose={onClose}
      backdropTestId="apple-playlist-backdrop"
      dialogTestId="apple-playlist-modal"
      className="flex h-[min(30rem,80vh)] w-[460px] flex-col rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-panel)]"
      labelledBy="apple-playlist-title"
      onSubmit={() => void submit()}
    >
      <div className="border-b border-[var(--color-line)] px-4 pt-4 pb-3">
        <h2 id="apple-playlist-title" className="text-sm font-semibold text-fg">
          {tr('applePlaylist.title')}
        </h2>
        <p className="mt-0.5 text-xs text-fg-dim">{tr('applePlaylist.subtitle')}</p>
      </div>

      {failed ? (
        <p data-testid="apple-playlist-error" className="px-4 py-6 text-sm text-fg-dim">
          {tr('applePlaylist.failed')}
        </p>
      ) : lists && lists.length === 0 ? (
        <p data-testid="apple-playlist-empty" className="px-4 py-6 text-sm text-fg-dim">
          {tr('applePlaylist.none')}
        </p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="px-4 pt-3">
            <div className="flex items-center gap-2 rounded-md border border-[var(--color-line-strong)] bg-[var(--color-field)] px-2.5 py-1.5">
              <Search className="h-3.5 w-3.5 shrink-0 text-fg-faint" aria-hidden="true" />
              <input
                data-testid="apple-playlist-search"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={tr('applePlaylist.search')}
                aria-label={tr('applePlaylist.search')}
                className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-fg-faint"
              />
            </div>
          </div>

          <ul className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {groups.root.map((p) => (
              <li key={p.persistentId}>{playlistRow(p)}</li>
            ))}
            {groups.folders.map(([folder, items]) => {
              // A search reaches inside every folder, so its hits show even when the
              // folder is folded — otherwise the box would swallow a name the user typed.
              const open = searching || !folded.has(folder)
              return (
                <li key={folder}>
                  <button
                    type="button"
                    data-testid="apple-playlist-folder"
                    onClick={() => toggleFolder(folder)}
                    aria-expanded={open}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-fg-muted text-sm hover:bg-panel-2"
                  >
                    <ChevronRight
                      className={`h-3.5 w-3.5 shrink-0 opacity-60 transition-transform ${
                        open ? 'rotate-90' : ''
                      }`}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">{folder}</span>
                    <span className="shrink-0 text-xs tabular-nums opacity-70">{items.length}</span>
                  </button>
                  {open && (
                    <ul className="pl-4">
                      {items.map((p) => (
                        <li key={p.persistentId}>{playlistRow(p)}</li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-[var(--color-line)] px-4 py-3">
        {reading && (
          <span data-testid="apple-playlist-reading" className="mr-auto text-xs text-fg-dim">
            {tr('applePlaylist.reading')}
          </span>
        )}
        <button
          type="button"
          data-testid="apple-playlist-cancel"
          onClick={onClose}
          className="press rounded-lg border border-[var(--color-line-strong)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-panel-2)]"
        >
          {tr('common.cancel')}
        </button>
        <button
          type="submit"
          data-testid="apple-playlist-import"
          disabled={!canImport || reading}
          className="press rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:cursor-default disabled:opacity-40"
        >
          {tr('applePlaylist.import')}
        </button>
      </div>
    </ModalShell>
  )
}
