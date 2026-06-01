import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import type { Settings } from '../../shared/types'
import type { TrackItem } from './types'
import type { Command } from './lib/commands'
import { parseFileName } from './lib/filename'
import { renderOutputName } from './lib/outputName'
import { sanitizeMeta } from './lib/hygiene'
import { DEFAULT_FIELDS } from './lib/fields'
import { keyToCommandId, moveIndex } from './lib/keymap'
import { TrackList } from './components/TrackList'
import { Editor } from './components/Editor'
import { SettingsModal } from './components/SettingsModal'
import { CommandPalette } from './components/CommandPalette'

const AUDIO_EXT = /\.(wav|flac|aif|aiff)$/i

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
      trackNumber: ''
    }
  }
}

export default function App(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [tracks, setTracks] = useState<TrackItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showPalette, setShowPalette] = useState(false)
  const [dragging, setDragging] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    window.api.getSettings().then(setSettings)
  }, [])

  useEffect(() => window.api.onOpenSettings(() => setShowSettings(true)), [])

  function addPaths(paths: string[]): void {
    setTracks((prev) => {
      const existing = new Set(prev.map((t) => t.inputPath))
      const fresh = paths.filter((p) => AUDIO_EXT.test(p) && !existing.has(p)).map(newTrack)
      if (fresh.length && !selectedId) setSelectedId(fresh[0].id)
      return [...prev, ...fresh]
    })
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

  async function processOne(id: string): Promise<void> {
    const track = tracks.find((t) => t.id === id)
    if (!track) return
    updateTrack(id, { status: 'processing', error: undefined })
    const meta = sanitizeMeta(track.meta, {
      trim: settings?.trimWhitespace ?? true,
      zeroPad: settings?.zeroPadTrack ?? true
    })
    const format = settings?.filenameFormat ?? '{artist} - {title}'
    const outputName = renderOutputName(format, meta) || track.fileName
    try {
      const { outputPath } = await window.api.processTrack({
        inputPath: track.inputPath,
        outputName,
        meta,
        coverUrl: track.coverUrl,
        coverPath: track.coverPath
      })
      updateTrack(id, { status: 'done', outputPath })
    } catch (e) {
      updateTrack(id, { status: 'error', error: e instanceof Error ? e.message : 'Error al procesar' })
    }
  }

  async function processAll(): Promise<void> {
    for (const t of tracks) {
      if (t.status === 'idle' || t.status === 'error') await processOne(t.id)
    }
  }

  function saveSettings(patch: Partial<Settings>): void {
    window.api.saveSettings(patch).then(setSettings)
  }

  function moveSelection(delta: number): void {
    const next = moveIndex(tracks.length, tracks.findIndex((t) => t.id === selectedId), delta)
    if (next === -1) return
    setSelectedId(tracks[next].id)
  }

  const selected = tracks.find((t) => t.id === selectedId) ?? null
  const pending = tracks.filter((t) => t.status === 'idle' || t.status === 'error').length
  const canProcessSelected = !!selected && (selected.status === 'idle' || selected.status === 'error')

  const commands: Command[] = [
    { id: 'add', title: 'Añadir archivos', hint: '⌘O', enabled: true, run: pickFiles },
    {
      id: 'process-current',
      title: 'Procesar pista actual',
      hint: '⌘↵',
      enabled: canProcessSelected,
      run: () => selected && processOne(selected.id)
    },
    { id: 'process-all', title: 'Procesar todo', hint: '⌘⇧↵', enabled: pending > 0, run: processAll },
    {
      id: 'remove',
      title: 'Quitar pista actual',
      hint: '⌘⌫',
      enabled: !!selected,
      run: () => selected && removeTrack(selected.id)
    },
    { id: 'next', title: 'Siguiente pista', hint: '↓', enabled: tracks.length > 1, run: () => moveSelection(1) },
    { id: 'prev', title: 'Pista anterior', hint: '↑', enabled: tracks.length > 1, run: () => moveSelection(-1) },
    {
      id: 'search',
      title: 'Buscar en Discogs',
      hint: '/',
      enabled: !!selected,
      run: () => searchInputRef.current?.focus()
    },
    { id: 'settings', title: 'Ajustes', hint: '⌘,', enabled: true, run: () => setShowSettings(true) }
  ]

  const commandsRef = useRef<Command[]>(commands)
  commandsRef.current = commands
  const paletteOpenRef = useRef(false)
  paletteOpenRef.current = showPalette
  const settingsOpenRef = useRef(false)
  settingsOpenRef.current = showSettings

  useEffect(() => {
    function run(id: string): void {
      const c = commandsRef.current.find((c) => c.id === id)
      if (c?.enabled) c.run()
    }
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
        run(id)
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
      <header
        className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--color-line)] pr-3 pl-20"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div />
        <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            data-testid="add-files"
            onClick={pickFiles}
            className="rounded-lg border border-[var(--color-line)] px-3 py-1.5 text-sm hover:bg-[var(--color-panel-2)]"
          >
            Añadir archivos
          </button>
          <button
            data-testid="process-all"
            onClick={processAll}
            disabled={pending === 0}
            className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-40"
          >
            Procesar todo{pending ? ` (${pending})` : ''}
          </button>
          <button
            data-testid="open-palette"
            onClick={() => setShowPalette(true)}
            className="rounded-lg border border-[var(--color-line)] px-2.5 py-1.5 text-xs text-neutral-400 hover:bg-[var(--color-panel-2)]"
            aria-label="Paleta de comandos"
          >
            ⌘K
          </button>
          <button
            data-testid="open-settings"
            onClick={() => setShowSettings(true)}
            className="rounded-lg border border-[var(--color-line)] px-2.5 py-1.5 text-sm hover:bg-[var(--color-panel-2)]"
            aria-label="Ajustes"
          >
            ⚙
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-72 shrink-0 overflow-y-auto border-r border-[var(--color-line)] bg-[var(--color-panel)]">
          {tracks.length === 0 ? (
            <p className="p-6 text-center text-xs text-neutral-600">
              Arrastra aquí tus WAV o FLAC, o pulsa “Añadir archivos”.
            </p>
          ) : (
            <TrackList
              tracks={tracks}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onRemove={removeTrack}
            />
          )}
        </aside>

        <main className="min-w-0 flex-1 bg-[var(--color-panel)]">
          {selected ? (
            <Editor
              key={selected.id}
              item={selected}
              hasToken={!!settings?.discogsToken}
              filenameFormat={settings?.filenameFormat ?? '{artist} - {title}'}
              groupingPresets={settings?.groupingPresets ?? []}
              visibleFields={settings?.visibleFields ?? DEFAULT_FIELDS}
              searchInputRef={searchInputRef}
              onChange={(patch) => updateTrack(selected.id, patch)}
              onProcess={() => processOne(selected.id)}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-10 text-center">
              <div>
                <svg
                  viewBox="0 0 48 48"
                  fill="currentColor"
                  aria-hidden="true"
                  className="mx-auto mb-4 h-12 w-12 text-neutral-600"
                >
                  <rect x="4" y="19" width="4" height="10" rx="2" />
                  <rect x="10" y="15" width="4" height="18" rx="2" />
                  <rect x="16" y="10" width="4" height="28" rx="2" />
                  <rect x="22" y="5" width="4" height="38" rx="2" />
                  <rect x="28" y="10" width="4" height="28" rx="2" />
                  <rect x="34" y="15" width="4" height="18" rx="2" />
                  <rect x="40" y="19" width="4" height="10" rx="2" />
                </svg>
                <p className="text-neutral-400">Añade pistas para empezar.</p>
                <p className="mt-1 text-sm text-neutral-600">
                  Rótulo las convierte a AIFF lossless, las etiqueta desde Discogs y las manda a Apple
                  Music.
                </p>
              </div>
            </div>
          )}
        </main>
      </div>

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-[var(--color-accent)]/10 ring-2 ring-inset ring-[var(--color-accent)]">
          <span className="rounded-xl bg-[var(--color-panel)] px-6 py-3 text-lg font-medium">
            Suelta para añadir
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

      {showPalette && (
        <CommandPalette commands={commands} onClose={() => setShowPalette(false)} />
      )}
    </div>
  )
}
