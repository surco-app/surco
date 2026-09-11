import { ListMusic, Search } from 'lucide-react'
import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppleMusicPlaylist } from '../../../shared/types'
import { ModalShell } from './ModalShell'

interface Props {
  // Receives the playlist's identity and its name: the import re-finds the crate by
  // persistent ID (the user can rename it in Music while this dialog is open), and the
  // name travels only so the status bar can say which one arrived.
  onPick: (persistentId: string, name: string) => void
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

  const chosen = lists?.find((p) => p.persistentId === picked)
  // An empty playlist stays visible — hiding it would read as Surco losing it — but
  // importing one adds nothing, which the user would read as a failure.
  const canImport = !!chosen && chosen.count > 0

  function submit(): void {
    if (chosen && canImport) onPick(chosen.persistentId, chosen.name)
  }

  return (
    <ModalShell
      onClose={onClose}
      backdropTestId="apple-playlist-backdrop"
      dialogTestId="apple-playlist-modal"
      className="flex w-full max-w-lg flex-col"
      labelledBy="apple-playlist-title"
      onSubmit={submit}
    >
      <div className="border-b border-line px-4 pt-4 pb-3">
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
        <>
          <div className="px-4 pt-3">
            <div className="flex items-center gap-2 rounded-md border border-line-strong bg-field px-2.5 py-1.5">
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

          <ul className="max-h-64 overflow-y-auto px-2 py-2">
            {shown.map((p) => (
              <li key={p.persistentId}>
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
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
        <button
          type="button"
          data-testid="apple-playlist-cancel"
          onClick={onClose}
          className="rounded-md border border-line-strong px-3 py-1.5 text-sm text-fg-muted"
        >
          {tr('common.cancel')}
        </button>
        <button
          type="submit"
          data-testid="apple-playlist-import"
          disabled={!canImport}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-[var(--color-on-accent)] disabled:opacity-50"
        >
          {tr('applePlaylist.import')}
        </button>
      </div>
    </ModalShell>
  )
}
