import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Settings } from '../../shared/types'
import { CommandPalette } from './components/CommandPalette'
import { Editor } from './components/Editor'
import { ResizeHandle, useResizableWidth } from './components/ResizeHandle'
import { SettingsModal } from './components/SettingsModal'
import { TrackList } from './components/TrackList'
import { UpdateToast } from './components/UpdateToast'
import { eligibleForBatch } from './lib/batch'
import { type Command, runCommand } from './lib/commands'
import { openFeedback } from './lib/feedback'
import { DEFAULT_FIELDS, DEFAULT_REQUIRED_FIELDS, missingRequired } from './lib/fields'
import { parseFileName } from './lib/filename'
import { sanitizeMeta } from './lib/hygiene'
import { keyToCommandId, moveIndex } from './lib/keymap'
import { renderOutputName } from './lib/outputName'
import { applyProgress } from './lib/progress'
import { searchFromTags } from './lib/search'
import { formatShortcut } from './lib/shortcuts'
import { resolveTheme } from './lib/theme'
import type { TrackItem } from './types'

const AUDIO_EXT = /\.(wav|flac|aif|aiff|mp3)$/i

// macOS shows ⌘; everywhere else the shortcuts fire on Ctrl and read as "Ctrl".
const isMac = window.api.platform === 'darwin'

function newTrack(path: string): TrackItem {
  const { fileName, artist, title, query } = parseFileName(path)
  return {
    id: crypto.randomUUID(),
    inputPath: path,
    fileName,
    query,
    status: 'idle',
    meta: {
      title,
      artist,
      album: '',
      albumArtist: artist,
      year: '',
      genre: '',
      grouping: '',
      comment: '',
      trackNumber: '',
      discNumber: '',
      bpm: '',
      key: '',
      publisher: '',
      catalogNumber: '',
      remixArtist: '',
    },
  }
}

