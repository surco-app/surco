import type React from 'react'
import { useState } from 'react'
import type { Settings } from '../../../shared/types'

interface Props {
  settings: Settings
  onClose: () => void
  onSave: (patch: Partial<Settings>) => void
}

export function SettingsModal({ settings, onClose, onSave }: Props): React.JSX.Element {
  const [token, setToken] = useState(settings.discogsToken)
  const [outputDir, setOutputDir] = useState(settings.outputDir)
  const [addToAppleMusic, setAddToAppleMusic] = useState(settings.addToAppleMusic)
  const [filenameFormat, setFilenameFormat] = useState(settings.filenameFormat)
  const [grouping, setGrouping] = useState(settings.groupingPresets.join(', '))

  async function changeDir(): Promise<void> {
    const dir = await window.api.pickOutputDir()
    if (dir) setOutputDir(dir)
  }

  function save(): void {
    const groupingPresets = grouping
      .split(',')
      .map((g) => g.trim())
      .filter(Boolean)
    onSave({
      discogsToken: token.trim(),
      outputDir,
      addToAppleMusic,
      filenameFormat: filenameFormat.trim() || '{artist} - {title}',
      groupingPresets
    })
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[520px] rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-5 text-lg font-semibold">Ajustes</h2>

        <label className="mb-1.5 block text-sm font-medium text-neutral-300">Token de Discogs</label>
        <input
          data-testid="settings-token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Pega aquí tu token personal"
          className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
        />
        <p className="mt-1.5 mb-5 text-xs text-neutral-500">
          Genera uno gratis en{' '}
          <a
            href="https://www.discogs.com/settings/developers"
            className="text-[var(--color-accent)] hover:underline"
          >
            discogs.com/settings/developers
          </a>{' '}
          → “Generate new token”.
        </p>

        <label className="mb-1.5 block text-sm font-medium text-neutral-300">Carpeta de salida</label>
        <div className="mb-5 flex gap-2">
          <input
            data-testid="settings-output"
            value={outputDir}
            readOnly
            className="min-w-0 flex-1 truncate rounded-lg border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-2 text-sm text-neutral-400"
          />
          <button
            onClick={changeDir}
            className="rounded-lg border border-[var(--color-line)] px-3 py-2 text-sm hover:bg-[var(--color-panel-2)]"
          >
            Cambiar
          </button>
        </div>

        <label className="mb-1.5 block text-sm font-medium text-neutral-300">
          Formato del nombre
        </label>
        <input
          data-testid="settings-filename-format"
          value={filenameFormat}
          onChange={(e) => setFilenameFormat(e.target.value)}
          placeholder="{artist} - {title}"
          className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
        />
        <p className="mt-1.5 mb-5 text-xs text-neutral-500">
          Tokens: {'{artist}'} {'{title}'} {'{album}'} {'{albumArtist}'} {'{year}'} {'{genre}'}{' '}
          {'{grouping}'} {'{trackNumber}'}
        </p>

        <label className="mb-1.5 block text-sm font-medium text-neutral-300">
          Grouping (separados por comas)
        </label>
        <input
          data-testid="settings-grouping"
          value={grouping}
          onChange={(e) => setGrouping(e.target.value)}
          placeholder="Bases, Cantaditas"
          className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
        />
        <p className="mt-1.5 mb-5 text-xs text-neutral-500">
          Aparecen como botones rápidos al editar una pista.
        </p>

        <label className="mb-6 flex cursor-pointer items-center gap-3">
          <input
            data-testid="settings-applemusic"
            type="checkbox"
            checked={addToAppleMusic}
            onChange={(e) => setAddToAppleMusic(e.target.checked)}
            className="h-4 w-4 accent-[var(--color-accent)]"
          />
          <span className="text-sm">Añadir automáticamente a Apple Music tras procesar</span>
        </label>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-neutral-400 hover:text-neutral-200"
          >
            Cancelar
          </button>
          <button
            data-testid="settings-save"
            onClick={save}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:brightness-110"
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}