export default function App(): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [tracks, setTracks] = useState<TrackItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showPalette, setShowPalette] = useState(false)
  const [dragging, setDragging] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const audioUrlRef = useRef<string | null>(null)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [batching, setBatching] = useState(false)

  useEffect(() => {
    window.api.getSettings().then(setSettings)
  }, [])

  useEffect(() => {
    const pref = settings?.theme ?? 'system'
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      document.documentElement.dataset.theme = resolveTheme(pref, mq.matches)
    }
    apply()
    if (pref !== 'system') return
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [settings?.theme])

  // The native menu triggers actions by command id, the same registry the
  // palette and keyboard shortcuts use, so the three surfaces never drift apart.
  // Opening the palette is the one exception: it's a UI affordance, not a track
  // command, so it never lists itself.
  useEffect(
    () =>
      window.api.onMenuCommand((id) => {
        if (id === 'palette') setShowPalette(true)
        else runCommand(commandsRef.current, id)
      }),
    [],
  )

  useEffect(
    () => window.api.onProcessProgress((p) => setTracks((prev) => applyProgress(prev, p))),
    [],
  )

  // Playback only ever applies to the selected track: switching selection stops
  // it, and the object URL is freed on unmount.
  useEffect(() => {
    audioRef.current?.pause()
    setPlayingId(null)
  }, [selectedId])

  useEffect(
    () => () => {
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
    },
    [],
  )

  async function addPaths(paths: string[]): Promise<void> {
    const existing = new Set(tracks.map((t) => t.inputPath))
    const fresh = paths.filter((p) => AUDIO_EXT.test(p) && !existing.has(p))
    if (fresh.length === 0) return
    const items = await Promise.all(
      fresh.map(async (path) => {
        const base = newTrack(path)
        try {
          const [tags, cover] = await Promise.all([
            window.api.readTags(path),
            window.api.readCover(path),
          ])
          const s = searchFromTags(parseFileName(path), tags)
          return {
            ...base,
            query: s.query,
            coverUrl: cover ?? undefined,
            meta: {
              ...base.meta,
              ...tags,
              title: s.title,
              artist: s.artist,
              albumArtist: tags.albumArtist || s.artist,
            },
          }
        } catch {
          return base
        }
      }),
    )
    setTracks((prev) => [...prev, ...items])
    if (!selectedId) setSelectedId(items[0].id)
  }

  async function pickFiles(): Promise<void> {
    addPaths(await window.api.pickFiles())
  }

  function onDrop(e: React.DragEvent): void {
    e.preventDefault()
    setDragging(false)
    addPaths(Array.from(e.dataTransfer.files).map((f) => window.api.getPathForFile(f)))
  }

  function updateTrack(id: string, patch: Partial<TrackItem>): void {
    setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }

  function removeTrack(id: string): void {
    setTracks((prev) => prev.filter((t) => t.id !== id))
    if (selectedId === id) setSelectedId((prev) => (prev === id ? null : prev))
  }

  function clearTracks(): void {
    setTracks([])
    setSelectedId(null)
  }

  async function togglePlay(): Promise<void> {
    const audio = audioRef.current
    if (!audio || !selected) return
    if (playingId === selected.id) {
      if (audio.paused) audio.play().catch(() => {})
      else audio.pause()
      return
    }
    const buf = await window.api.readAudio(selected.inputPath)
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
    audioUrlRef.current = URL.createObjectURL(new Blob([buf]))
    audio.src = audioUrlRef.current
    setPlayingId(selected.id)
    audio.play().catch(() => {})
  }

  async function processOne(id: string): Promise<void> {
    const track = tracks.find((t) => t.id === id)
    if (!track) return
    const missing = missingRequired(track.meta, settings?.requiredFields ?? DEFAULT_REQUIRED_FIELDS)
    if (missing.length) {
      const names = missing.map((k) => tr(`fields.${k}`)).join(', ')
      updateTrack(id, {
        status: 'error',
        error: tr('editor.missingRequired', { fields: names }),
        stage: undefined,
      })
      return
    }
    updateTrack(id, { status: 'processing', error: undefined, stage: undefined })
    const meta = sanitizeMeta(track.meta, {
      trim: settings?.trimWhitespace ?? true,
      zeroPad: settings?.zeroPadTrack ?? true,
    })
    const format = settings?.filenameFormat ?? '{artist} - {title}'
    const outputName = track.outputName?.trim() || renderOutputName(format, meta) || track.fileName
    try {
      const { outputPath } = await window.api.processTrack({
        id: track.id,
        inputPath: track.inputPath,
        outputName,
        meta,
        coverUrl: track.coverUrl,
        coverPath: track.coverPath,
      })
      updateTrack(id, { status: 'done', outputPath, stage: undefined })
    } catch (e) {
      updateTrack(id, {
        status: 'error',
        error: e instanceof Error ? e.message : tr('editor.processError'),
        stage: undefined,
      })
    }
  }

  async function processAll(): Promise<void> {
    if (batching) return
    setBatching(true)
    try {
      for (const id of eligibleForBatch(tracks)) {
        await processOne(id)
      }
    } finally {
      setBatching(false)
    }
  }

  function saveSettings(patch: Partial<Settings>): void {
    window.api.saveSettings(patch).then(setSettings)
  }

  function moveSelection(delta: number): void {
    const next = moveIndex(
      tracks.length,
      tracks.findIndex((t) => t.id === selectedId),
      delta,
    )
    if (next === -1) return
    setSelectedId(tracks[next].id)
  }

  const sidebar = useResizableWidth(288, 220, 520)

  const selected = tracks.find((t) => t.id === selectedId) ?? null
  const canProcessSelected =
    !!selected && (selected.status === 'idle' || selected.status === 'error')
  const eligibleCount = eligibleForBatch(tracks).length
  const canProcessAll = eligibleCount > 0 && !batching

  const commands: Command[] = [
    {
      id: 'add',
      title: tr('commands.add'),
      hint: formatShortcut(['mod', 'O'], isMac),
      enabled: true,
      run: pickFiles,
    },
    {
      id: 'process-current',
      title: tr('commands.processCurrent'),
      hint: formatShortcut(['mod', 'enter'], isMac),
      enabled: canProcessSelected,
      run: () => selected && processOne(selected.id),
    },
    {
      id: 'process-all',
      title: tr('commands.processAll'),
      hint: formatShortcut(['mod', 'shift', 'enter'], isMac),
      enabled: canProcessAll,
      run: processAll,
    },
    { id: 'play', title: tr('commands.play'), hint: '␣', enabled: !!selected, run: togglePlay },
    {
      id: 'remove',
      title: tr('commands.remove'),
      hint: formatShortcut(['mod', 'backspace'], isMac),
      enabled: !!selected,
      run: () => selected && removeTrack(selected.id),
    },
    {
      id: 'remove-all',
      title: tr('commands.removeAll'),
      enabled: tracks.length > 0,
      run: clearTracks,
    },
    {
      id: 'reveal',
      title: tr('commands.reveal'),
      enabled: !!selected?.outputPath,
      run: () => selected?.outputPath && window.api.reveal(selected.outputPath),
    },
    {
      id: 'next',
      title: tr('commands.next'),
      hint: '↓',
      enabled: tracks.length > 1,
      run: () => moveSelection(1),
    },
    {
      id: 'prev',
      title: tr('commands.prev'),
      hint: '↑',
      enabled: tracks.length > 1,
      run: () => moveSelection(-1),
    },
    {
      id: 'search',
      title: tr('commands.search'),
      hint: '/',
      enabled: !!selected,
      run: () => searchInputRef.current?.focus(),
    },
    {
      id: 'settings',
      title: tr('commands.settings'),
      hint: formatShortcut(['mod', ','], isMac),
      enabled: true,
      run: () => setShowSettings(true),
    },
    {
      id: 'feedback',
      title: tr('commands.feedback'),
      enabled: true,
      run: () => openFeedback(),
    },
    {
      id: 'website',
      title: tr('commands.website'),
      enabled: true,
      run: () => window.open('https://getsurco.app/'),
    },
  ]

  const commandsRef = useRef<Command[]>(commands)
  commandsRef.current = commands
  const paletteOpenRef = useRef(false)
  paletteOpenRef.current = showPalette
  const settingsOpenRef = useRef(false)
  settingsOpenRef.current = showSettings

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setShowPalette((v) => !v)
        return
      }
      if (e.key === 'Escape') {
        if (paletteOpenRef.current) setShowPalette(false)
        else if (settingsOpenRef.current) setShowSettings(false)
        return
      }
      if (paletteOpenRef.current || settingsOpenRef.current) return
      const el = document.activeElement
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
      const id = keyToCommandId(e, typing)
      if (id) {
        e.preventDefault()
        runCommand(commandsRef.current, id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      className="flex h-screen flex-col"
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <audio ref={audioRef} hidden onEnded={() => setPlayingId(null)} />
      <header
        className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--color-line)] pr-3 pl-20"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div />
        <div
          className="flex items-center gap-2"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {tracks.length > 0 && (
            <button
              data-testid="convert-all"
              onClick={processAll}
              disabled={!canProcessAll}
              className="press flex h-8 items-center rounded-lg bg-[var(--color-accent)] px-3.5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
            >
              {batching ? tr('header.converting') : `${tr('header.convertAll')} (${eligibleCount})`}
            </button>
          )}
          <button
            data-testid="add-files"
            onClick={pickFiles}
            className="press flex h-8 items-center rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-3.5 text-sm font-medium hover:bg-[var(--color-line-strong)]"
          >
            {tr('header.add')}
          </button>
          <button
            data-testid="open-palette"
            onClick={() => setShowPalette(true)}
            className="press flex h-8 items-center gap-1 rounded-lg border border-[var(--color-line)] px-2.5 text-[11px] font-medium text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
            aria-label={tr('header.palette')}
          >
            <kbd className="font-sans">{isMac ? '⌘' : 'Ctrl'}</kbd>
            <kbd className="font-sans">K</kbd>
          </button>
          <button
            data-testid="open-settings"
            onClick={() => setShowSettings(true)}
            className="press flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-line)] text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
            aria-label={tr('header.settings')}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="h-4 w-4"
            >
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside
          style={{ width: sidebar.width }}
          className="shrink-0 overflow-y-auto bg-[var(--color-panel)]"
        >
          {tracks.length === 0 ? (
            <p className="p-6 text-center text-xs text-fg-faint">{tr('sidebar.dropHint')}</p>
          ) : (
            <TrackList
              tracks={tracks}
              selectedId={selectedId}
              outputFormat={settings?.outputFormat ?? 'aiff'}
              onSelect={setSelectedId}
              onRemove={removeTrack}
            />
          )}
        </aside>

        <ResizeHandle onPointerDown={sidebar.onPointerDown} />

        <main className="min-w-0 flex-1 bg-[var(--color-panel)]">
          {selected ? (
            <Editor
              key={selected.id}
              item={selected}
              hasToken={!!settings?.discogsToken}
              outputFormat={settings?.outputFormat ?? 'aiff'}
              filenameFormat={settings?.filenameFormat ?? '{artist} - {title}'}
              groupingPresets={settings?.groupingPresets ?? []}
              visibleFields={settings?.visibleFields ?? DEFAULT_FIELDS}
              requiredFields={settings?.requiredFields ?? DEFAULT_REQUIRED_FIELDS}
              searchInputRef={searchInputRef}
              onChange={(patch) => updateTrack(selected.id, patch)}
              onProcess={() => processOne(selected.id)}
              onOpenSettings={() => setShowSettings(true)}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-10 text-center">
              <div className="max-w-sm">
                <svg
                  viewBox="0 0 48 48"
                  fill="currentColor"
                  aria-hidden="true"
                  className="mx-auto mb-5 h-12 w-12 text-fg-faint"
                >
                  <rect x="4" y="19" width="4" height="10" rx="2" />
                  <rect x="10" y="15" width="4" height="18" rx="2" />
                  <rect x="16" y="10" width="4" height="28" rx="2" />
                  <rect x="22" y="5" width="4" height="38" rx="2" />
                  <rect x="28" y="10" width="4" height="28" rx="2" />
                  <rect x="34" y="15" width="4" height="18" rx="2" />
                  <rect x="40" y="19" width="4" height="10" rx="2" />
                </svg>
                <p className="text-[15px] font-medium text-balance text-fg-muted">
                  {tr('empty.title')}
                </p>
                <p className="mt-1.5 text-sm text-pretty text-fg-dim">
                  {tr(
                    window.api.platform === 'darwin' ? 'empty.subtitle' : 'empty.subtitleNoMusic',
                  )}
                </p>
              </div>
            </div>
          )}
        </main>
      </div>

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-[var(--color-accent)]/10 ring-2 ring-inset ring-[var(--color-accent)]">
          <span className="rounded-xl bg-[var(--color-panel)] px-6 py-3 text-lg font-medium">
            {tr('drop.release')}
          </span>
        </div>
      )}

      {showSettings && settings && (
        <SettingsModal
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSave={saveSettings}
        />
      )}

      {showPalette && <CommandPalette commands={commands} onClose={() => setShowPalette(false)} />}

      <UpdateToast />
    </div>
  )
}
